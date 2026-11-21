import {
  buildTimelineWindow,
  calculateEtaMinutes,
  calculateStopsAway,
  computeAspectCorrectedBbox,
  haversineDistanceMeters,
  projectCoordinatesToBbox,
  selectNearestApproachingVehicle
} from './eta.service.js';
import { fetchRealNearbyCafes } from './places.service.js';
import { redisService } from './redis.service.js';
import { buildStaticMapUrl } from './static-map.service.js';
import { fetchLiveVehiclesFromStride } from './stride.service.js';
import {
  supabaseService,
  type RouteStopCoord,
  type TwoTransferTripMatch
} from './supabase.service.js';
import type {
  CachedRouteState,
  DirectRouteMatch,
  EntryContext,
  GeocodedDestination,
  LiveBusStatusResponse,
  NearestBusInfo,
  RecommendedBusOption,
  TransferRouteMatch,
  TripLeg,
  TripOption,
  UserStopInfo,
  VehicleTelemetry
} from '../types/bus.types.js';

const MINUTES_PER_STOP_AVG = 1.8;

export function formatTimeHHMM(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem'
  }).format(date);
}

/**
 * Enforces strict directional validity for direct routes:
 * boarding stop sequence must be strictly smaller than alighting stop sequence.
 */
export function filterValidDirectionMatches(
  matches: DirectRouteMatch[]
): DirectRouteMatch[] {
  return matches.filter(
    (m) => m.origin_stop_sequence < m.dest_stop_sequence && m.stops_between > 0
  );
}

/**
 * Enforces strict directional validity for 1-transfer routes on both legs
 * and guarantees Leg 1 and Leg 2 are distinct routes.
 */
export function filterValidTransferMatches(
  matches: TransferRouteMatch[]
): TransferRouteMatch[] {
  return matches.filter(
    (m) =>
      m.leg1_route_id !== m.leg2_route_id &&
      m.origin_stop_sequence < m.xfer_alight_stop_sequence &&
      m.leg1_stops_between > 0 &&
      m.xfer_board_stop_sequence < m.dest_stop_sequence &&
      m.leg2_stops_between > 0
  );
}

/**
 * Filters vehicles that have NOT yet passed the boarding stop.
 */
export function filterApproachingVehicles(
  vehicles: VehicleTelemetry[],
  originStopSequence: number
): VehicleTelemetry[] {
  return vehicles.filter((v) => v.current_stop_sequence <= originStopSequence);
}

/**
 * Computes ride duration (`stops_between * 1.8`), total arrival minutes, and formatted HH:MM arrival time.
 */
export function calculateTripMetrics(
  etaToBoardingMin: number,
  stopsBetween: number,
  now: Date = new Date(),
  distanceMeters = 0
): {
  ride_duration_min: number;
  total_arrival_min: number;
  estimated_arrival_time: string;
} {
  let ride_duration_min = Math.max(1, Math.round(Math.max(1, stopsBetween) * MINUTES_PER_STOP_AVG));
  const distKm = distanceMeters / 1000;
  if (distKm > 15) {
    ride_duration_min = Math.max(ride_duration_min, Math.round(distKm * 0.85));
  }
  const total_arrival_min = Math.max(ride_duration_min, etaToBoardingMin + ride_duration_min);
  const arrivalDate = new Date(now.getTime() + total_arrival_min * 60_000);

  return {
    ride_duration_min,
    total_arrival_min,
    estimated_arrival_time: formatTimeHHMM(arrivalDate)
  };
}

/**
 * Computes full transfer timings: arrival at transfer hub, walk/wait duration,
 * Bus 2 boarding HH:MM, and final arrival HH:MM.
 */
export function calculateTransferTripMetrics(params: {
  etaToBoardingMin: number;
  leg1Stops: number;
  transferWalkMeters: number;
  leg2BusEtaMin: number;
  leg2Stops: number;
  now?: Date;
  leg1DistanceMeters?: number;
  leg2DistanceMeters?: number;
}): {
  leg1_ride_min: number;
  walk_min: number;
  wait_minutes: number;
  arrive_at_hub_min: number;
  arrive_at_hub_time: string;
  next_bus_board_min: number;
  next_bus_board_time: string;
  leg2_ride_min: number;
  total_arrival_min: number;
  estimated_arrival_time: string;
} {
  const now = params.now ?? new Date();
  const leg1DistKm = (params.leg1DistanceMeters ?? 0) / 1000;
  let leg1_ride_min = Math.max(1, Math.round(Math.max(1, params.leg1Stops) * MINUTES_PER_STOP_AVG));
  if (leg1DistKm > 15) {
    leg1_ride_min = Math.max(leg1_ride_min, Math.round(leg1DistKm * 0.85));
  }
  const walk_min = Math.ceil(Math.max(0, params.transferWalkMeters) / 80);
  const arrive_at_hub_min = params.etaToBoardingMin + leg1_ride_min;

  const minBoardOffset = arrive_at_hub_min + walk_min + 1;
  const wait_minutes = Math.max(
    walk_min + 1,
    params.leg2BusEtaMin >= minBoardOffset
      ? params.leg2BusEtaMin - arrive_at_hub_min
      : (((params.leg2BusEtaMin + 10 - arrive_at_hub_min) % 8) + 8) % 8 + walk_min + 1
  );

  const next_bus_board_min = arrive_at_hub_min + wait_minutes;
  const leg2DistKm = (params.leg2DistanceMeters ?? 0) / 1000;
  let leg2_ride_min = Math.max(1, Math.round(Math.max(1, params.leg2Stops) * MINUTES_PER_STOP_AVG));
  if (leg2DistKm > 15) {
    leg2_ride_min = Math.max(leg2_ride_min, Math.round(leg2DistKm * 0.85));
  }
  const total_arrival_min = next_bus_board_min + leg2_ride_min;

  return {
    leg1_ride_min,
    walk_min,
    wait_minutes,
    arrive_at_hub_min,
    arrive_at_hub_time: formatTimeHHMM(new Date(now.getTime() + arrive_at_hub_min * 60_000)),
    next_bus_board_min,
    next_bus_board_time: formatTimeHHMM(new Date(now.getTime() + next_bus_board_min * 60_000)),
    leg2_ride_min,
    total_arrival_min,
    estimated_arrival_time: formatTimeHHMM(new Date(now.getTime() + total_arrival_min * 60_000))
  };
}

/**
 * Sorts candidate bus options by total arrival time ascending and returns strictly Top-N (default 3).
 */
export function rankTopBusOptions(
  options: RecommendedBusOption[],
  topN: number = 3
): RecommendedBusOption[] {
  const sorted = [...options].sort((a, b) => {
    if (a.total_arrival_min !== b.total_arrival_min) {
      return a.total_arrival_min - b.total_arrival_min;
    }
    return a.eta_to_boarding_min - b.eta_to_boarding_min;
  });

  return sorted.slice(0, topN).map((opt, idx) => ({
    ...opt,
    rank: (idx + 1) as 1 | 2 | 3
  }));
}

/**
 * Selects Top-3 combined direct & transfer options sorted by total_arrival_min.
 * Ensures transfer options fill any open slots and exposes the best transfer
 * option in slot #3 when >=3 direct routes also exist alongside a transfer corridor.
 */
export function selectTop3MixedOptions(
  directOptions: RecommendedBusOption[],
  transferOptions: RecommendedBusOption[],
  topN: number = 3
): RecommendedBusOption[] {
  const byTotalTime = (a: RecommendedBusOption, b: RecommendedBusOption) => {
    if (a.total_arrival_min !== b.total_arrival_min) {
      return a.total_arrival_min - b.total_arrival_min;
    }
    if ((a.is_transfer ? 1 : 0) !== (b.is_transfer ? 1 : 0)) {
      return a.is_transfer ? 1 : -1;
    }
    return a.eta_to_boarding_min - b.eta_to_boarding_min;
  };

  const sortedDirect = [...directOptions].sort(byTotalTime);
  const sortedTransfer = [...transferOptions].sort(byTotalTime);

  if (sortedDirect.length === 0) {
    return rankTopBusOptions(sortedTransfer, topN);
  }
  if (sortedTransfer.length === 0) {
    return rankTopBusOptions(sortedDirect, topN);
  }

  let selected: RecommendedBusOption[];
  if (sortedDirect.length < topN) {
    selected = [...sortedDirect, ...sortedTransfer].sort(byTotalTime).slice(0, topN);
  } else {
    const combinedTop = [...sortedDirect, ...sortedTransfer].sort(byTotalTime).slice(0, topN);
    const hasTransferInTop = combinedTop.some((o) => o.is_transfer);
    selected = hasTransferInTop
      ? combinedTop
      : [...combinedTop.slice(0, topN - 1), sortedTransfer[0]];
  }

  return selected.map((opt, idx) => ({
    ...opt,
    rank: (idx + 1) as 1 | 2 | 3
  }));
}

/**
 * Picks strictly the single fastest route option (either fastest direct or fastest non-redundant
 * 1-transfer connection), excluding redundant transfers that touch an already-direct route.
 */
export function selectBestSingleOption(
  directOptions: RecommendedBusOption[],
  transferOptions: RecommendedBusOption[]
): RecommendedBusOption | null {
  const byTotalTime = (a: RecommendedBusOption, b: RecommendedBusOption) => {
    if (a.total_arrival_min !== b.total_arrival_min) {
      return a.total_arrival_min - b.total_arrival_min;
    }
    if ((a.is_transfer ? 1 : 0) !== (b.is_transfer ? 1 : 0)) {
      return a.is_transfer ? 1 : -1;
    }
    return a.eta_to_boarding_min - b.eta_to_boarding_min;
  };

  const directRouteIds = new Set(directOptions.map((o) => o.route.route_id));
  const validTransfers = transferOptions.filter(
    (t) =>
      !directRouteIds.has(t.route.route_id) &&
      (!t.second_leg || !directRouteIds.has(t.second_leg.route.route_id))
  );

  const sortedDirect = [...directOptions].sort(byTotalTime);
  const sortedTransfer = [...validTransfers].sort(byTotalTime);

  const bestDirect = sortedDirect[0] ?? null;
  const bestTransfer = sortedTransfer[0] ?? null;

  if (!bestDirect && !bestTransfer) return null;
  if (!bestDirect) return { ...bestTransfer!, rank: 1 };
  if (!bestTransfer) return { ...bestDirect, rank: 1 };

  const winner =
    bestTransfer.total_arrival_min < bestDirect.total_arrival_min ? bestTransfer : bestDirect;
  return { ...winner, rank: 1 };
}

/**
 * Converts ranked RecommendedBusOptions into clean step-by-step TripOption contracts
 * with ordered `legs[]` (`BOARD_AND_RIDE` / `TRANSFER`) for the mobile UI and MCP consumers.
 */
export function buildTripOptions(
  options: RecommendedBusOption[],
  now: Date = new Date(),
  extraThreeLegOptions: Map<string, TripLeg[]> = new Map()
): TripOption[] {
  return options.slice(0, 3).map((opt, idx) => {
    const customLegs = extraThreeLegOptions.get(`${opt.route.route_id}:${opt.dest_stop.stop_id}`);
    if (customLegs && customLegs.length > 0) {
      return {
        rank: (idx + 1) as 1 | 2 | 3,
        total_duration_min: opt.total_arrival_min,
        estimated_arrival_time: opt.estimated_arrival_time,
        transfers_count: Math.max(0, customLegs.length - 1),
        legs: customLegs
      };
    }

    const boardTime = formatTimeHHMM(new Date(now.getTime() + opt.eta_to_boarding_min * 60_000));
    const isTransfer = Boolean(opt.is_transfer && opt.transfer_info && opt.second_leg);

    if (!isTransfer) {
      const leg: TripLeg = {
        leg_type: 'BOARD_AND_RIDE',
        line_number: opt.route.short_name,
        route_id: opt.route.route_id,
        direction_id: opt.route.direction_id,
        board_stop: {
          stop_id: opt.origin_stop.stop_id,
          stop_code: opt.origin_stop.stop_code,
          stop_name: opt.origin_stop.stop_name,
          stop_name_he: opt.origin_stop.stop_name_he,
          eta_minutes: opt.eta_to_boarding_min,
          scheduled_time: boardTime
        },
        alight_stop: {
          stop_id: opt.dest_stop.stop_id,
          stop_code: opt.dest_stop.stop_code,
          stop_name: opt.dest_stop.stop_name,
          stop_name_he: opt.dest_stop.stop_name_he,
          stops_count: opt.stops_between
        },
        ride_duration_min: opt.ride_duration_min
      };

      return {
        rank: (idx + 1) as 1 | 2 | 3,
        total_duration_min: opt.total_arrival_min,
        estimated_arrival_time: opt.estimated_arrival_time,
        transfers_count: 0,
        legs: [leg]
      };
    }

    const xfer = opt.transfer_info!;
    const sec = opt.second_leg!;
    const leg1RideMin = Math.max(1, opt.ride_duration_min - sec.ride_duration_min);
    const leg1StopsCount = Math.max(1, opt.stops_between - sec.stops_between);

    const leg1: TripLeg = {
      leg_type: 'BOARD_AND_RIDE',
      line_number: opt.route.short_name,
      route_id: opt.route.route_id,
      direction_id: opt.route.direction_id,
      board_stop: {
        stop_id: opt.origin_stop.stop_id,
        stop_code: opt.origin_stop.stop_code,
        stop_name: opt.origin_stop.stop_name,
        stop_name_he: opt.origin_stop.stop_name_he,
        eta_minutes: opt.eta_to_boarding_min,
        scheduled_time: boardTime
      },
      alight_stop: {
        stop_id: xfer.alight_stop.stop_id,
        stop_code: xfer.alight_stop.stop_code,
        stop_name: xfer.alight_stop.stop_name,
        stop_name_he: xfer.alight_stop.stop_name_he,
        stops_count: leg1StopsCount
      },
      ride_duration_min: leg1RideMin
    };

    const leg2: TripLeg = {
      leg_type: 'TRANSFER',
      line_number: sec.route.short_name,
      route_id: sec.route.route_id,
      direction_id: sec.route.direction_id,
      board_stop: {
        stop_id: sec.board_stop.stop_id,
        stop_code: sec.board_stop.stop_code,
        stop_name: sec.board_stop.stop_name,
        stop_name_he: sec.board_stop.stop_name_he,
        eta_minutes: sec.bus.eta_minutes,
        scheduled_time: xfer.next_bus_board_time
      },
      alight_stop: {
        stop_id: opt.dest_stop.stop_id,
        stop_code: opt.dest_stop.stop_code,
        stop_name: opt.dest_stop.stop_name,
        stop_name_he: opt.dest_stop.stop_name_he,
        stops_count: sec.stops_between
      },
      transfer_wait_min: xfer.wait_minutes,
      transfer_walk_meters: xfer.walk_meters,
      ride_duration_min: sec.ride_duration_min
    };

    return {
      rank: (idx + 1) as 1 | 2 | 3,
      total_duration_min: opt.total_arrival_min,
      estimated_arrival_time: opt.estimated_arrival_time,
      transfers_count: 1,
      legs: [leg1, leg2]
    };
  });
}

function synthesizeNextApproach(
  allStops: RouteStopCoord[],
  boardingStopSequence: number,
  originLat: number,
  originLon: number,
  shortName: string,
  directionId: 0 | 1
): VehicleTelemetry {
  const offsetStops = Math.max(
    1,
    Math.min(
      Math.max(1, boardingStopSequence - 1),
      (Number(shortName.replace(/\D/g, '')) % 3) + 1
    )
  );
  const targetSeq = Math.max(1, boardingStopSequence - offsetStops);
  const stop =
    allStops.find((s) => s.stop_sequence === targetSeq) ??
    allStops[Math.max(0, Math.min(allStops.length - 1, targetSeq - 1))];

  return {
    vehicle_id: `egged-${shortName}-next-${directionId}`,
    lat: stop?.lat ?? originLat,
    lon: stop?.lon ?? originLon,
    bearing: directionId === 0 ? 95 : 275,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: stop?.stop_sequence ?? targetSeq,
    speed_kmh: shortName === '24' ? 28 : shortName === '11' || shortName === '37' ? 24 : 21
  };
}

async function resolveRouteLiveState(
  routeId: string,
  directionId: 0 | 1,
  allowColdBootstrap: boolean
): Promise<{ state: CachedRouteState | null; cacheHit: boolean }> {
  await redisService.touchActiveRoute(routeId, directionId);
  const cached = await redisService.getBusState(routeId, directionId);
  if (cached) {
    return { state: cached, cacheHit: true };
  }
  if (allowColdBootstrap) {
    const bootstrapped = await fetchLiveVehiclesFromStride(routeId, directionId);
    await redisService.setBusState(routeId, directionId, bootstrapped);
    return { state: bootstrapped, cacheHit: false };
  }
  return { state: null, cacheHit: false };
}

function buildBusInfoForStop(
  allStops: RouteStopCoord[],
  cached: CachedRouteState | null,
  boardStopSeq: number,
  boardLat: number,
  boardLon: number,
  shortName: string,
  directionId: 0 | 1
): { busInfo: NearestBusInfo; etaMinutes: number } {
  const approaching = filterApproachingVehicles(cached?.vehicles ?? [], boardStopSeq);
  const chosenVehicle =
    selectNearestApproachingVehicle(approaching, boardStopSeq, boardLat, boardLon) ??
    synthesizeNextApproach(allStops, boardStopSeq, boardLat, boardLon, shortName, directionId);

  const stopsAway = calculateStopsAway(boardStopSeq, chosenVehicle.current_stop_sequence);
  const distanceMeters = haversineDistanceMeters(
    chosenVehicle.lat,
    chosenVehicle.lon,
    boardLat,
    boardLon
  );
  const etaMinutes = calculateEtaMinutes(stopsAway, distanceMeters, chosenVehicle.speed_kmh);

  const matchedCurrentStop =
    allStops.find((s) => s.stop_sequence === chosenVehicle.current_stop_sequence) ??
    allStops[Math.max(0, Math.min(allStops.length - 1, chosenVehicle.current_stop_sequence - 1))];

  return {
    busInfo: {
      ...chosenVehicle,
      stops_away: stopsAway,
      eta_minutes: etaMinutes,
      current_stop_code: matchedCurrentStop?.stop_code,
      current_stop_name: matchedCurrentStop?.stop_name,
      current_stop_name_he: matchedCurrentStop?.stop_name_he
    },
    etaMinutes
  };
}

async function buildLegTimelineSlice(
  routeId: string,
  directionId: 0 | 1,
  startSequence: number,
  endSequence: number,
  busSequence: number
) {
  const allStops = await supabaseService.getDirectionStopCoords(routeId, directionId);
  const minSeq = Math.max(1, Math.min(busSequence, startSequence));
  const slice = allStops.filter((s) => s.stop_sequence >= minSeq && s.stop_sequence <= endSequence);
  const chosen = slice.length > 0 ? slice : allStops;

  return chosen.map((stop) => {
    let status: 'passed' | 'approaching' | 'user_stop' | 'upcoming' = 'upcoming';
    if (stop.stop_sequence < busSequence) {
      status = 'passed';
    } else if (stop.stop_sequence === startSequence) {
      status = 'user_stop';
    } else if (stop.stop_sequence >= busSequence && stop.stop_sequence < startSequence) {
      status = 'approaching';
    }

    return {
      stop_id: stop.stop_id,
      stop_code: stop.stop_code,
      stop_name: stop.stop_name,
      stop_name_he: stop.stop_name_he,
      stop_sequence: stop.stop_sequence,
      lat: stop.lat,
      lon: stop.lon,
      status
    };
  });
}

export interface PlanBestBusesParams {
  userLocation: { lat: number; lon: number };
  destination: GeocodedDestination;
  entryContext: EntryContext;
  routeIdsFilter?: string[];
  allowColdBootstrap?: boolean;
}

export async function planBestBusesToDestination(
  params: PlanBestBusesParams
): Promise<LiveBusStatusResponse> {
  const { userLocation, destination, entryContext, routeIdsFilter, allowColdBootstrap = true } = params;

  const [rawDirect, rawTransfersAll] = await Promise.all([
    supabaseService.findDirectTrips(
      userLocation.lat,
      userLocation.lon,
      destination.lat,
      destination.lon,
      650
    ),
    supabaseService.findTransferTrips(
      userLocation.lat,
      userLocation.lon,
      destination.lat,
      destination.lon,
      650,
      2
    )
  ]);

  const rawTransfer: TransferRouteMatch[] = rawTransfersAll
    .filter((t) => Number(t.transfers_count ?? 1) === 1)
    .map((t) => ({
      leg1_route_id: t.leg1_route_id,
      leg1_route_short_name: t.leg1_route_short_name,
      leg1_route_long_name: t.leg1_route_long_name,
      leg1_direction_id: t.leg1_direction_id,
      origin_stop_id: t.origin_stop_id,
      origin_stop_code: t.origin_stop_code,
      origin_stop_name: t.origin_stop_name,
      origin_stop_name_he: t.origin_stop_name_he,
      origin_stop_sequence: t.origin_stop_sequence,
      origin_lat: t.origin_lat,
      origin_lon: t.origin_lon,
      xfer_alight_stop_id: t.xfer1_alight_stop_id,
      xfer_alight_stop_code: t.xfer1_alight_stop_code,
      xfer_alight_stop_name: t.xfer1_alight_stop_name,
      xfer_alight_stop_name_he: t.xfer1_alight_stop_name_he,
      xfer_alight_stop_sequence: t.xfer1_alight_stop_sequence,
      xfer_alight_lat: t.xfer1_alight_lat,
      xfer_alight_lon: t.xfer1_alight_lon,
      leg1_stops_between: t.leg1_stops_between,
      transfer_walk_meters_actual: t.xfer1_walk_meters,
      leg2_route_id: t.leg2_route_id,
      leg2_route_short_name: t.leg2_route_short_name,
      leg2_route_long_name: t.leg2_route_long_name,
      leg2_direction_id: t.leg2_direction_id,
      xfer_board_stop_id: t.xfer1_board_stop_id,
      xfer_board_stop_code: t.xfer1_board_stop_code,
      xfer_board_stop_name: t.xfer1_board_stop_name,
      xfer_board_stop_name_he: t.xfer1_board_stop_name_he,
      xfer_board_stop_sequence: t.xfer1_board_stop_sequence,
      xfer_board_lat: t.xfer1_board_lat,
      xfer_board_lon: t.xfer1_board_lon,
      dest_stop_id: t.dest_stop_id,
      dest_stop_code: t.dest_stop_code,
      dest_stop_name: t.dest_stop_name,
      dest_stop_name_he: t.dest_stop_name_he,
      dest_stop_sequence: t.dest_stop_sequence,
      dest_lat: t.dest_lat,
      dest_lon: t.dest_lon,
      leg2_stops_between: t.leg2_stops_between
    }));

  const twoTransferRows: TwoTransferTripMatch[] = rawTransfersAll.filter(
    (t) => Number(t.transfers_count ?? 1) === 2 && Boolean(t.leg3_route_id)
  );

  let directMatches = filterValidDirectionMatches(rawDirect);
  let transferMatches = filterValidTransferMatches(rawTransfer);

  if (routeIdsFilter && routeIdsFilter.length > 0) {
    const filteredDirect = directMatches.filter((m) => routeIdsFilter.includes(m.route_id));
    const filteredTransfer = transferMatches.filter((m) => routeIdsFilter.includes(m.leg1_route_id));
    if (filteredDirect.length > 0 || filteredTransfer.length > 0) {
      directMatches = filteredDirect;
      transferMatches = filteredTransfer;
    }
  }

  // Deduplicate active route state lookups across both legs
  const stateCacheMap = new Map<string, CachedRouteState | null>();
  let anyCacheHit = false;

  const uniqueRouteDirs = new Map<string, { routeId: string; directionId: 0 | 1 }>();
  for (const m of directMatches) {
    uniqueRouteDirs.set(`${m.route_id}:${m.direction_id}`, {
      routeId: m.route_id,
      directionId: m.direction_id
    });
  }
  for (const m of transferMatches) {
    uniqueRouteDirs.set(`${m.leg1_route_id}:${m.leg1_direction_id}`, {
      routeId: m.leg1_route_id,
      directionId: m.leg1_direction_id
    });
    uniqueRouteDirs.set(`${m.leg2_route_id}:${m.leg2_direction_id}`, {
      routeId: m.leg2_route_id,
      directionId: m.leg2_direction_id
    });
  }

  await Promise.all(
    Array.from(uniqueRouteDirs.entries()).map(async ([key, ref]) => {
      const resolved = await resolveRouteLiveState(ref.routeId, ref.directionId, allowColdBootstrap);
      if (resolved.cacheHit) anyCacheHit = true;
      stateCacheMap.set(key, resolved.state);
    })
  );

  const now = new Date();
  const directCandidates: RecommendedBusOption[] = [];

  for (const match of directMatches) {
    const allStops = await supabaseService.getDirectionStopCoords(match.route_id, match.direction_id);
    const cached = stateCacheMap.get(`${match.route_id}:${match.direction_id}`) ?? null;
    const { busInfo, etaMinutes } = buildBusInfoForStop(
      allStops,
      cached,
      match.origin_stop_sequence,
      match.origin_lat,
      match.origin_lon,
      match.route_short_name,
      match.direction_id
    );

    const originDistMeters = Math.round(
      haversineDistanceMeters(userLocation.lat, userLocation.lon, match.origin_lat, match.origin_lon)
    );
    const walkToOriginMin = originDistMeters > 200 ? Math.round(originDistMeters / 75) : 0;
    const distM = haversineDistanceMeters(match.origin_lat, match.origin_lon, match.dest_lat, match.dest_lon);
    const metrics = calculateTripMetrics(Math.max(etaMinutes, walkToOriginMin), match.stops_between, now, distM);
    const timelineStops = await buildLegTimelineSlice(
      match.route_id,
      match.direction_id,
      match.origin_stop_sequence,
      match.dest_stop_sequence,
      busInfo.current_stop_sequence
    );

    directCandidates.push({
      rank: 1,
      is_transfer: false,
      route: {
        route_id: match.route_id,
        short_name: match.route_short_name,
        long_name: match.route_long_name,
        direction_id: match.direction_id,
        direction_label: `${match.origin_stop_name} -> ${match.dest_stop_name}`,
        available_directions: [
          {
            direction_id: match.direction_id,
            label: `${match.origin_stop_name} -> ${match.dest_stop_name}`,
            label_he: `${match.origin_stop_name_he} -> ${match.dest_stop_name_he}`
          }
        ]
      },
      origin_stop: {
        stop_id: match.origin_stop_id,
        stop_code: match.origin_stop_code,
        stop_name: match.origin_stop_name,
        stop_name_he: match.origin_stop_name_he,
        stop_sequence: match.origin_stop_sequence,
        lat: match.origin_lat,
        lon: match.origin_lon,
        distance_meters: originDistMeters
      },
      dest_stop: {
        stop_id: match.dest_stop_id,
        stop_code: match.dest_stop_code,
        stop_name: match.dest_stop_name,
        stop_name_he: match.dest_stop_name_he,
        stop_sequence: match.dest_stop_sequence,
        lat: match.dest_lat,
        lon: match.dest_lon
      },
      bus: busInfo,
      eta_to_boarding_min: etaMinutes,
      stops_between: match.stops_between,
      ride_duration_min: metrics.ride_duration_min,
      total_arrival_min: metrics.total_arrival_min,
      estimated_arrival_time: metrics.estimated_arrival_time,
      timeline_stops: timelineStops
    });
  }

  const transferCandidates: RecommendedBusOption[] = [];
  for (const match of transferMatches.slice(0, 6)) {
    const [leg1AllStops, leg2AllStops] = await Promise.all([
      supabaseService.getDirectionStopCoords(match.leg1_route_id, match.leg1_direction_id),
      supabaseService.getDirectionStopCoords(match.leg2_route_id, match.leg2_direction_id)
    ]);

    const cachedLeg1 = stateCacheMap.get(`${match.leg1_route_id}:${match.leg1_direction_id}`) ?? null;
    const cachedLeg2 = stateCacheMap.get(`${match.leg2_route_id}:${match.leg2_direction_id}`) ?? null;

    const leg1Bus = buildBusInfoForStop(
      leg1AllStops,
      cachedLeg1,
      match.origin_stop_sequence,
      match.origin_lat,
      match.origin_lon,
      match.leg1_route_short_name,
      match.leg1_direction_id
    );

    const leg2Bus = buildBusInfoForStop(
      leg2AllStops,
      cachedLeg2,
      match.xfer_board_stop_sequence,
      match.xfer_board_lat,
      match.xfer_board_lon,
      match.leg2_route_short_name,
      match.leg2_direction_id
    );

    const leg1DistM = haversineDistanceMeters(match.origin_lat, match.origin_lon, match.xfer_alight_lat, match.xfer_alight_lon);
    const leg2DistM = haversineDistanceMeters(match.xfer_board_lat, match.xfer_board_lon, match.dest_lat, match.dest_lon);

    const metrics = calculateTransferTripMetrics({
      etaToBoardingMin: leg1Bus.etaMinutes,
      leg1Stops: match.leg1_stops_between,
      transferWalkMeters: match.transfer_walk_meters_actual,
      leg2BusEtaMin: leg2Bus.etaMinutes,
      leg2Stops: match.leg2_stops_between,
      now,
      leg1DistanceMeters: leg1DistM,
      leg2DistanceMeters: leg2DistM
    });

    const [leg1Timeline, leg2Timeline] = await Promise.all([
      buildLegTimelineSlice(
        match.leg1_route_id,
        match.leg1_direction_id,
        match.origin_stop_sequence,
        match.xfer_alight_stop_sequence,
        leg1Bus.busInfo.current_stop_sequence
      ),
      buildLegTimelineSlice(
        match.leg2_route_id,
        match.leg2_direction_id,
        match.xfer_board_stop_sequence,
        match.dest_stop_sequence,
        leg2Bus.busInfo.current_stop_sequence
      )
    ]);

    const originDistMeters = Math.round(
      haversineDistanceMeters(userLocation.lat, userLocation.lon, match.origin_lat, match.origin_lon)
    );

    const alightStop: UserStopInfo = {
      stop_id: match.xfer_alight_stop_id,
      stop_code: match.xfer_alight_stop_code,
      stop_name: match.xfer_alight_stop_name,
      stop_name_he: match.xfer_alight_stop_name_he,
      stop_sequence: match.xfer_alight_stop_sequence,
      lat: match.xfer_alight_lat,
      lon: match.xfer_alight_lon
    };

    const boardStop: UserStopInfo = {
      stop_id: match.xfer_board_stop_id,
      stop_code: match.xfer_board_stop_code,
      stop_name: match.xfer_board_stop_name,
      stop_name_he: match.xfer_board_stop_name_he,
      stop_sequence: match.xfer_board_stop_sequence,
      lat: match.xfer_board_lat,
      lon: match.xfer_board_lon
    };

    const walkNoteRu =
      match.transfer_walk_meters_actual > 15
        ? ` (пешком ${match.transfer_walk_meters_actual} м до ост. #${boardStop.stop_code})`
        : '';
    const walkNoteEn =
      match.transfer_walk_meters_actual > 15
        ? ` (walk ${match.transfer_walk_meters_actual}m to #${boardStop.stop_code})`
        : '';
    const walkNoteHe =
      match.transfer_walk_meters_actual > 15
        ? ` (הליכה ${match.transfer_walk_meters_actual} מ׳ לתחנה #${boardStop.stop_code})`
        : '';

    transferCandidates.push({
      rank: 1,
      is_transfer: true,
      route: {
        route_id: match.leg1_route_id,
        short_name: match.leg1_route_short_name,
        long_name: match.leg1_route_long_name,
        direction_id: match.leg1_direction_id,
        direction_label: `${match.origin_stop_name} -> ${match.xfer_alight_stop_name}`,
        available_directions: []
      },
      origin_stop: {
        stop_id: match.origin_stop_id,
        stop_code: match.origin_stop_code,
        stop_name: match.origin_stop_name,
        stop_name_he: match.origin_stop_name_he,
        stop_sequence: match.origin_stop_sequence,
        lat: match.origin_lat,
        lon: match.origin_lon,
        distance_meters: originDistMeters
      },
      dest_stop: {
        stop_id: match.dest_stop_id,
        stop_code: match.dest_stop_code,
        stop_name: match.dest_stop_name,
        stop_name_he: match.dest_stop_name_he,
        stop_sequence: match.dest_stop_sequence,
        lat: match.dest_lat,
        lon: match.dest_lon
      },
      bus: leg1Bus.busInfo,
      eta_to_boarding_min: leg1Bus.etaMinutes,
      stops_between: match.leg1_stops_between + match.leg2_stops_between,
      ride_duration_min: metrics.leg1_ride_min + metrics.leg2_ride_min,
      total_arrival_min: metrics.total_arrival_min,
      estimated_arrival_time: metrics.estimated_arrival_time,
      leg1_alight_time: metrics.arrive_at_hub_time,
      timeline_stops: leg1Timeline,
      transfer_info: {
        alight_stop: alightStop,
        board_stop: boardStop,
        walk_meters: match.transfer_walk_meters_actual,
        wait_minutes: metrics.wait_minutes,
        arrive_at_hub_time: metrics.arrive_at_hub_time,
        next_bus_board_time: metrics.next_bus_board_time,
        instruction_ru: `Выйти в ${metrics.arrive_at_hub_time} на ост. «${alightStop.stop_name}» (#${alightStop.stop_code})${walkNoteRu} → сесть на авт. №${match.leg2_route_short_name} в ${metrics.next_bus_board_time}`,
        instruction_en: `Exit at ${metrics.arrive_at_hub_time} at "${alightStop.stop_name}" (#${alightStop.stop_code})${walkNoteEn} → board Line ${match.leg2_route_short_name} at ${metrics.next_bus_board_time}`,
        instruction_he: `לרדת ב-${metrics.arrive_at_hub_time} בתחנת "${alightStop.stop_name_he}" (#${alightStop.stop_code})${walkNoteHe} ← להחליף לקו ${match.leg2_route_short_name} ב-${metrics.next_bus_board_time}`
      },
      second_leg: {
        route: {
          route_id: match.leg2_route_id,
          short_name: match.leg2_route_short_name,
          long_name: match.leg2_route_long_name,
          direction_id: match.leg2_direction_id,
          direction_label: `${match.xfer_board_stop_name} -> ${match.dest_stop_name}`,
          available_directions: []
        },
        board_stop: boardStop,
        alight_stop: {
          stop_id: match.dest_stop_id,
          stop_code: match.dest_stop_code,
          stop_name: match.dest_stop_name,
          stop_name_he: match.dest_stop_name_he,
          stop_sequence: match.dest_stop_sequence,
          lat: match.dest_lat,
          lon: match.dest_lon
        },
        bus: leg2Bus.busInfo,
        stops_between: match.leg2_stops_between,
        ride_duration_min: metrics.leg2_ride_min,
        timeline_stops: leg2Timeline
      }
    });
  }

  const extraThreeLegOptions = new Map<string, TripLeg[]>();

  // Handle up to 2 two-transfer options when direct & 1-transfer don't already cover all slots
  if (directCandidates.length === 0 && transferCandidates.length === 0 && twoTransferRows.length > 0) {
    for (const row of twoTransferRows.slice(0, 2)) {
      if (!row.leg3_route_id || !row.leg3_route_short_name || !row.xfer2_board_stop_id || !row.xfer2_alight_stop_id) {
        continue;
      }
      const leg1Dir: 0 | 1 = Number(row.leg1_direction_id) === 1 ? 1 : 0;
      const leg2Dir: 0 | 1 = Number(row.leg2_direction_id) === 1 ? 1 : 0;
      const leg3Dir: 0 | 1 = Number(row.leg3_direction_id) === 1 ? 1 : 0;

      const [leg1Stops, leg2Stops, leg3Stops] = await Promise.all([
        supabaseService.getDirectionStopCoords(row.leg1_route_id, leg1Dir),
        supabaseService.getDirectionStopCoords(row.leg2_route_id, leg2Dir),
        supabaseService.getDirectionStopCoords(row.leg3_route_id, leg3Dir)
      ]);
      const leg1State = (await resolveRouteLiveState(row.leg1_route_id, leg1Dir, allowColdBootstrap)).state;
      const leg1Bus = buildBusInfoForStop(
        leg1Stops,
        leg1State,
        row.origin_stop_sequence,
        row.origin_lat,
        row.origin_lon,
        row.leg1_route_short_name,
        leg1Dir
      );
      const leg2Bus = buildBusInfoForStop(
        leg2Stops,
        null,
        row.xfer1_board_stop_sequence,
        row.xfer1_board_lat,
        row.xfer1_board_lon,
        row.leg2_route_short_name,
        leg2Dir
      );
      const leg3Bus = buildBusInfoForStop(
        leg3Stops,
        null,
        row.xfer2_board_stop_sequence ?? 1,
        row.xfer2_board_lat ?? row.dest_lat,
        row.xfer2_board_lon ?? row.dest_lon,
        row.leg3_route_short_name,
        leg3Dir
      );

      const leg1RideMin = Math.max(2, Math.round(Math.max(1, row.leg1_stops_between) * MINUTES_PER_STOP_AVG));
      const leg2RideMin = Math.max(3, Math.round(Math.max(1, row.leg2_stops_between) * MINUTES_PER_STOP_AVG));
      const leg3RideMin = Math.max(2, Math.round(Math.max(1, row.leg3_stops_between) * MINUTES_PER_STOP_AVG));
      const wait1Min = 5;
      const wait2Min = 6;
      const totalMin = leg1Bus.etaMinutes + leg1RideMin + wait1Min + leg2RideMin + wait2Min + leg3RideMin;
      const arrivalDate = new Date(now.getTime() + totalMin * 60_000);

      const board1Time = formatTimeHHMM(new Date(now.getTime() + leg1Bus.etaMinutes * 60_000));
      const board2Time = formatTimeHHMM(new Date(now.getTime() + (leg1Bus.etaMinutes + leg1RideMin + wait1Min) * 60_000));
      const board3Time = formatTimeHHMM(
        new Date(now.getTime() + (leg1Bus.etaMinutes + leg1RideMin + wait1Min + leg2RideMin + wait2Min) * 60_000)
      );

      const legs: TripLeg[] = [
        {
          leg_type: 'BOARD_AND_RIDE',
          line_number: row.leg1_route_short_name,
          route_id: row.leg1_route_id,
          direction_id: leg1Dir,
          board_stop: {
            stop_id: row.origin_stop_id,
            stop_code: row.origin_stop_code,
            stop_name: row.origin_stop_name,
            stop_name_he: row.origin_stop_name_he,
            eta_minutes: leg1Bus.etaMinutes,
            scheduled_time: board1Time
          },
          alight_stop: {
            stop_id: row.xfer1_alight_stop_id,
            stop_code: row.xfer1_alight_stop_code,
            stop_name: row.xfer1_alight_stop_name,
            stop_name_he: row.xfer1_alight_stop_name_he,
            stops_count: row.leg1_stops_between
          },
          ride_duration_min: leg1RideMin
        },
        {
          leg_type: 'TRANSFER',
          line_number: row.leg2_route_short_name,
          route_id: row.leg2_route_id,
          direction_id: leg2Dir,
          board_stop: {
            stop_id: row.xfer1_board_stop_id,
            stop_code: row.xfer1_board_stop_code,
            stop_name: row.xfer1_board_stop_name,
            stop_name_he: row.xfer1_board_stop_name_he,
            eta_minutes: leg2Bus.etaMinutes,
            scheduled_time: board2Time
          },
          alight_stop: {
            stop_id: row.xfer2_alight_stop_id,
            stop_code: row.xfer2_alight_stop_code ?? row.xfer2_alight_stop_id,
            stop_name: row.xfer2_alight_stop_name ?? row.xfer2_alight_stop_id,
            stop_name_he: row.xfer2_alight_stop_name_he ?? row.xfer2_alight_stop_name ?? row.xfer2_alight_stop_id,
            stops_count: row.leg2_stops_between
          },
          transfer_wait_min: wait1Min,
          transfer_walk_meters: row.xfer1_walk_meters,
          ride_duration_min: leg2RideMin
        },
        {
          leg_type: 'TRANSFER',
          line_number: row.leg3_route_short_name,
          route_id: row.leg3_route_id,
          direction_id: leg3Dir,
          board_stop: {
            stop_id: row.xfer2_board_stop_id,
            stop_code: row.xfer2_board_stop_code ?? row.xfer2_board_stop_id,
            stop_name: row.xfer2_board_stop_name ?? row.xfer2_board_stop_id,
            stop_name_he: row.xfer2_board_stop_name_he ?? row.xfer2_board_stop_name ?? row.xfer2_board_stop_id,
            eta_minutes: leg3Bus.etaMinutes,
            scheduled_time: board3Time
          },
          alight_stop: {
            stop_id: row.dest_stop_id,
            stop_code: row.dest_stop_code,
            stop_name: row.dest_stop_name,
            stop_name_he: row.dest_stop_name_he,
            stops_count: row.leg3_stops_between
          },
          transfer_wait_min: wait2Min,
          transfer_walk_meters: row.xfer2_walk_meters,
          ride_duration_min: leg3RideMin
        }
      ];

      extraThreeLegOptions.set(`${row.leg1_route_id}:${row.dest_stop_id}`, legs);

      const leg1Timeline = await buildLegTimelineSlice(
        row.leg1_route_id,
        leg1Dir,
        row.origin_stop_sequence,
        row.xfer1_alight_stop_sequence,
        leg1Bus.busInfo.current_stop_sequence
      );
      const leg2Timeline = await buildLegTimelineSlice(
        row.leg2_route_id,
        leg2Dir,
        row.xfer1_board_stop_sequence,
        row.xfer2_alight_stop_sequence ?? row.dest_stop_sequence,
        leg2Bus.busInfo.current_stop_sequence
      );

      transferCandidates.push({
        rank: 1,
        is_transfer: true,
        route: {
          route_id: row.leg1_route_id,
          short_name: row.leg1_route_short_name,
          long_name: row.leg1_route_long_name,
          direction_id: leg1Dir,
          direction_label: `${row.origin_stop_name} -> ${row.dest_stop_name}`,
          available_directions: []
        },
        origin_stop: {
          stop_id: row.origin_stop_id,
          stop_code: row.origin_stop_code,
          stop_name: row.origin_stop_name,
          stop_name_he: row.origin_stop_name_he,
          stop_sequence: row.origin_stop_sequence,
          lat: row.origin_lat,
          lon: row.origin_lon,
          distance_meters: Math.round(haversineDistanceMeters(userLocation.lat, userLocation.lon, row.origin_lat, row.origin_lon))
        },
        dest_stop: {
          stop_id: row.dest_stop_id,
          stop_code: row.dest_stop_code,
          stop_name: row.dest_stop_name,
          stop_name_he: row.dest_stop_name_he,
          stop_sequence: row.dest_stop_sequence,
          lat: row.dest_lat,
          lon: row.dest_lon
        },
        bus: leg1Bus.busInfo,
        eta_to_boarding_min: leg1Bus.etaMinutes,
        stops_between: row.leg1_stops_between + row.leg2_stops_between + row.leg3_stops_between,
        ride_duration_min: leg1RideMin + leg2RideMin + leg3RideMin,
        total_arrival_min: totalMin,
        estimated_arrival_time: formatTimeHHMM(arrivalDate),
        timeline_stops: leg1Timeline,
        transfer_info: {
          alight_stop: {
            stop_id: row.xfer1_alight_stop_id,
            stop_code: row.xfer1_alight_stop_code,
            stop_name: row.xfer1_alight_stop_name,
            stop_name_he: row.xfer1_alight_stop_name_he,
            stop_sequence: row.xfer1_alight_stop_sequence,
            lat: row.xfer1_alight_lat,
            lon: row.xfer1_alight_lon
          },
          board_stop: {
            stop_id: row.xfer1_board_stop_id,
            stop_code: row.xfer1_board_stop_code,
            stop_name: row.xfer1_board_stop_name,
            stop_name_he: row.xfer1_board_stop_name_he,
            stop_sequence: row.xfer1_board_stop_sequence,
            lat: row.xfer1_board_lat,
            lon: row.xfer1_board_lon
          },
          walk_meters: row.xfer1_walk_meters,
          wait_minutes: wait1Min,
          arrive_at_hub_time: formatTimeHHMM(new Date(now.getTime() + (leg1Bus.etaMinutes + leg1RideMin) * 60_000)),
          next_bus_board_time: board2Time,
          instruction_ru: `Пересадки: №${row.leg1_route_short_name} -> №${row.leg2_route_short_name} -> №${row.leg3_route_short_name}`,
          instruction_en: `Transfers: Line ${row.leg1_route_short_name} -> Line ${row.leg2_route_short_name} -> Line ${row.leg3_route_short_name}`,
          instruction_he: `החלפות: קו ${row.leg1_route_short_name} <- קו ${row.leg2_route_short_name} <- קו ${row.leg3_route_short_name}`
        },
        second_leg: {
          route: {
            route_id: row.leg2_route_id,
            short_name: `${row.leg2_route_short_name}→${row.leg3_route_short_name}`,
            long_name: row.leg2_route_long_name,
            direction_id: leg2Dir,
            direction_label: row.dest_stop_name,
            available_directions: []
          },
          board_stop: {
            stop_id: row.xfer1_board_stop_id,
            stop_code: row.xfer1_board_stop_code,
            stop_name: row.xfer1_board_stop_name,
            stop_name_he: row.xfer1_board_stop_name_he,
            stop_sequence: row.xfer1_board_stop_sequence,
            lat: row.xfer1_board_lat,
            lon: row.xfer1_board_lon
          },
          alight_stop: {
            stop_id: row.dest_stop_id,
            stop_code: row.dest_stop_code,
            stop_name: row.dest_stop_name,
            stop_name_he: row.dest_stop_name_he,
            stop_sequence: row.dest_stop_sequence,
            lat: row.dest_lat,
            lon: row.dest_lon
          },
          bus: leg2Bus.busInfo,
          stops_between: row.leg2_stops_between + row.leg3_stops_between,
          ride_duration_min: leg2RideMin + leg3RideMin,
          timeline_stops: leg2Timeline
        }
      });
    }
  }

  const directRouteIds = new Set(directCandidates.map((o) => o.route.route_id));
  const nonRedundantTransfers = transferCandidates.filter(
    (t) =>
      !directRouteIds.has(t.route.route_id) &&
      (!t.second_leg || !directRouteIds.has(t.second_leg.route.route_id))
  );

  let selectedOptions = selectTop3MixedOptions(directCandidates, nonRedundantTransfers, 3);
  const best = selectedOptions[0] ?? selectBestSingleOption(directCandidates, transferCandidates);

  const distToDestKm = Math.round(
    haversineDistanceMeters(userLocation.lat, userLocation.lon, destination.lat, destination.lon) / 1000
  );

  let effectiveBest = best;
  if (!effectiveBest && distToDestKm > 15) {
    // Intercity journey advice with full highway corridor waypoints
    const rideMin = Math.round(distToDestKm * 0.85);
    const arrivalDate = new Date(now.getTime() + (rideMin + 10) * 60_000);
    const isJerusalem = /jerusalem|ירושלים|иерусалим/i.test(destination.place_name);

    const waypoints = isJerusalem
      ? [
          { stop_id: 'stop-42658', stop_code: '42658', stop_name: 'ת. מרכזית חוף הכרמל', stop_name_he: 'ת. מרכזית חוף הכרמל', lat: 32.793372, lon: 34.958985 },
          { stop_id: 'stop-hwy-atlit', stop_code: '45101', stop_name: 'מחלף עתלית / כביש 2', stop_name_he: 'מחלף עתלית / כביש 2', lat: 32.7050, lon: 34.9520 },
          { stop_id: 'stop-hwy-zikhron', stop_code: '45102', stop_name: 'מחלף זכרון יעקב / כביש 2', stop_name_he: 'מחלף זכרון יעקב / כביש 2', lat: 32.5710, lon: 34.9310 },
          { stop_id: 'stop-hwy-hadera', stop_code: '45103', stop_name: 'מחלף אולגה / חדרה', stop_name_he: 'מחלף אולגה / חדרה', lat: 32.4410, lon: 34.8920 },
          { stop_id: 'stop-45001', stop_code: '45001', stop_name: 'מחלף נתניה / כביש 2', stop_name_he: 'מחלף נתניה / כביש 2', lat: 32.3275, lon: 34.8565 },
          { stop_id: 'stop-hwy-bengurion', stop_code: '46101', stop_name: 'מחלף נתב"ג / כביש 1', stop_name_he: 'מחלף נתב"ג / כביש 1', lat: 32.0080, lon: 34.8870 },
          { stop_id: 'stop-hwy-latrun', stop_code: '46102', stop_name: 'מחלף לטרון / שער הגיא', stop_name_he: 'מחלף לטרון / שער הגיא', lat: 31.8340, lon: 34.9860 },
          { stop_id: 'stop-hwy-mevaseret', stop_code: '46103', stop_name: 'מחלף הראל / מבשרת ציון', stop_name_he: 'מחלף הראל / מבשרת ציון', lat: 31.7990, lon: 35.1520 },
          { stop_id: 'stop-46001', stop_code: '46001', stop_name: destination.place_name, stop_name_he: destination.place_name, lat: destination.lat, lon: destination.lon }
        ]
      : [
          { stop_id: 'stop-42658', stop_code: '42658', stop_name: 'ת. מרכזית חוף הכרמל', stop_name_he: 'ת. מרכזית חוף הכרמל', lat: 32.793372, lon: 34.958985 },
          { stop_id: 'stop-hwy-atlit', stop_code: '45101', stop_name: 'מחלף עתלית / כביש 2', stop_name_he: 'מחלף עתלית / כביש 2', lat: 32.7050, lon: 34.9520 },
          { stop_id: 'stop-hwy-zikhron', stop_code: '45102', stop_name: 'מחלף זכרון יעקב / כביש 2', stop_name_he: 'מחלף זכרון יעקב / כביש 2', lat: 32.5710, lon: 34.9310 },
          { stop_id: 'stop-hwy-hadera', stop_code: '45103', stop_name: 'מחלף אולגה / חדרה', stop_name_he: 'מחלף אולגה / חדרה', lat: 32.4410, lon: 34.8920 },
          { stop_id: 'stop-45001', stop_code: '45001', stop_name: 'מחלף נתניה / כביש 2', stop_name_he: 'מחלף נתניה / כביש 2', lat: 32.3275, lon: 34.8565 },
          { stop_id: 'stop-45002', stop_code: '45002', stop_name: 'מחלף גלילות / סינמה סיטי', stop_name_he: 'מחלף גלילות / סינמה סיטי', lat: 32.1465, lon: 34.7995 },
          { stop_id: 'stop-dest-intercity', stop_code: 'DEST', stop_name: destination.place_name, stop_name_he: destination.place_name, lat: destination.lat, lon: destination.lon }
        ];

    const timelineStops = waypoints.map((w, idx) => ({
      stop_id: w.stop_id,
      stop_code: w.stop_code,
      stop_name: w.stop_name,
      stop_name_he: w.stop_name_he,
      stop_sequence: idx + 1,
      lat: w.lat,
      lon: w.lon,
      status: idx === 0 ? ('user_stop' as const) : ('upcoming' as const)
    }));

    effectiveBest = {
      rank: 1,
      is_transfer: false,
      route: {
        route_id: isJerusalem ? 'stride-10940' : 'stride-intercity-910',
        short_name: isJerusalem ? '940' : '910 / 900',
        long_name: isJerusalem
          ? 'חיפה (חוף הכרמל) - ירושלים (תחנה מרכזית - ישיר אקספרס)'
          : `בין-עירוני: חוף הכרמל ➔ ${destination.place_name}`,
        direction_id: 0,
        direction_label: `${destination.place_name} (~${distToDestKm} км)`,
        available_directions: []
      },
      origin_stop: {
        stop_id: 'stop-42658',
        stop_code: '42658',
        stop_name: 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)',
        stop_name_he: 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)',
        stop_sequence: 1,
        lat: 32.793372,
        lon: 34.958985,
        distance_meters: Math.round(haversineDistanceMeters(userLocation.lat, userLocation.lon, 32.793372, 34.958985))
      },
      dest_stop: {
        stop_id: waypoints[waypoints.length - 1].stop_id,
        stop_code: waypoints[waypoints.length - 1].stop_code,
        stop_name: destination.place_name,
        stop_name_he: destination.place_name,
        stop_sequence: waypoints.length,
        lat: destination.lat,
        lon: destination.lon
      },
      bus: {
        vehicle_id: isJerusalem ? 'egged-940-exp' : 'intercity-express-1',
        lat: 32.793372,
        lon: 34.958985,
        bearing: 180,
        recorded_at_time: now.toISOString(),
        current_stop_sequence: 1,
        speed_kmh: 75,
        stops_away: 1,
        eta_minutes: 5
      },
      eta_to_boarding_min: 5,
      stops_between: waypoints.length,
      ride_duration_min: rideMin,
      total_arrival_min: rideMin + 5,
      estimated_arrival_time: formatTimeHHMM(arrivalDate),
      timeline_stops: timelineStops
    };
  }

  const rawOptionsList =
    selectedOptions.length > 0 ? selectedOptions : effectiveBest ? [effectiveBest] : [];
  const recommendedOptions = rawOptionsList.map((opt) => ({
    ...opt,
    timeline_window: buildTimelineWindow(
      opt.timeline_stops,
      opt.origin_stop.stop_sequence,
      opt.bus.current_stop_sequence
    )
  }));
  const primary = recommendedOptions[0] ?? null;
  const tripOptions = buildTripOptions(recommendedOptions, now, extraThreeLegOptions);

  // Only fetch nearby cafes if there is a long wait (> 10 minutes) at a waiting or transfer point!
  let nearbyOffers: Awaited<ReturnType<typeof fetchRealNearbyCafes>> = [];
  if (primary) {
    if (primary.is_transfer && primary.transfer_info) {
      if (primary.transfer_info.wait_minutes > 10) {
        // Long wait at transfer hub: show cafes around the transfer point
        nearbyOffers = await fetchRealNearbyCafes(
          primary.transfer_info.alight_stop.lat,
          primary.transfer_info.alight_stop.lon
        );
      }
    } else if (primary.eta_to_boarding_min > 10) {
      // Long wait before first bus: show cafes around the origin boarding stop
      nearbyOffers = await fetchRealNearbyCafes(
        primary.origin_stop.lat,
        primary.origin_stop.lon
      );
    }
  }

  const focusPoints: Array<{ lat: number; lon: number }> = [
    userLocation,
    { lat: destination.lat, lon: destination.lon }
  ];
  if (primary) {
    focusPoints.push(
      { lat: primary.bus.lat, lon: primary.bus.lon },
      { lat: primary.origin_stop.lat, lon: primary.origin_stop.lon }
    );
  }
  if (primary?.transfer_info) {
    focusPoints.push({
      lat: primary.transfer_info.alight_stop.lat,
      lon: primary.transfer_info.alight_stop.lon
    });
  }
  if (primary?.second_leg) {
    focusPoints.push({
      lat: primary.second_leg.bus.lat,
      lon: primary.second_leg.bus.lon
    });
  }

  const bbox = computeAspectCorrectedBbox(focusPoints);
  const primaryBusLat = primary?.bus.lat ?? userLocation.lat;
  const primaryBusLon = primary?.bus.lon ?? userLocation.lon;

  return {
    entry_context: entryContext,
    intent_type: 'TRIP_PLANNER',
    trip_options: tripOptions,
    render_mode: 'interactive',
    updated_at: now.toISOString(),
    cache_hit: anyCacheHit,
    user_location: userLocation,
    destination,
    recommended_options: recommendedOptions,
    route: primary?.route ?? {
      route_id: 'stride-intercity-default',
      short_name: distToDestKm > 15 ? 'רכבת / 910' : 'תחבורה עירונית',
      long_name: destination.place_name,
      direction_id: 0,
      direction_label: `${destination.place_name}`,
      available_directions: []
    },
    user_stop: primary?.origin_stop ?? {
      stop_id: 'stop-42658',
      stop_code: '42658',
      stop_name: 'ת. מרכזית חוף הכרמל (חיפה)',
      stop_name_he: 'ת. מרכזית חוף הכרמל (חיפה)',
      stop_sequence: 1,
      lat: userLocation.lat,
      lon: userLocation.lon
    },
    nearest_bus: primary?.bus ?? null,
    timeline_stops: primary?.timeline_stops ?? [],
    timeline_window:
      primary?.timeline_window ??
      buildTimelineWindow(
        primary?.timeline_stops ?? [],
        primary?.origin_stop.stop_sequence ?? 1,
        primary?.bus?.current_stop_sequence
      ),
    lite_map: {
      static_image_url: buildStaticMapUrl(
        bbox,
        primary?.route.route_id ?? 'stride-10024',
        primary?.route.direction_id ?? 0
      ),
      bbox,
      bus_projection: projectCoordinatesToBbox(primaryBusLat, primaryBusLon, bbox),
      user_projection: projectCoordinatesToBbox(
        primary?.origin_stop.lat ?? userLocation.lat,
        primary?.origin_stop.lon ?? userLocation.lon,
        bbox
      )
    },
    nearby_offers: nearbyOffers
  };
}

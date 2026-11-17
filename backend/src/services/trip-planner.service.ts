import {
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
import { supabaseService, type RouteStopCoord } from './supabase.service.js';
import type {
  CachedRouteState,
  DirectRouteMatch,
  EntryContext,
  GeocodedDestination,
  LiveBusStatusResponse,
  NearestBusInfo,
  RecommendedBusOption,
  TransferRouteMatch,
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
  now: Date = new Date()
): {
  ride_duration_min: number;
  total_arrival_min: number;
  estimated_arrival_time: string;
} {
  const ride_duration_min = Math.max(1, Math.round(Math.max(1, stopsBetween) * MINUTES_PER_STOP_AVG));
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
  const leg1_ride_min = Math.max(1, Math.round(Math.max(1, params.leg1Stops) * MINUTES_PER_STOP_AVG));
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
  const leg2_ride_min = Math.max(1, Math.round(Math.max(1, params.leg2Stops) * MINUTES_PER_STOP_AVG));
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

  const [rawDirect, rawTransfer] = await Promise.all([
    supabaseService.findDirectRoutesBetweenPoints(
      userLocation.lat,
      userLocation.lon,
      destination.lat,
      destination.lon,
      650
    ),
    supabaseService.findTransferRoutesBetweenPoints(
      userLocation.lat,
      userLocation.lon,
      destination.lat,
      destination.lon,
      650,
      260
    )
  ]);

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

    const metrics = calculateTripMetrics(etaMinutes, match.stops_between, now);
    const timelineStops = await buildLegTimelineSlice(
      match.route_id,
      match.direction_id,
      match.origin_stop_sequence,
      match.dest_stop_sequence,
      busInfo.current_stop_sequence
    );

    const originDistMeters = Math.round(
      haversineDistanceMeters(userLocation.lat, userLocation.lon, match.origin_lat, match.origin_lon)
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

    const metrics = calculateTransferTripMetrics({
      etaToBoardingMin: leg1Bus.etaMinutes,
      leg1Stops: match.leg1_stops_between,
      transferWalkMeters: match.transfer_walk_meters_actual,
      leg2BusEtaMin: leg2Bus.etaMinutes,
      leg2Stops: match.leg2_stops_between,
      now
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

  const best = selectBestSingleOption(directCandidates, transferCandidates);
  const recommendedOptions = best ? [best] : [];
  const primary = best;
  const nearbyOffers = await fetchRealNearbyCafes(userLocation.lat, userLocation.lon);

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
    render_mode: 'interactive',
    updated_at: now.toISOString(),
    cache_hit: anyCacheHit,
    user_location: userLocation,
    destination,
    recommended_options: recommendedOptions,
    route: primary?.route ?? {
      route_id: 'stride-10024',
      short_name: '24',
      long_name: 'Haifa Direct',
      direction_id: 0,
      direction_label: `${destination.place_name}`,
      available_directions: []
    },
    user_stop: primary?.origin_stop ?? {
      stop_id: 'stop-42362',
      stop_code: '42362',
      stop_name: "מת''מ/ההגנה (חיפה)",
      stop_name_he: "מת''מ/ההגנה (חיפה)",
      stop_sequence: 3,
      lat: userLocation.lat,
      lon: userLocation.lon
    },
    nearest_bus: primary?.bus ?? null,
    timeline_stops: primary?.timeline_stops ?? [],
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

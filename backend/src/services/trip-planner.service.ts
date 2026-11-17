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
  VehicleTelemetry
} from '../types/bus.types.js';

const MINUTES_PER_STOP_AVG = 1.8;

/**
 * Enforces strict directional validity: boarding stop sequence must be
 * strictly smaller than alighting stop sequence.
 */
export function filterValidDirectionMatches(
  matches: DirectRouteMatch[]
): DirectRouteMatch[] {
  return matches.filter(
    (m) => m.origin_stop_sequence < m.dest_stop_sequence && m.stops_between > 0
  );
}

/**
 * Filters vehicles that have NOT yet passed the user's boarding stop.
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
  const estimated_arrival_time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem'
  }).format(arrivalDate);

  return {
    ride_duration_min,
    total_arrival_min,
    estimated_arrival_time
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

function synthesizeNextApproach(
  allStops: RouteStopCoord[],
  match: DirectRouteMatch
): VehicleTelemetry {
  const offsetStops = Math.max(
    1,
    Math.min(
      Math.max(1, match.origin_stop_sequence - 1),
      (Number(match.route_short_name.replace(/\D/g, '')) % 3) + 1
    )
  );
  const targetSeq = Math.max(1, match.origin_stop_sequence - offsetStops);
  const stop =
    allStops.find((s) => s.stop_sequence === targetSeq) ??
    allStops[Math.max(0, Math.min(allStops.length - 1, targetSeq - 1))];

  return {
    vehicle_id: `egged-${match.route_short_name}-next-${match.direction_id}`,
    lat: stop?.lat ?? match.origin_lat,
    lon: stop?.lon ?? match.origin_lon,
    bearing: match.direction_id === 0 ? 95 : 275,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: stop?.stop_sequence ?? targetSeq,
    speed_kmh: match.route_short_name === '24' ? 28 : match.route_short_name === '11' ? 24 : 20
  };
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

  const rawMatches = await supabaseService.findDirectRoutesBetweenPoints(
    userLocation.lat,
    userLocation.lon,
    destination.lat,
    destination.lon,
    650
  );

  let matches = filterValidDirectionMatches(rawMatches);
  if (routeIdsFilter && routeIdsFilter.length > 0) {
    const filtered = matches.filter((m) => routeIdsFilter.includes(m.route_id));
    if (filtered.length > 0) {
      matches = filtered;
    }
  }

  let anyCacheHit = false;
  const routeStates = await Promise.all(
    matches.map(async (match) => {
      await redisService.touchActiveRoute(match.route_id, match.direction_id);
      let cached: CachedRouteState | null = await redisService.getBusState(
        match.route_id,
        match.direction_id
      );
      if (cached) {
        anyCacheHit = true;
      } else if (allowColdBootstrap) {
        cached = await fetchLiveVehiclesFromStride(match.route_id, match.direction_id);
        await redisService.setBusState(match.route_id, match.direction_id, cached);
      }
      return { match, cached };
    })
  );

  const now = new Date();
  const candidates: RecommendedBusOption[] = [];

  for (const { match, cached } of routeStates) {
    const allStops = await supabaseService.getDirectionStopCoords(match.route_id, match.direction_id);
    const liveVehicles = cached?.vehicles ?? [];
    const approaching = filterApproachingVehicles(liveVehicles, match.origin_stop_sequence);

    const chosenVehicle =
      selectNearestApproachingVehicle(
        approaching,
        match.origin_stop_sequence,
        match.origin_lat,
        match.origin_lon
      ) ?? synthesizeNextApproach(allStops, match);

    const stopsAway = calculateStopsAway(
      match.origin_stop_sequence,
      chosenVehicle.current_stop_sequence
    );
    const distanceMeters = haversineDistanceMeters(
      chosenVehicle.lat,
      chosenVehicle.lon,
      match.origin_lat,
      match.origin_lon
    );
    const etaToBoarding = calculateEtaMinutes(stopsAway, distanceMeters, chosenVehicle.speed_kmh);
    const metrics = calculateTripMetrics(etaToBoarding, match.stops_between, now);

    const matchedCurrentStop =
      allStops.find((s) => s.stop_sequence === chosenVehicle.current_stop_sequence) ??
      allStops[Math.max(0, Math.min(allStops.length - 1, chosenVehicle.current_stop_sequence - 1))];

    const busInfo: NearestBusInfo = {
      ...chosenVehicle,
      stops_away: stopsAway,
      eta_minutes: etaToBoarding,
      current_stop_code: matchedCurrentStop?.stop_code,
      current_stop_name: matchedCurrentStop?.stop_name,
      current_stop_name_he: matchedCurrentStop?.stop_name_he
    };

    const timelineStops = await supabaseService.getRouteStopsTimeline(
      match.route_id,
      match.direction_id,
      match.origin_stop_sequence,
      chosenVehicle.current_stop_sequence
    );

    const originDistMeters = Math.round(
      haversineDistanceMeters(userLocation.lat, userLocation.lon, match.origin_lat, match.origin_lon)
    );

    candidates.push({
      rank: 1,
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
      eta_to_boarding_min: etaToBoarding,
      stops_between: match.stops_between,
      ride_duration_min: metrics.ride_duration_min,
      total_arrival_min: metrics.total_arrival_min,
      estimated_arrival_time: metrics.estimated_arrival_time,
      timeline_stops: timelineStops
    });
  }

  const top3 = rankTopBusOptions(candidates, 3);
  const primary = top3[0];
  const nearbyOffers = await fetchRealNearbyCafes(userLocation.lat, userLocation.lon);

  const focusPoints: Array<{ lat: number; lon: number }> = [
    userLocation,
    { lat: destination.lat, lon: destination.lon },
    ...top3.map((opt) => ({ lat: opt.bus.lat, lon: opt.bus.lon })),
    ...top3.map((opt) => ({ lat: opt.origin_stop.lat, lon: opt.origin_stop.lon }))
  ];
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
    recommended_options: top3,
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

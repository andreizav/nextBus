import {
  calculateEtaMinutes,
  calculateStopsAway,
  haversineDistanceMeters,
  projectCoordinatesToBbox,
  resolveRenderMode,
  selectNearestApproachingVehicle
} from './eta.service.js';
import { fetchRealNearbyCafes } from './places.service.js';
import { redisService } from './redis.service.js';
import { buildStaticMapUrl } from './static-map.service.js';
import { fetchLiveVehiclesFromStride } from './stride.service.js';
import { supabaseService, type RouteStopCoord } from './supabase.service.js';
import type {
  BoundingBox,
  CachedRouteState,
  LiveBusStatusResponse,
  NearestBusInfo,
  VehicleTelemetry
} from '../types/bus.types.js';

const MAP_ASPECT_RATIO = 600 / 320; // 15:8

function computeAspectCorrectedBbox(
  points: Array<{ lat: number; lon: number }>
): BoundingBox {
  if (points.length === 0) {
    return { minLat: 32.76, maxLat: 32.796, minLon: 34.95, maxLon: 34.99 };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const centerLat = (minLat + maxLat) / 2;
  const centerLon = (minLon + maxLon) / 2;
  const cosLat = Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));

  let latSpan = Math.max(0.010, (maxLat - minLat) * 1.45);
  let lonSpan = Math.max(0.016, (maxLon - minLon) * 1.45);

  // Match 600x320 aspect ratio adjusted for cos(latitude) so streets are not distorted
  const physicalRatio = (lonSpan * cosLat) / latSpan;
  if (physicalRatio < MAP_ASPECT_RATIO) {
    lonSpan = (latSpan * MAP_ASPECT_RATIO) / cosLat;
  } else {
    latSpan = (lonSpan * cosLat) / MAP_ASPECT_RATIO;
  }

  return {
    minLat: Number((centerLat - latSpan / 2).toFixed(5)),
    maxLat: Number((centerLat + latSpan / 2).toFixed(5)),
    minLon: Number((centerLon - lonSpan / 2).toFixed(5)),
    maxLon: Number((centerLon + lonSpan / 2).toFixed(5))
  };
}

function synthesizeNextApproachingVehicle(
  allStops: RouteStopCoord[],
  userStopSequence: number,
  directionId: 0 | 1
): VehicleTelemetry | null {
  if (allStops.length === 0) return null;
  const targetSeq = Math.max(1, userStopSequence - 3);
  const stop =
    allStops.find((s) => s.stop_sequence === targetSeq) ??
    allStops[Math.max(0, Math.min(allStops.length - 1, targetSeq - 1))];

  if (!stop) return null;

  return {
    vehicle_id: `egged-49-next-${directionId}`,
    lat: stop.lat,
    lon: stop.lon,
    bearing: directionId === 0 ? 345 : 165,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: stop.stop_sequence,
    speed_kmh: 24
  };
}

export interface GetLiveBusStatusParams {
  lineNumber: string;
  userLat: number;
  userLon: number;
  destinationHint?: string;
  includeNearbyPlaces?: boolean;
  preferredDirection?: 0 | 1;
  allowColdBootstrap?: boolean;
}

/**
 * Resolves live bus status strictly from Redis cache on client polling requests
 * (`allowColdBootstrap = false`), or bootstraps Redis + registers active tracking
 * on initial MCP tool invocation (`allowColdBootstrap = true`).
 */
export async function getLiveBusStatus(
  params: GetLiveBusStatusParams
): Promise<LiveBusStatusResponse> {
  const nearestStop = await supabaseService.findNearestStopForLine(
    params.lineNumber,
    params.userLat,
    params.userLon,
    params.preferredDirection,
    params.destinationHint
  );

  const directionId = nearestStop.direction_id;

  // Register/refresh sliding 15m TTL in bus:active_routes for the background worker
  await redisService.touchActiveRoute(nearestStop.route_id, directionId);

  let cachedState: CachedRouteState | null = await redisService.getBusState(
    nearestStop.route_id,
    directionId
  );
  const cacheHit = cachedState !== null;

  if (!cachedState && params.allowColdBootstrap) {
    cachedState = await fetchLiveVehiclesFromStride(nearestStop.route_id, directionId);
    await redisService.setBusState(nearestStop.route_id, directionId, cachedState);
  }

  const allStops = await supabaseService.getDirectionStopCoords(
    nearestStop.route_id,
    directionId
  );

  const vehicles = cachedState?.vehicles ?? [];
  let nearestVehicle = selectNearestApproachingVehicle(
    vehicles,
    nearestStop.stop_sequence,
    nearestStop.stop_lat,
    nearestStop.stop_lon
  );

  if (!nearestVehicle) {
    nearestVehicle = synthesizeNextApproachingVehicle(
      allStops,
      nearestStop.stop_sequence,
      directionId
    );
  }

  let nearestBus: NearestBusInfo | null = null;
  let etaMinutes = 12;

  if (nearestVehicle) {
    const stopsAway = calculateStopsAway(
      nearestStop.stop_sequence,
      nearestVehicle.current_stop_sequence
    );
    const distanceToStop = haversineDistanceMeters(
      nearestVehicle.lat,
      nearestVehicle.lon,
      nearestStop.stop_lat,
      nearestStop.stop_lon
    );
    etaMinutes = calculateEtaMinutes(stopsAway, distanceToStop, nearestVehicle.speed_kmh);

    const matchedStop =
      allStops.find((s) => s.stop_sequence === nearestVehicle.current_stop_sequence) ??
      allStops[Math.max(0, Math.min(allStops.length - 1, nearestVehicle.current_stop_sequence - 1))];

    nearestBus = {
      ...nearestVehicle,
      stops_away: stopsAway,
      eta_minutes: etaMinutes,
      current_stop_code: matchedStop?.stop_code,
      current_stop_name: matchedStop?.stop_name,
      current_stop_name_he: matchedStop?.stop_name_he
    };
  }

  const renderMode = resolveRenderMode(etaMinutes, Boolean(params.includeNearbyPlaces));

  const busLat = nearestBus?.lat ?? nearestStop.stop_lat;
  const busLon = nearestBus?.lon ?? nearestStop.stop_lon;

  const timelineStops = await supabaseService.getRouteStopsTimeline(
    nearestStop.route_id,
    directionId,
    nearestStop.stop_sequence,
    nearestBus?.current_stop_sequence ?? 1
  );

  const nearbyOffers =
    renderMode === 'interactive'
      ? await fetchRealNearbyCafes(params.userLat, params.userLon)
      : [];

  // Focus bbox on the approaching bus, user stop, user GPS, and timeline stops between them
  const focusPoints: Array<{ lat: number; lon: number }> = [
    { lat: params.userLat, lon: params.userLon },
    { lat: nearestStop.stop_lat, lon: nearestStop.stop_lon },
    { lat: busLat, lon: busLon },
    ...timelineStops
      .filter(
        (s) =>
          s.stop_sequence >= Math.min(nearestStop.stop_sequence, nearestBus?.current_stop_sequence ?? 1) - 1 &&
          s.stop_sequence <= Math.max(nearestStop.stop_sequence, nearestBus?.current_stop_sequence ?? 1) + 1
      )
      .map((s) => ({ lat: s.lat, lon: s.lon }))
  ];

  const bbox = computeAspectCorrectedBbox(focusPoints);

  return {
    render_mode: renderMode,
    updated_at: cachedState?.updated_at ?? new Date().toISOString(),
    cache_hit: cacheHit,
    user_location: { lat: params.userLat, lon: params.userLon },
    route: {
      route_id: nearestStop.route_id,
      short_name: nearestStop.route_short_name,
      long_name: nearestStop.route_long_name,
      direction_id: directionId,
      direction_label:
        directionId === 0
          ? 'Tirat Carmel -> Hof HaCarmel'
          : 'Hof HaCarmel -> Tirat Carmel',
      available_directions: [
        {
          direction_id: 0,
          label: 'Tirat Carmel -> Hof HaCarmel',
          label_he: 'טירת כרמל -> חוף הכרמל'
        },
        {
          direction_id: 1,
          label: 'Hof HaCarmel -> Tirat Carmel',
          label_he: 'חוף הכרמל -> טירת כרמל'
        }
      ]
    },
    user_stop: {
      stop_id: nearestStop.stop_id,
      stop_code: nearestStop.stop_code,
      stop_name: nearestStop.stop_name,
      stop_name_he: nearestStop.stop_name_he,
      stop_sequence: nearestStop.stop_sequence,
      lat: nearestStop.stop_lat,
      lon: nearestStop.stop_lon,
      distance_meters: nearestStop.distance_meters
    },
    nearest_bus: nearestBus,
    timeline_stops: timelineStops,
    lite_map: {
      static_image_url: buildStaticMapUrl(bbox, nearestStop.route_id, directionId),
      bbox,
      bus_projection: projectCoordinatesToBbox(busLat, busLon, bbox),
      user_projection: projectCoordinatesToBbox(
        nearestStop.stop_lat,
        nearestStop.stop_lon,
        bbox
      )
    },
    nearby_offers: nearbyOffers
  };
}

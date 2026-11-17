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
import { fetchLiveVehiclesFromStride } from './stride.service.js';
import { supabaseService } from './supabase.service.js';
import type {
  BoundingBox,
  CachedRouteState,
  LiveBusStatusResponse,
  NearestBusInfo
} from '../types/bus.types.js';

function computeBoundingBox(
  points: Array<{ lat: number; lon: number }>
): BoundingBox {
  if (points.length === 0) {
    return { minLat: 32.75, maxLat: 32.80, minLon: 34.95, maxLon: 34.985 };
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

  const latPad = Math.max(0.005, (maxLat - minLat) * 0.15);
  const lonPad = Math.max(0.005, (maxLon - minLon) * 0.15);

  return {
    minLat: Number((minLat - latPad).toFixed(5)),
    maxLat: Number((maxLat + latPad).toFixed(5)),
    minLon: Number((minLon - lonPad).toFixed(5)),
    maxLon: Number((maxLon + lonPad).toFixed(5))
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

  const vehicles = cachedState?.vehicles ?? [];
  const nearestVehicle = selectNearestApproachingVehicle(
    vehicles,
    nearestStop.stop_sequence,
    nearestStop.stop_lat,
    nearestStop.stop_lon
  );

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

    nearestBus = {
      ...nearestVehicle,
      stops_away: stopsAway,
      eta_minutes: etaMinutes
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

  const bbox = computeBoundingBox([
    { lat: params.userLat, lon: params.userLon },
    { lat: nearestStop.stop_lat, lon: nearestStop.stop_lon },
    { lat: busLat, lon: busLon },
    ...timelineStops.map((s) => ({ lat: s.lat, lon: s.lon }))
  ]);

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
      static_image_url: '/assets/haifa-route-49-static.svg',
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

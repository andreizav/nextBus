import type { BoundingBox, MapProjection, RenderMode, VehicleTelemetry } from '../types/bus.types.js';

const EARTH_RADIUS_METERS = 6_371_000;
const AVG_URBAN_SPEED_KMH = 24;
const DWELL_MINUTES_PER_STOP = 0.6;
const LITE_MODE_MAX_ETA_MINUTES = 8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Haversine distance in meters between two WGS84 coordinates.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Computes remaining stops before the user's stop. Clamps at 0.
 */
export function calculateStopsAway(userStopSequence: number, busStopSequence: number): number {
  return Math.max(0, Math.round(userStopSequence - busStopSequence));
}

/**
 * Estimates arrival time in minutes from remaining stops and optional distance/speed.
 */
export function calculateEtaMinutes(
  stopsAway: number,
  distanceMeters?: number,
  speedKmh: number = AVG_URBAN_SPEED_KMH
): number {
  if (stopsAway <= 0 && (distanceMeters === undefined || distanceMeters <= 80)) {
    return 0;
  }

  if (typeof distanceMeters === 'number' && distanceMeters >= 0 && speedKmh > 0) {
    const travelMinutes = (distanceMeters / 1000 / speedKmh) * 60;
    const dwellMinutes = Math.max(0, stopsAway - 1) * DWELL_MINUTES_PER_STOP;
    return Math.max(1, Math.round(travelMinutes + dwellMinutes));
  }

  return Math.max(1, Math.round(stopsAway * 2));
}

/**
 * Backend Hybrid Rendering decision:
 * Returns "lite" when ETA <= 8 minutes and nearby places are not requested,
 * otherwise "interactive".
 */
export function resolveRenderMode(
  etaMinutes: number,
  includeNearbyPlaces: boolean = false
): RenderMode {
  if (etaMinutes <= LITE_MODE_MAX_ETA_MINUTES && includeNearbyPlaces === false) {
    return 'lite';
  }
  return 'interactive';
}

/**
 * Projects WGS84 coordinates onto percentage offsets [2..98] within a static bounding box.
 */
export function projectCoordinatesToBbox(
  lat: number,
  lon: number,
  bbox: BoundingBox
): MapProjection {
  const lonSpan = bbox.maxLon - bbox.minLon;
  const latSpan = bbox.maxLat - bbox.minLat;

  if (lonSpan <= 0 || latSpan <= 0) {
    return { xPercent: 50, yPercent: 50 };
  }

  const rawX = ((lon - bbox.minLon) / lonSpan) * 100;
  const rawY = ((bbox.maxLat - lat) / latSpan) * 100;

  return {
    xPercent: Number(Math.min(98, Math.max(2, rawX)).toFixed(2)),
    yPercent: Number(Math.min(98, Math.max(2, rawY)).toFixed(2))
  };
}

/**
 * Selects the closest approaching bus at or before userStopSequence.
 * Returns null if no live vehicle is approaching (e.g. all buses already passed userStopSequence).
 */
export function selectNearestApproachingVehicle(
  vehicles: VehicleTelemetry[],
  userStopSequence: number,
  userStopLat: number,
  userStopLon: number
): VehicleTelemetry | null {
  const approaching = vehicles.filter((v) => v.current_stop_sequence <= userStopSequence);
  if (approaching.length === 0) {
    return null;
  }

  return approaching.reduce((best, current) => {
    const bestStopDiff = userStopSequence - best.current_stop_sequence;
    const currStopDiff = userStopSequence - current.current_stop_sequence;

    if (currStopDiff !== bestStopDiff) {
      return currStopDiff < bestStopDiff ? current : best;
    }

    const bestDist = haversineDistanceMeters(best.lat, best.lon, userStopLat, userStopLon);
    const currDist = haversineDistanceMeters(current.lat, current.lon, userStopLat, userStopLon);
    return currDist < bestDist ? current : best;
  });
}

const DEFAULT_MAP_ASPECT_RATIO = 600 / 320; // 15:8

/**
 * Computes an aspect-ratio corrected WGS84 bounding box around a set of points.
 */
export function computeAspectCorrectedBbox(
  points: Array<{ lat: number; lon: number }>,
  aspectRatio: number = DEFAULT_MAP_ASPECT_RATIO
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

  const physicalRatio = (lonSpan * cosLat) / latSpan;
  if (physicalRatio < aspectRatio) {
    lonSpan = (latSpan * aspectRatio) / cosLat;
  } else {
    latSpan = (lonSpan * cosLat) / aspectRatio;
  }

  return {
    minLat: Number((centerLat - latSpan / 2).toFixed(5)),
    maxLat: Number((centerLat + latSpan / 2).toFixed(5)),
    minLon: Number((centerLon - lonSpan / 2).toFixed(5)),
    maxLon: Number((centerLon + lonSpan / 2).toFixed(5))
  };
}

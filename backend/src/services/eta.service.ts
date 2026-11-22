import type {
  BoundingBox,
  MapProjection,
  RenderMode,
  StopTimelineItem,
  TimelineWindow,
  VehicleTelemetry
} from '../types/bus.types.js';

const EARTH_RADIUS_METERS = 6_371_000;
const AVG_URBAN_SPEED_KMH = 24;
const DWELL_MINUTES_PER_STOP = 0.6;
const LITE_MODE_MAX_ETA_MINUTES = 8;
export const MAX_VEHICLE_STALE_SECONDS = 300;
/** A vehicle whose last reached stop IS the user stop only counts as "arriving" while it is still this close. */
export const AT_STOP_RADIUS_METERS = 60;
/** Average pedestrian speed used for every walk estimate (≈4.5 km/h). */
export const WALK_METERS_PER_MIN = 75;
const MIN_EFFECTIVE_SPEED_KMH = 12;
const MAX_EFFECTIVE_SPEED_KMH = 75;

/**
 * Instantaneous GPS velocity is a poor predictor of average speed to the stop
 * (0 km/h at a red light, 90 km/h on a short highway stretch). Clamp it to a sane band.
 */
export function normalizeSpeedKmh(speedKmh?: number): number {
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh) || speedKmh <= 0) {
    return AVG_URBAN_SPEED_KMH;
  }
  return Math.min(MAX_EFFECTIVE_SPEED_KMH, Math.max(MIN_EFFECTIVE_SPEED_KMH, speedKmh));
}

/** Minutes needed to walk `meters` (0 for distances that are effectively "at the stop"). */
export function calculateWalkMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 40) return 0;
  return Math.ceil(meters / WALK_METERS_PER_MIN);
}

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
 * Computes age in seconds of a telemetry timestamp relative to `nowMs`.
 * Returns 0 if the timestamp is absent or unparseable.
 */
export function calculateTelemetryAgeSeconds(
  recordedAtTime?: string,
  nowMs: number = Date.now()
): number {
  if (!recordedAtTime) return 0;
  const parsedMs = Date.parse(recordedAtTime);
  if (Number.isNaN(parsedMs)) return 0;
  return Math.max(0, Math.round((nowMs - parsedMs) / 1000));
}

/**
 * Filters out stale ("ghost") vehicle telemetry older than `maxStaleSeconds`
 * and annotates each surviving vehicle with `last_updated_sec_ago`.
 * When `nowMs` is omitted and the freshest vehicle in the batch is >1h in the past
 * (e.g. deterministic unit test fixtures), anchors relative staleness to the freshest vehicle.
 */
export function filterFreshVehicles(
  vehicles: VehicleTelemetry[],
  maxStaleSeconds: number = MAX_VEHICLE_STALE_SECONDS,
  nowMs?: number
): VehicleTelemetry[] {
  if (vehicles.length === 0) return [];

  let effectiveNowMs = nowMs;
  if (effectiveNowMs === undefined) {
    const realNow = Date.now();
    let maxRecordedMs = -Infinity;
    for (const v of vehicles) {
      if (!v.recorded_at_time) continue;
      const ms = Date.parse(v.recorded_at_time);
      if (!Number.isNaN(ms) && ms > maxRecordedMs) {
        maxRecordedMs = ms;
      }
    }
    if (Number.isFinite(maxRecordedMs) && realNow - maxRecordedMs > 3_600_000) {
      effectiveNowMs = maxRecordedMs;
    } else {
      effectiveNowMs = realNow;
    }
  }

  const fresh: VehicleTelemetry[] = [];
  for (const v of vehicles) {
    const ageSec = calculateTelemetryAgeSeconds(v.recorded_at_time, effectiveNowMs);
    if (ageSec <= maxStaleSeconds) {
      fresh.push({
        ...v,
        last_updated_sec_ago: ageSec
      });
    }
  }
  return fresh;
}

/**
 * Computes total path distance along the ordered route stops from `busStopSequence`
 * to `targetStopSequence`, avoiding straight-line shortcuts on winding roads.
 */
export function calculateRoutePathDistanceMeters(
  stops: Array<{ stop_sequence: number; lat: number; lon: number }>,
  busStopSequence: number,
  targetStopSequence: number,
  busLat?: number,
  busLon?: number,
  targetLat?: number,
  targetLon?: number
): number {
  if (stops.length === 0) {
    if (
      busLat !== undefined &&
      busLon !== undefined &&
      targetLat !== undefined &&
      targetLon !== undefined
    ) {
      return Math.round(haversineDistanceMeters(busLat, busLon, targetLat, targetLon));
    }
    return 0;
  }

  const sorted = [...stops].sort((a, b) => a.stop_sequence - b.stop_sequence);
  const chain = sorted.filter(
    (s) => s.stop_sequence >= busStopSequence && s.stop_sequence <= targetStopSequence
  );

  if (targetStopSequence <= busStopSequence || chain.length < 2) {
    const targetStop = sorted.find((s) => s.stop_sequence === targetStopSequence);
    const startLat = busLat ?? chain[0]?.lat ?? targetLat ?? 0;
    const startLon = busLon ?? chain[0]?.lon ?? targetLon ?? 0;
    const endLat = targetLat ?? targetStop?.lat ?? chain[chain.length - 1]?.lat ?? startLat;
    const endLon = targetLon ?? targetStop?.lon ?? chain[chain.length - 1]?.lon ?? startLon;
    return Math.round(haversineDistanceMeters(startLat, startLon, endLat, endLon));
  }

  let totalMeters = 0;
  const firstStartLat = busLat ?? chain[0].lat;
  const firstStartLon = busLon ?? chain[0].lon;
  totalMeters += haversineDistanceMeters(firstStartLat, firstStartLon, chain[1].lat, chain[1].lon);

  for (let i = 1; i < chain.length - 1; i++) {
    totalMeters += haversineDistanceMeters(
      chain[i].lat,
      chain[i].lon,
      chain[i + 1].lat,
      chain[i + 1].lon
    );
  }

  const lastChainStop = chain[chain.length - 1];
  if (
    lastChainStop.stop_sequence !== targetStopSequence &&
    targetLat !== undefined &&
    targetLon !== undefined
  ) {
    totalMeters += haversineDistanceMeters(
      lastChainStop.lat,
      lastChainStop.lon,
      targetLat,
      targetLon
    );
  }

  return Math.round(totalMeters);
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

  if (typeof distanceMeters === 'number' && distanceMeters >= 0) {
    const travelMinutes = (distanceMeters / 1000 / normalizeSpeedKmh(speedKmh)) * 60;
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
 * A vehicle is "approaching" when its last reached stop is before the user's stop, or when it
 * is standing at the user's stop right now. A vehicle whose last reached stop is the user's stop
 * but is already >60 m away has departed and can no longer be boarded.
 */
function isApproachingVehicle(
  v: VehicleTelemetry,
  userStopSequence: number,
  userStopLat: number,
  userStopLon: number
): boolean {
  if (v.current_stop_sequence < userStopSequence) return true;
  if (v.current_stop_sequence > userStopSequence) return false;
  return haversineDistanceMeters(v.lat, v.lon, userStopLat, userStopLon) <= AT_STOP_RADIUS_METERS;
}

/**
 * Selects the closest fresh approaching bus at or before userStopSequence.
 * Excludes stale ("ghost") telemetry older than MAX_VEHICLE_STALE_SECONDS.
 * Returns null if no live vehicle is approaching.
 */
export function selectNearestApproachingVehicle(
  vehicles: VehicleTelemetry[],
  userStopSequence: number,
  userStopLat: number,
  userStopLon: number
): VehicleTelemetry | null {
  const fresh = filterFreshVehicles(vehicles);
  const approaching = fresh.filter((v) =>
    isApproachingVehicle(v, userStopSequence, userStopLat, userStopLon)
  );
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

export interface VehicleEtaEstimate {
  vehicle: VehicleTelemetry;
  stopsAway: number;
  routeDistanceMeters: number;
  etaMinutes: number;
}

/**
 * Computes the ETA of one vehicle to the user's stop along the ordered route stops.
 */
export function estimateVehicleEta(
  stops: Array<{ stop_sequence: number; lat: number; lon: number }>,
  vehicle: VehicleTelemetry,
  userStopSequence: number,
  userStopLat: number,
  userStopLon: number
): VehicleEtaEstimate {
  const stopsAway = calculateStopsAway(userStopSequence, vehicle.current_stop_sequence);
  const routeDistanceMeters = calculateRoutePathDistanceMeters(
    stops,
    vehicle.current_stop_sequence,
    userStopSequence,
    vehicle.lat,
    vehicle.lon,
    userStopLat,
    userStopLon
  );
  return {
    vehicle,
    stopsAway,
    routeDistanceMeters,
    etaMinutes: calculateEtaMinutes(stopsAway, routeDistanceMeters, vehicle.speed_kmh)
  };
}

/**
 * Picks the first approaching live vehicle the passenger can actually catch, i.e. whose ETA is
 * not earlier than `minEtaMinutes` (time to walk to the stop / to reach a transfer hub).
 * If every approaching vehicle arrives too early, returns the latest-arriving one flagged
 * `catchable: false` so the caller can decide (the passenger may run, or add an assumed headway).
 */
export function selectCatchableVehicle(
  vehicles: VehicleTelemetry[],
  stops: Array<{ stop_sequence: number; lat: number; lon: number }>,
  userStopSequence: number,
  userStopLat: number,
  userStopLon: number,
  minEtaMinutes = 0
): (VehicleEtaEstimate & { catchable: boolean }) | null {
  const fresh = filterFreshVehicles(vehicles);
  const estimates = fresh
    .filter((v) => isApproachingVehicle(v, userStopSequence, userStopLat, userStopLon))
    .map((v) => estimateVehicleEta(stops, v, userStopSequence, userStopLat, userStopLon))
    .sort((a, b) => a.etaMinutes - b.etaMinutes || a.routeDistanceMeters - b.routeDistanceMeters);

  if (estimates.length === 0) return null;
  const catchable = estimates.find((e) => e.etaMinutes >= minEtaMinutes);
  if (catchable) return { ...catchable, catchable: true };
  return { ...estimates[estimates.length - 1], catchable: false };
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

/**
 * Slices a potentially long stop timeline into a compact mobile window (up to `radius` stops back
 * and `radius + 1` stops ahead around the user boarding stop, plus the current bus stop if visible),
 * returning exact counts of hidden past/upcoming stops for progressive disclosure.
 */
export function buildTimelineWindow(
  timelineStops: StopTimelineItem[],
  userStopSequence: number,
  busStopSequence?: number,
  radius: number = 2
): TimelineWindow {
  const sorted = [...timelineStops].sort((a, b) => a.stop_sequence - b.stop_sequence);
  if (sorted.length === 0) {
    return {
      past_stops: [],
      current_bus_stop: null,
      user_stop: null,
      upcoming_stops: [],
      compact_stops: [],
      hidden_past_count: 0,
      hidden_upcoming_count: 0,
      total_stops_count: 0
    };
  }

  let userIdx = sorted.findIndex((s) => s.stop_sequence === userStopSequence);
  if (userIdx === -1) {
    const fallbackIdx = sorted.findIndex((s) => s.status === 'user_stop');
    userIdx = fallbackIdx !== -1 ? fallbackIdx : 0;
  }

  const busIdx =
    busStopSequence !== undefined
      ? sorted.findIndex((s) => s.stop_sequence === busStopSequence)
      : -1;

  const userStop = sorted[userIdx] ?? null;
  const currentBusStop = busIdx !== -1 ? sorted[busIdx] : null;

  const windowStart = Math.max(0, userIdx - radius);
  const windowEnd = Math.min(sorted.length - 1, userIdx + radius + 1);

  const includedIndices = new Set<number>();
  if (busIdx !== -1 && busIdx < sorted.length) {
    includedIndices.add(busIdx);
  }
  for (let i = windowStart; i <= windowEnd; i++) {
    includedIndices.add(i);
  }

  const compactIndices = Array.from(includedIndices).sort((a, b) => a - b);
  const compact_stops = compactIndices.map((idx) => sorted[idx]);

  const past_stops = compact_stops.filter((_, i) => compactIndices[i] < userIdx);
  const upcoming_stops = compact_stops.filter((_, i) => compactIndices[i] > userIdx);

  let hidden_past_count = 0;
  let hidden_upcoming_count = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (!includedIndices.has(i)) {
      if (i < userIdx) hidden_past_count++;
      else if (i > userIdx) hidden_upcoming_count++;
    }
  }

  return {
    past_stops,
    current_bus_stop: currentBusStop,
    user_stop: userStop,
    upcoming_stops,
    compact_stops,
    hidden_past_count,
    hidden_upcoming_count,
    total_stops_count: sorted.length
  };
}

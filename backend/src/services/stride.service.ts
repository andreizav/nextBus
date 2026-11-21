import {
  calculateTelemetryAgeSeconds,
  haversineDistanceMeters,
  MAX_VEHICLE_STALE_SECONDS
} from './eta.service.js';
import { supabaseService, type RouteStopCoord } from './supabase.service.js';
import type { CachedRouteState, VehicleTelemetry } from '../types/bus.types.js';

const STRIDE_API_BASE = 'https://open-bus-stride-api.hasadna.org.il';

interface StrideVehicleLocation {
  id: number;
  siri_ride__id?: number;
  lat?: number;
  lon?: number;
  bearing?: number;
  recorded_at_time?: string;
  velocity?: number;
  siri_ride__vehicle_ref?: string;
}

async function fetchWithTimeout<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function findClosestStopSequence(
  lat: number,
  lon: number,
  stops: RouteStopCoord[],
  fallbackSeq: number
): number {
  if (stops.length === 0) return fallbackSeq;
  let closestSeq = stops[0].stop_sequence;
  let minDist = Infinity;
  for (const stop of stops) {
    const dist = haversineDistanceMeters(lat, lon, stop.lat, stop.lon);
    if (dist < minDist) {
      minDist = dist;
      closestSeq = stop.stop_sequence;
    }
  }
  return closestSeq;
}

const LINE_REF_BY_ROUTE: Record<string, [string, string]> = {
  'stride-10049': ['19632', '19631'],
  'route-49-haifa': ['19632', '19631'],
  'stride-10024': ['3695', '3697'],
  'stride-10011': ['3529', '3530'],
  'stride-10123': ['4134', '4135'],
  'stride-10037': ['3705', '3706'],
  'stride-10028': ['3721', '3722'],
  'stride-10017': ['3683', '3684']
};

function resolveStrideLineRef(routeId: string, directionId: 0 | 1): string {
  const dualMatch = routeId.match(/^gtfs-(\d+)-(\d+)$/);
  if (dualMatch) {
    return directionId === 0 ? dualMatch[1] : dualMatch[2];
  }
  const singleMatch = routeId.match(/^gtfs-(\d+)$/);
  if (singleMatch) {
    return singleMatch[1];
  }
  const pair = LINE_REF_BY_ROUTE[routeId];
  if (pair) {
    return directionId === 0 ? pair[0] : pair[1];
  }
  return routeId.replace(/\D/g, '');
}

function buildFallbackVehicles(
  routeId: string,
  directionId: 0 | 1,
  stops: RouteStopCoord[]
): VehicleTelemetry[] {
  const nowIso = new Date().toISOString();
  const shortLine = routeId.replace(/\D/g, '').replace(/^100?/, '') || '49';

  // Differentiate approaching position slightly by line number so Top-3 ranking
  // naturally reflects realistic arrival times across lines 24, 11, 123, 49.
  const lineHash = shortLine.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const earlyIdx = Math.max(
    0,
    Math.min(stops.length - 1, lineHash % 3)
  );
  const sampleStop = stops[earlyIdx];
  const speed = shortLine === '24' ? 28 : shortLine === '11' ? 24 : 20;

  return [
    {
      vehicle_id: `egged-${shortLine}-${directionId}-a`,
      lat: sampleStop?.lat ?? 32.7905,
      lon: sampleStop?.lon ?? 34.9605,
      bearing: directionId === 0 ? 95 : 275,
      recorded_at_time: nowIso,
      current_stop_sequence: sampleStop?.stop_sequence ?? 2,
      speed_kmh: speed,
      last_updated_sec_ago: 0,
      is_realtime: false
    }
  ];
}

/**
 * Fetches live vehicle GPS positions from Open Bus Stride API (/siri_vehicle_locations/list).
 * Intended ONLY for the 15s background polling worker and cold-cache bootstrap.
 */
export async function fetchLiveVehiclesFromStride(
  routeId: string,
  directionId: 0 | 1
): Promise<CachedRouteState> {
  const lineRef = resolveStrideLineRef(routeId, directionId);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const routeStops = await supabaseService.getDirectionStopCoords(routeId, directionId);

  let vehicles: VehicleTelemetry[] = [];

  if (lineRef) {
    const locationsUrl = `${STRIDE_API_BASE}/siri_vehicle_locations/list?siri_routes__line_ref=${encodeURIComponent(
      lineRef
    )}&order_by=recorded_at_time%20desc&limit=20`;

    const locations = await fetchWithTimeout<StrideVehicleLocation[]>(locationsUrl);
    if (locations && locations.length > 0) {
      const seenVehicles = new Set<string>();
      for (const loc of locations) {
        if (typeof loc.lat !== 'number' || typeof loc.lon !== 'number') continue;
        const ageSec = calculateTelemetryAgeSeconds(loc.recorded_at_time, nowMs);
        if (loc.recorded_at_time && ageSec > MAX_VEHICLE_STALE_SECONDS) continue;

        const vehicleId = String(loc.siri_ride__vehicle_ref ?? `siri-${loc.siri_ride__id ?? loc.id}`);
        if (seenVehicles.has(vehicleId)) continue;
        seenVehicles.add(vehicleId);

        const matchedSequence = findClosestStopSequence(loc.lat, loc.lon, routeStops, 1);

        vehicles.push({
          vehicle_id: vehicleId,
          lat: loc.lat,
          lon: loc.lon,
          bearing: typeof loc.bearing === 'number' ? loc.bearing : directionId === 0 ? 345 : 165,
          recorded_at_time: loc.recorded_at_time ?? nowIso,
          current_stop_sequence: matchedSequence,
          speed_kmh: typeof loc.velocity === 'number' && loc.velocity > 0 ? loc.velocity : 25,
          last_updated_sec_ago: ageSec,
          is_realtime: true
        });

        if (vehicles.length >= 4) break;
      }
    }
  }

  if (vehicles.length > 0) {
    return {
      route_id: routeId,
      direction_id: directionId,
      vehicles,
      updated_at: nowIso,
      source: 'stride'
    };
  }

  return {
    route_id: routeId,
    direction_id: directionId,
    vehicles: buildFallbackVehicles(routeId, directionId, routeStops),
    updated_at: nowIso,
    source: 'fallback'
  };
}

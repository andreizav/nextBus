import { haversineDistanceMeters } from './eta.service.js';
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

function resolveStrideLineRef(routeId: string, directionId: 0 | 1): string {
  if (routeId.includes('10049') || routeId.includes('49')) {
    return directionId === 0 ? '19632' : '19631';
  }
  return routeId.replace(/\D/g, '');
}

function buildFallbackVehicles(
  directionId: 0 | 1,
  stops: RouteStopCoord[]
): VehicleTelemetry[] {
  const nowIso = new Date().toISOString();
  const midIdx = Math.max(0, Math.min(stops.length - 1, Math.floor(stops.length * 0.72)));
  const sampleStop = stops[midIdx];

  return [
    {
      vehicle_id: directionId === 0 ? 'egged-49-fallback-0' : 'egged-49-fallback-1',
      lat: sampleStop?.lat ?? 32.7795,
      lon: sampleStop?.lon ?? 34.9665,
      bearing: directionId === 0 ? 345 : 165,
      recorded_at_time: nowIso,
      current_stop_sequence: sampleStop?.stop_sequence ?? 26,
      speed_kmh: 25
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
  const nowIso = new Date().toISOString();
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
          speed_kmh: typeof loc.velocity === 'number' && loc.velocity > 0 ? loc.velocity : 25
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
    vehicles: buildFallbackVehicles(directionId, routeStops),
    updated_at: nowIso,
    source: 'fallback'
  };
}

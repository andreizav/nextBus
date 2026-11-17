import type { CachedRouteState, VehicleTelemetry } from '../types/bus.types.js';

const STRIDE_API_BASE = 'https://open-bus-stride-api.hasadna.org.il';

interface StrideSiriRide {
  id: number;
  gtfs_route_id?: number;
  siri_route__line_ref?: number;
  journey_ref?: string;
}

interface StrideVehicleLocation {
  id: number;
  siri_ride_id?: number;
  lat?: number;
  lon?: number;
  bearing?: number;
  recorded_at_time?: string;
  velocity?: number;
  siri_ride__vehicle_ref?: string;
}

async function fetchWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T | null> {
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

function buildFallbackVehicles(directionId: 0 | 1): VehicleTelemetry[] {
  const nowIso = new Date().toISOString();
  if (directionId === 0) {
    return [
      {
        vehicle_id: 'egged-49-101',
        lat: 32.7668,
        lon: 34.9729,
        bearing: 348,
        recorded_at_time: nowIso,
        current_stop_sequence: 3,
        speed_kmh: 26
      },
      {
        vehicle_id: 'egged-49-104',
        lat: 32.7598,
        lon: 34.9723,
        bearing: 355,
        recorded_at_time: nowIso,
        current_stop_sequence: 1,
        speed_kmh: 22
      }
    ];
  }

  return [
    {
      vehicle_id: 'egged-49-202',
      lat: 32.7892,
      lon: 34.9613,
      bearing: 168,
      recorded_at_time: nowIso,
      current_stop_sequence: 2,
      speed_kmh: 25
    }
  ];
}

/**
 * Fetches live vehicle positions from Open Bus Stride API (/siri_rides/list and /siri_vehicle_locations/list).
 * Intended ONLY for the 15s background polling worker and cold-cache bootstrap.
 */
export async function fetchLiveVehiclesFromStride(
  routeId: string,
  directionId: 0 | 1
): Promise<CachedRouteState> {
  const numericLineRef = routeId.replace(/\D/g, '');
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  let vehicles: VehicleTelemetry[] = [];

  if (numericLineRef) {
    const ridesUrl = `${STRIDE_API_BASE}/siri_rides/list?siri_route__line_refs=${encodeURIComponent(
      numericLineRef
    )}&scheduled_start_time_from=${encodeURIComponent(fiveMinutesAgo)}&limit=5`;

    const rides = await fetchWithTimeout<StrideSiriRide[]>(ridesUrl);
    const rideIds = (rides ?? []).map((r) => r.id).filter(Boolean);

    if (rideIds.length > 0) {
      const locationsUrl = `${STRIDE_API_BASE}/siri_vehicle_locations/list?siri_ride_ids=${rideIds.join(
        ','
      )}&recorded_at_time_from=${encodeURIComponent(fiveMinutesAgo)}&order_by=recorded_at_time%20desc&limit=10`;

      const locations = await fetchWithTimeout<StrideVehicleLocation[]>(locationsUrl);
      if (locations && locations.length > 0) {
        vehicles = locations
          .filter((loc) => typeof loc.lat === 'number' && typeof loc.lon === 'number')
          .slice(0, 4)
          .map((loc, idx) => ({
            vehicle_id: String(loc.siri_ride__vehicle_ref ?? `stride-${loc.siri_ride_id ?? loc.id}`),
            lat: loc.lat!,
            lon: loc.lon!,
            bearing: typeof loc.bearing === 'number' ? loc.bearing : directionId === 0 ? 350 : 170,
            recorded_at_time: loc.recorded_at_time ?? nowIso,
            current_stop_sequence: Math.max(1, 3 - idx),
            speed_kmh: typeof loc.velocity === 'number' && loc.velocity > 0 ? loc.velocity : 24
          }));
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
    vehicles: buildFallbackVehicles(directionId),
    updated_at: nowIso,
    source: 'fallback'
  };
}

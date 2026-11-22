import { describe, expect, it, vi } from 'vitest';
import {
  calculateEtaMinutes,
  calculateWalkMinutes,
  normalizeSpeedKmh,
  selectCatchableVehicle,
  selectNearestApproachingVehicle
} from '../services/eta.service.js';
import { fetchLiveVehiclesFromStride, findLastReachedStopSequence } from '../services/stride.service.js';
import { supabaseService, type RouteStopCoord } from '../services/supabase.service.js';
import type { VehicleTelemetry } from '../types/bus.types.js';

// Straight north-bound line, ~555 m between stops.
const stops: RouteStopCoord[] = [1, 2, 3, 4, 5].map((seq) => ({
  stop_id: `s${seq}`,
  stop_code: `${1000 + seq}`,
  stop_name: `Stop ${seq}`,
  stop_name_he: `תחנה ${seq}`,
  stop_sequence: seq,
  lat: 32.7 + (seq - 1) * 0.005,
  lon: 34.97
}));

function vehicle(id: string, lat: number, seq: number, speed = 24): VehicleTelemetry {
  return {
    vehicle_id: id,
    lat,
    lon: 34.97,
    bearing: 0,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: seq,
    speed_kmh: speed,
    is_realtime: true
  };
}

describe('findLastReachedStopSequence', () => {
  it('returns the stop the bus is standing at', () => {
    expect(findLastReachedStopSequence(32.71, 34.97, stops, 1)).toBe(3);
  });

  it('returns the previous stop when the bus has not reached the closest one yet', () => {
    // 150 m before stop 3 (closest), i.e. still between 2 and 3
    expect(findLastReachedStopSequence(32.7086, 34.97, stops, 1)).toBe(2);
  });

  it('returns the closest stop when the bus already departed from it', () => {
    // 150 m after stop 3, between 3 and 4
    expect(findLastReachedStopSequence(32.7114, 34.97, stops, 1)).toBe(3);
  });
});

describe('approaching vehicle semantics', () => {
  it('does not treat a bus that already left the user stop as arriving', () => {
    const departed = vehicle('departed', 32.7114, 3); // 150 m past stop 3
    expect(selectNearestApproachingVehicle([departed], 3, stops[2].lat, stops[2].lon)).toBeNull();
  });

  it('still accepts a bus standing at the user stop', () => {
    const atStop = vehicle('at-stop', 32.71, 3);
    expect(selectNearestApproachingVehicle([atStop], 3, stops[2].lat, stops[2].lon)?.vehicle_id).toBe('at-stop');
  });
});

describe('selectCatchableVehicle', () => {
  const near = vehicle('near', 32.7086, 2); // ~150 m before stop 3
  const far = vehicle('far', 32.7, 1); // ~1.1 km before stop 3

  it('picks the nearest bus when the user is already at the stop', () => {
    const picked = selectCatchableVehicle([near, far], stops, 3, stops[2].lat, stops[2].lon, 0);
    expect(picked?.vehicle.vehicle_id).toBe('near');
    expect(picked?.catchable).toBe(true);
  });

  it('skips a bus that arrives before the user can walk to the stop', () => {
    const picked = selectCatchableVehicle([near, far], stops, 3, stops[2].lat, stops[2].lon, 2);
    expect(picked?.vehicle.vehicle_id).toBe('far');
    expect(picked?.etaMinutes).toBeGreaterThanOrEqual(2);
    expect(picked?.catchable).toBe(true);
  });

  it('flags the result as not catchable when every bus is too early', () => {
    const picked = selectCatchableVehicle([near, far], stops, 3, stops[2].lat, stops[2].lon, 30);
    expect(picked?.catchable).toBe(false);
  });
});

describe('speed & walk normalisation', () => {
  it('clamps implausible instantaneous GPS speeds', () => {
    expect(normalizeSpeedKmh(0)).toBe(24);
    expect(normalizeSpeedKmh(3)).toBe(12);
    expect(normalizeSpeedKmh(140)).toBe(75);
    expect(normalizeSpeedKmh(40)).toBe(40);
  });

  it('does not explode the ETA for a bus crawling at 2 km/h', () => {
    expect(calculateEtaMinutes(3, 1500, 2)).toBeLessThanOrEqual(10);
  });

  it('computes walk minutes at 75 m/min, treating <=40 m as already at the stop', () => {
    expect(calculateWalkMinutes(30)).toBe(0);
    expect(calculateWalkMinutes(150)).toBe(2);
    expect(calculateWalkMinutes(600)).toBe(8);
  });
});

describe('fetchLiveVehiclesFromStride time bounds', () => {
  it('sends recorded_at_time_to and discards future-dated corrupted telemetry', async () => {
    const nowIso = new Date().toISOString();
    vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue(stops);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 1,
            lat: 32.71,
            lon: 34.97,
            recorded_at_time: '2038-01-14T17:22:21+00:00',
            siri_ride__vehicle_ref: 'future-corrupt'
          },
          {
            id: 2,
            lat: 32.705,
            lon: 34.97,
            recorded_at_time: nowIso,
            siri_ride__vehicle_ref: 'valid-live',
            velocity: 30
          }
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    try {
      const state = await fetchLiveVehiclesFromStride('gtfs-19631-19632', 0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchSpy.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('recorded_at_time_from=');
      expect(calledUrl).toContain('recorded_at_time_to=');
      expect(state.source).toBe('stride');
      expect(state.vehicles.map((v) => v.vehicle_id)).toEqual(['valid-live']);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

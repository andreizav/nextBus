import { describe, expect, it, vi } from 'vitest';
import { redisService } from '../services/redis.service.js';
import { supabaseService, type RouteStopCoord } from '../services/supabase.service.js';
import {
  getLocalStopSuggestions,
  getReturningRoutesForLocation,
  recordUserRouteUsage
} from '../services/user-context.service.js';

describe('User Context Service (per-user history & local stop suggestions)', () => {
  it('filters returning routes within ~250m, increments use_count, and refreshes live ETA from Redis', async () => {
    const redisStore = new Map<string, unknown>();
    let busSeq = 2;
    let busLat = 32.755;
    let busLon = 34.973;

    const routeStops: RouteStopCoord[] = [
      { stop_id: 's1', stop_code: '41949', stop_name: 'Start', stop_name_he: 'התחלה', stop_sequence: 1, lat: 32.751, lon: 34.974 },
      { stop_id: 's2', stop_code: '40888', stop_name: 'Mid 1', stop_name_he: 'ביניים 1', stop_sequence: 2, lat: 32.755, lon: 34.973 },
      { stop_id: 's5', stop_code: '42485', stop_name: 'Matnas', stop_name_he: 'מתנ"ס', stop_sequence: 5, lat: 32.7603, lon: 34.9700 },
      { stop_id: 's6', stop_code: '42486', stop_name: 'Board', stop_name_he: 'עלייה', stop_sequence: 6, lat: 32.7620, lon: 34.9710 }
    ];

    const getJsonSpy = vi
      .spyOn(redisService, 'getJson')
      .mockImplementation(async <T>(key: string) => (redisStore.get(key) as T) ?? null);
    const setJsonSpy = vi
      .spyOn(redisService, 'setJson')
      .mockImplementation(async (key: string, val: unknown) => {
        redisStore.set(key, val);
      });
    const upsertSpy = vi.spyOn(supabaseService, 'upsertUserRouteHistoryRow').mockResolvedValue(undefined);
    const findHistorySpy = vi.spyOn(supabaseService, 'findUserRouteHistoryNearLocation').mockResolvedValue([]);
    const stopsSpy = vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue(routeStops);
    const touchSpy = vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
    const busStateSpy = vi.spyOn(redisService, 'getBusState').mockImplementation(async () => ({
      route_id: 'stride-10049',
      direction_id: 0,
      updated_at: '2026-11-21T13:00:00Z',
      source: 'stride',
      vehicles: [
        {
          vehicle_id: 'egged-49-1',
          lat: busLat,
          lon: busLon,
          bearing: 0,
          recorded_at_time: '2026-11-21T13:00:00Z',
          current_stop_sequence: busSeq,
          speed_kmh: 24
        }
      ]
    }));

    try {
      // Record Tirat Carmel route twice
      await recordUserRouteUsage({
        userId: 'nb_u_test1',
        originLat: 32.7620,
        originLon: 34.9710,
        originStopId: 's6',
        originStopName: 'Board',
        destLabel: 'Horev Center',
        destLat: 32.7832,
        destLon: 34.9859,
        routeId: 'stride-10049',
        lineNumber: '49',
        directionId: 0
      });
      await recordUserRouteUsage({
        userId: 'nb_u_test1',
        originLat: 32.7622,
        originLon: 34.9711,
        originStopId: 's6',
        originStopName: 'Board',
        destLabel: 'Horev Center',
        destLat: 32.7832,
        destLon: 34.9859,
        routeId: 'stride-10049',
        lineNumber: '49',
        directionId: 0
      });

      // Record faraway Haifa Hadar route (>5 km away)
      await recordUserRouteUsage({
        userId: 'nb_u_test1',
        originLat: 32.8115,
        originLon: 34.9965,
        originStopId: 'stop-hadar',
        destLabel: 'Rambam',
        routeId: 'stride-10028',
        lineNumber: '28',
        directionId: 0
      });

      const firstReturning = await getReturningRoutesForLocation('nb_u_test1', 32.7623, 34.9709, 250);
      expect(firstReturning).toHaveLength(1);
      expect(firstReturning[0].dest_label).toBe('Horev Center');
      expect(firstReturning[0].use_count).toBe(2);
      const firstEta = firstReturning[0].eta_minutes ?? 99;

      // Move vehicle closer (seq 5, ~190m from board stop)
      busSeq = 5;
      busLat = 32.7603;
      busLon = 34.9700;

      const secondReturning = await getReturningRoutesForLocation('nb_u_test1', 32.7623, 34.9709, 250);
      expect(secondReturning).toHaveLength(1);
      const secondEta = secondReturning[0].eta_minutes ?? 99;
      expect(secondEta).toBeLessThan(firstEta);

      expect(getJsonSpy).toHaveBeenCalled();
      expect(setJsonSpy).toHaveBeenCalled();
      expect(upsertSpy).toHaveBeenCalledTimes(3);
      expect(findHistorySpy).toHaveBeenCalledTimes(2);
      expect(stopsSpy).toHaveBeenCalled();
      expect(touchSpy).toHaveBeenCalled();
      expect(busStateSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('returns nearby bus lines with termini and live ETA from getLocalStopSuggestions', async () => {
    const rpcSpy = vi.spyOn(supabaseService, 'getNearbyLinesAndTermini').mockResolvedValue([
      {
        route_id: 'stride-10049',
        line_number: '49',
        route_long_name: 'טירת כרמל - חוף הכרמל',
        direction_id: 0,
        nearest_stop_id: 'stop-42485',
        nearest_stop_code: '42485',
        nearest_stop_name: "מתנ''ס/ז'בוטינסקי (טירת כרמל)",
        nearest_stop_name_he: "מתנ''ס/ז'בוטינסקי (טירת כרמל)",
        nearest_stop_sequence: 14,
        stop_lat: 32.7603,
        stop_lon: 34.9700,
        distance_meters: 212,
        destination_name: 'Hof HaCarmel Central (Haifa)',
        destination_he: 'ת. מרכזית חוף הכרמל/הורדה (חיפה)'
      },
      {
        route_id: 'stride-10049a',
        line_number: '49א',
        route_long_name: 'טירת כרמל - מרכז הכרמל',
        direction_id: 0,
        nearest_stop_id: 'stop-42474',
        nearest_stop_code: '42474',
        nearest_stop_name: 'משטרה/הפלמח (טירת כרמל)',
        nearest_stop_name_he: 'משטרה/הפלמח (טירת כרמל)',
        nearest_stop_sequence: 3,
        stop_lat: 32.7595,
        stop_lon: 34.9745,
        distance_meters: 430,
        destination_name: 'Carmel Center / Hanassi (Haifa)',
        destination_he: 'מרכז הכרמל / הנשיא (חיפה)'
      }
    ]);

    const touchSpy = vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
    const busStateSpy = vi.spyOn(redisService, 'getBusState').mockImplementation(async (routeId) => ({
      route_id: routeId,
      direction_id: 0,
      updated_at: '2026-11-21T13:00:00Z',
      source: 'stride',
      vehicles: [
        {
          vehicle_id: `v-${routeId}`,
          lat: 32.758,
          lon: 34.971,
          bearing: 0,
          recorded_at_time: '2026-11-21T13:00:00Z',
          current_stop_sequence: routeId === 'stride-10049' ? 12 : 2,
          speed_kmh: 24
        }
      ]
    }));

    try {
      const suggestions = await getLocalStopSuggestions(32.762, 34.971, 500, 8);
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].line_number).toBe('49');
      expect(suggestions[0].destination_he).toBe('ת. מרכזית חוף הכרמל/הורדה (חיפה)');
      expect(suggestions[0].eta_minutes).toBeGreaterThanOrEqual(1);
      expect(suggestions[1].line_number).toBe('49א');
      expect(suggestions[1].destination_name).toBe('Carmel Center / Hanassi (Haifa)');
      expect(rpcSpy).toHaveBeenCalledWith(32.762, 34.971, 500, 8);
      expect(touchSpy).toHaveBeenCalledTimes(2);
      expect(busStateSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('caps local suggestions radius at 600m, excludes >600m stops, and sorts closest first', async () => {
    const rpcSpy = vi.spyOn(supabaseService, 'getNearbyLinesAndTermini').mockResolvedValue([
      {
        route_id: 'stride-far',
        line_number: '99',
        route_long_name: 'Far Line',
        direction_id: 0,
        nearest_stop_id: 'stop-far',
        nearest_stop_code: '99999',
        nearest_stop_name: 'Far Stop',
        nearest_stop_name_he: 'תחנה רחוקה',
        nearest_stop_sequence: 1,
        stop_lat: 32.77,
        stop_lon: 34.98,
        distance_meters: 720,
        destination_name: 'Far Dest',
        destination_he: 'יעד רחוק'
      },
      {
        route_id: 'stride-mid',
        line_number: '24',
        route_long_name: 'Mid Line',
        direction_id: 0,
        nearest_stop_id: 'stop-mid',
        nearest_stop_code: '24000',
        nearest_stop_name: 'Mid Stop',
        nearest_stop_name_he: 'תחנה בינונית',
        nearest_stop_sequence: 2,
        stop_lat: 32.765,
        stop_lon: 34.972,
        distance_meters: 480,
        destination_name: 'Mid Dest',
        destination_he: 'יעד בינוני'
      },
      {
        route_id: 'stride-near',
        line_number: '49',
        route_long_name: 'Near Line',
        direction_id: 0,
        nearest_stop_id: 'stop-near',
        nearest_stop_code: '49000',
        nearest_stop_name: 'Near Stop',
        nearest_stop_name_he: 'תחנה קרובה',
        nearest_stop_sequence: 3,
        stop_lat: 32.7625,
        stop_lon: 34.9712,
        distance_meters: 95,
        destination_name: 'Near Dest',
        destination_he: 'יעד קרוב'
      }
    ]);
    vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
    vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

    try {
      const suggestions = await getLocalStopSuggestions(32.762, 34.971, 1500, 8);
      expect(rpcSpy).toHaveBeenCalledWith(32.762, 34.971, 600, 8);
      expect(suggestions.map((s) => s.line_number)).toEqual(['49', '24']);
      expect(suggestions.map((s) => s.distance_meters)).toEqual([95, 480]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('falls back to strictly 1 closest local line when none are within 600m', async () => {
    const rpcSpy = vi
      .spyOn(supabaseService, 'getNearbyLinesAndTermini')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          route_id: 'stride-far-2',
          line_number: '24',
          route_long_name: 'Farther Line',
          direction_id: 0,
          nearest_stop_id: 'stop-far-2',
          nearest_stop_code: '24001',
          nearest_stop_name: 'Farther Stop',
          nearest_stop_name_he: 'תחנה רחוקה 2',
          nearest_stop_sequence: 1,
          stop_lat: 32.771,
          stop_lon: 34.981,
          distance_meters: 980,
          destination_name: 'Dest 2',
          destination_he: 'יעד 2'
        },
        {
          route_id: 'stride-far-1',
          line_number: '49',
          route_long_name: 'Closest Far Line',
          direction_id: 0,
          nearest_stop_id: 'stop-far-1',
          nearest_stop_code: '49001',
          nearest_stop_name: 'Closest Far Stop',
          nearest_stop_name_he: 'תחנה הכי קרובה',
          nearest_stop_sequence: 2,
          stop_lat: 32.769,
          stop_lon: 34.978,
          distance_meters: 740,
          destination_name: 'Dest 1',
          destination_he: 'יעד 1'
        }
      ]);
    vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
    vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

    try {
      const suggestions = await getLocalStopSuggestions(32.762, 34.971, 600, 8);
      expect(rpcSpy).toHaveBeenNthCalledWith(1, 32.762, 34.971, 600, 8);
      expect(rpcSpy).toHaveBeenNthCalledWith(2, 32.762, 34.971, 1600, 1);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].line_number).toBe('49');
      expect(suggestions[0].distance_meters).toBe(740);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

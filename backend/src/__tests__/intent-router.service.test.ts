import { describe, expect, it, vi } from 'vitest';
import { stripConversationalPrefix } from '../services/geocoding.service.js';
import { classifyQueryIntent, dispatchSearchIntent } from '../services/intent-router.service.js';
import { redisService } from '../services/redis.service.js';
import { supabaseService } from '../services/supabase.service.js';

describe('Intent Router & Conversational Query Parsing', () => {
  describe('classifyQueryIntent', () => {
    it('detects numeric and Hebrew variant bus lines', () => {
      expect(classifyQueryIntent('49')).toEqual({ kind: 'LINE', lineNumber: '49' });
      expect(classifyQueryIntent('קו 49')).toEqual({ kind: 'LINE', lineNumber: '49' });
      expect(classifyQueryIntent('автобус 49א')).toEqual({ kind: 'LINE', lineNumber: '49א' });
      expect(classifyQueryIntent('line 910')).toEqual({ kind: 'LINE', lineNumber: '910' });
    });

    it('resolves spoken voice bus queries in RU / EN / HE', () => {
      expect(classifyQueryIntent('Сорок девятый автобус')).toEqual({
        kind: 'LINE',
        lineNumber: '49'
      });
      expect(classifyQueryIntent('двадцать четвертый')).toEqual({
        kind: 'LINE',
        lineNumber: '24'
      });
      expect(classifyQueryIntent('forty nine bus')).toEqual({
        kind: 'LINE',
        lineNumber: '49'
      });
      expect(classifyQueryIntent('קו ארבעים ותשע')).toEqual({
        kind: 'LINE',
        lineNumber: '49'
      });
    });

    it('routes destination phrases & street addresses to DESTINATION intent', () => {
      expect(classifyQueryIntent('Хочу поехать в больницу Рамбам')).toEqual({
        kind: 'DESTINATION',
        query: 'Хочу поехать в больницу Рамбам'
      });
      expect(classifyQueryIntent('Герцль 49, Хайфа')).toEqual({
        kind: 'DESTINATION',
        query: 'Герцль 49, Хайфа'
      });
      expect(classifyQueryIntent('Иерусалим')).toEqual({
        kind: 'DESTINATION',
        query: 'Иерусалим'
      });
    });
  });

  describe('stripConversationalPrefix', () => {
    it('strips conversational RU/HE/EN prefixes before geocoding', () => {
      expect(stripConversationalPrefix('Хочу поехать в больницу Рамбам')).toBe('больницу Рамбам');
      expect(stripConversationalPrefix('איך מגיעים לבית חולים רמב"ם')).toBe('בית חולים רמב"ם');
      expect(stripConversationalPrefix('Take me to Azrieli Tel Aviv')).toBe('Azrieli Tel Aviv');
    });
  });

  describe('dispatchSearchIntent disambiguation', () => {
    it('returns LINE_DISAMBIGUATION when multiple nearby line candidates exist', async () => {
      const findSpy = vi.spyOn(supabaseService, 'findNearbyLinesByNumber').mockResolvedValueOnce([
        {
          route_id: 'stride-10049',
          line_number: '49',
          route_long_name: 'טירת כרמל - חוף הכרמל',
          direction_id: 0,
          origin_he: 'טירת כרמל',
          destination_he: 'ת. מרכזית חוף הכרמל',
          nearest_stop_id: 'stop-42656',
          nearest_stop_code: '42656',
          nearest_stop_name: 'Matam',
          nearest_stop_name_he: "מת''מ (חיפה)",
          nearest_stop_sequence: 34,
          stop_lat: 32.7904,
          stop_lon: 34.9613,
          distance_meters: 150
        },
        {
          route_id: 'stride-10049a',
          line_number: '49א',
          route_long_name: 'טירת כרמל - מרכז חורב',
          direction_id: 0,
          origin_he: 'טירת כרמל',
          destination_he: 'מרכז חורב',
          nearest_stop_id: 'stop-42656',
          nearest_stop_code: '42656',
          nearest_stop_name: 'Matam',
          nearest_stop_name_he: "מת''מ (חיפה)",
          nearest_stop_sequence: 6,
          stop_lat: 32.7904,
          stop_lon: 34.9613,
          distance_meters: 150
        }
      ]);

      const nearestSpy = vi.spyOn(supabaseService, 'findNearestStopForLine').mockResolvedValueOnce({
        route_id: 'stride-10049',
        direction_id: 0,
        stop_id: 'stop-42656',
        stop_sequence: 34,
        stop_code: '42656',
        stop_name: 'Matam',
        stop_name_he: "מת''מ (חיפה)",
        stop_lat: 32.7904,
        stop_lon: 34.9613,
        route_short_name: '49',
        route_long_name: 'טירת כרמל - חוף הכרמל',
        distance_meters: 150
      });

      const stopsSpy = vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue([
        {
          stop_id: 'stop-41949',
          stop_code: '41949',
          stop_name: 'Tirat Carmel',
          stop_name_he: 'טירת כרמל',
          stop_sequence: 1,
          lat: 32.751,
          lon: 34.974
        },
        {
          stop_id: 'stop-42656',
          stop_code: '42656',
          stop_name: 'Matam',
          stop_name_he: "מת''מ (חיפה)",
          stop_sequence: 34,
          lat: 32.7904,
          lon: 34.9613
        }
      ]);

      const touchSpy = vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      const getStateSpy = vi.spyOn(redisService, 'getBusState').mockResolvedValue({
        route_id: 'stride-10049',
        direction_id: 0,
        updated_at: '2026-11-21T10:00:00Z',
        source: 'fallback',
        vehicles: [
          {
            vehicle_id: 'v1',
            lat: 32.78,
            lon: 34.965,
            bearing: 0,
            recorded_at_time: '2026-11-21T10:00:00Z',
            current_stop_sequence: 30,
            speed_kmh: 24
          }
        ]
      });

      try {
        const result = await dispatchSearchIntent({
          query: 'Сорок девятый автобус',
          userLocation: { lat: 32.7895, lon: 34.964 },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(result.entry_context).toBe('standalone');
        expect(result.intent_type).toBe('LINE_DISAMBIGUATION');
        expect(result.candidates).toHaveLength(2);
        expect(result.candidates?.map((c) => c.line_number)).toEqual(['49', '49א']);
        expect(result.timeline_window).toBeDefined();
      } finally {
        findSpy.mockRestore();
        nearestSpy.mockRestore();
        stopsSpy.mockRestore();
        touchSpy.mockRestore();
        getStateSpy.mockRestore();
      }
    });
  });
});

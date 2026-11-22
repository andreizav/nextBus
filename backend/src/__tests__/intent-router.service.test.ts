import { describe, expect, it, vi } from 'vitest';
import {
  classifyDestinationGranularity,
  resolveDestinationText,
  stripConversationalPrefix
} from '../services/geocoding.service.js';
import {
  classifyQueryIntent,
  dispatchSearchIntent,
  parseExplicitOriginAndRoute
} from '../services/intent-router.service.js';
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

  describe('Destination granularity classification & GTFS stop resolution', () => {
    it('classifies city, address, poi, and street-only queries accurately', () => {
      expect(classifyDestinationGranularity('в Кирьят-Гат')).toMatchObject({
        granularity: 'city',
        cityName: 'קריית גת'
      });
      expect(classifyDestinationGranularity('в Хайфу')).toMatchObject({
        granularity: 'city',
        cityName: 'חיפה'
      });
      expect(classifyDestinationGranularity('Хорев 12, Хайфа')).toMatchObject({
        granularity: 'address',
        cityName: 'חיפה',
        houseNumber: '12'
      });
      expect(classifyDestinationGranularity('больница Рамбам')).toMatchObject({
        granularity: 'poi'
      });
      expect(classifyDestinationGranularity('на улицу Хорев')).toMatchObject({
        granularity: 'street'
      });
      expect(classifyDestinationGranularity('в Эйлат')).toMatchObject({
        granularity: 'city',
        cityName: 'אילת'
      });
      expect(classifyDestinationGranularity('в Беэр-Шеву')).toMatchObject({
        granularity: 'city',
        cityName: 'באר שבע'
      });
    });

    it('resolves city -> central stop and street -> most popular stop with alternatives', async () => {
      const cacheSpy = vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      const setCacheSpy = vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const centralSpy = vi.spyOn(supabaseService, 'findCentralStopForCity').mockResolvedValue({
        stop_id: 'stop-48001',
        stop_code: '48001',
        stop_name: 'Kiryat Gat - Central Bus Station',
        stop_name_he: 'קריית גת - תחנה מרכזית',
        lat: 31.6095,
        lon: 34.7642,
        routes_count: 1,
        is_central_hub: true
      });
      const streetSpy = vi.spyOn(supabaseService, 'findPopularStopOnStreet').mockResolvedValue([
        {
          stop_id: 'stop-43013',
          stop_code: '43013',
          stop_name: 'Horev Center / Clinic (Haifa)',
          stop_name_he: 'מרכז חורב / מרפאה (חיפה)',
          lat: 32.7832,
          lon: 34.9859,
          routes_count: 6,
          is_hub: true
        },
        {
          stop_id: 'stop-43014',
          stop_code: '43014',
          stop_name: 'Horev / Freud (Haifa)',
          stop_name_he: 'חורב / פרויד (חיפה)',
          lat: 32.7848,
          lon: 34.9863,
          routes_count: 1,
          is_hub: false
        }
      ]);

      try {
        const cityDest = await resolveDestinationText('в Кирьят-Гат', { lat: 32.7895, lon: 34.964 });
        expect(centralSpy).toHaveBeenCalledWith('קריית גת');
        expect(cityDest.destination_granularity).toBe('city');
        expect(cityDest.resolved_stop?.stop_id).toBe('stop-48001');
        expect(cityDest.lat).toBeCloseTo(31.6095, 4);

        const streetDest = await resolveDestinationText('на улицу Хорев', { lat: 32.7895, lon: 34.964 });
        expect(streetSpy).toHaveBeenCalled();
        expect(streetDest.destination_granularity).toBe('street');
        expect(streetDest.resolved_stop?.stop_id).toBe('stop-43013');
        expect(streetDest.alternative_street_stops).toHaveLength(2);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('resolves numbered address to exact coordinates and snaps nearest stop via PostGIS', async () => {
      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => [
          {
            lat: '32.7840',
            lon: '34.9861',
            display_name: 'Horev 12, Haifa, Israel',
            name: 'Horev 12',
            addresstype: 'house'
          }
        ]
      } as unknown as Response);
      const nearestSpy = vi.spyOn(supabaseService, 'findNearestStopsToPoint').mockResolvedValue([
        {
          stop_id: 'stop-43013',
          stop_code: '43013',
          stop_name: 'Horev Center / Clinic (Haifa)',
          stop_name_he: 'מרכז חורב / מרפאה (חיפה)',
          lat: 32.7832,
          lon: 34.9859,
          distance_meters: 90
        }
      ]);

      try {
        const addrDest = await resolveDestinationText('Хорев 12, Хайфа', { lat: 32.7895, lon: 34.964 });
        expect(fetchSpy).toHaveBeenCalled();
        expect(nearestSpy).toHaveBeenCalledWith(32.784, 34.9861, 480);
        expect(addrDest.destination_granularity).toBe('address');
        expect(addrDest.resolved_stop?.stop_id).toBe('stop-43013');
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('Location Mismatch confirmation & ignoreUserLocation flow', () => {
    it('parses explicit origin, destination, and bus line phrases', () => {
      expect(
        parseExplicitOriginAndRoute('Я стою на остановке Савидор и еду в Иерусалим по маршруту 480')
      ).toEqual({
        explicitOriginText: 'Савидор',
        destinationText: 'Иерусалим',
        lineNumber: '480'
      });
    });

    it('returns location_mismatch confirmation first, then plans from explicit origin when ignoreUserLocation=true', async () => {
      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'getCachedRoutePair').mockResolvedValue(null);
      vi.spyOn(redisService, 'setCachedRoutePair').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

      vi.spyOn(supabaseService, 'findStopsByNameQuery').mockResolvedValue([
        {
          stop_id: 'stop-45003',
          stop_code: '45003',
          stop_name: 'Tel Aviv - Savidor Central Train & Terminal',
          stop_name_he: 'תל אביב - רכבת מרכז / מסוף סבידור',
          lat: 32.0837,
          lon: 34.7978
        }
      ]);
      vi.spyOn(supabaseService, 'findNearestStopsToPoint').mockResolvedValue([
        {
          stop_id: 'stop-42658',
          stop_code: '42658',
          stop_name: 'Hof HaCarmel (Haifa)',
          stop_name_he: 'ת. מרכזית חוף הכרמל (חיפה)',
          lat: 32.7934,
          lon: 34.959,
          distance_meters: 120
        }
      ]);
      vi.spyOn(supabaseService, 'findCentralStopForCity').mockResolvedValue({
        stop_id: 'stop-46001',
        stop_code: '46001',
        stop_name: 'Jerusalem - Central Bus Station / Navon',
        stop_name_he: 'ירושלים - תחנה מרכזית / רכבת נבון',
        lat: 31.789,
        lon: 35.203,
        routes_count: 2,
        is_central_hub: true
      });
      vi.spyOn(supabaseService, 'findNearbyLinesByNumber').mockResolvedValue([]);
      const directSpy = vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([
        {
          route_id: 'stride-10480',
          route_short_name: '480',
          route_long_name: 'Tel Aviv Savidor - Jerusalem',
          direction_id: 0,
          origin_stop_id: 'stop-45003',
          origin_stop_code: '45003',
          origin_stop_name: 'Tel Aviv - Savidor Central Train & Terminal',
          origin_stop_name_he: 'תל אביב - רכבת מרכז / מסוף סבידור',
          origin_stop_sequence: 1,
          origin_lat: 32.0837,
          origin_lon: 34.7978,
          dest_stop_id: 'stop-46001',
          dest_stop_code: '46001',
          dest_stop_name: 'Jerusalem - Central Bus Station / Navon',
          dest_stop_name_he: 'ירושלים - תחנה מרכזית / רכבת נבון',
          dest_stop_sequence: 6,
          dest_lat: 31.789,
          dest_lon: 35.203,
          stops_between: 5
        }
      ]);
      vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue([
        {
          stop_id: 'stop-45003',
          stop_code: '45003',
          stop_name: 'Tel Aviv - Savidor Central Train & Terminal',
          stop_name_he: 'תל אביב - רכבת מרכז / מסוף סבידור',
          stop_sequence: 1,
          lat: 32.0837,
          lon: 34.7978
        },
        {
          stop_id: 'stop-46001',
          stop_code: '46001',
          stop_name: 'Jerusalem - Central Bus Station / Navon',
          stop_name_he: 'ירושלים - תחנה מרכזית / רכבת נבון',
          stop_sequence: 6,
          lat: 31.789,
          lon: 35.203
        }
      ]);

      try {
        // User physically in Haifa asks as if standing at Savidor (Tel Aviv)
        const haifaGps = { lat: 32.7895, lon: 34.964 };
        const mismatchRes = await dispatchSearchIntent({
          query: 'Я стою на остановке Савидор и еду в Иерусалим по маршруту 480',
          userLocation: haifaGps,
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(mismatchRes.intent_type).toBe('LOCATION_MISMATCH');
        expect(mismatchRes.requires_confirmation).toBe(true);
        expect(mismatchRes.confirmation_type).toBe('location_mismatch');
        expect(mismatchRes.proposed_origin?.stop_id).toBe('stop-45003');
        expect(mismatchRes.current_location_summary?.distance_to_proposed_meters).toBeGreaterThan(70000);
        expect(directSpy).not.toHaveBeenCalled();

        // User clicks "Да, искать от указанной точки" -> retry with ignoreUserLocation: true
        const confirmedRes = await dispatchSearchIntent({
          query: mismatchRes.proposed_origin?.original_query || 'Я стою на остановке Савидор и еду в Иерусалим по маршруту 480',
          userLocation: haifaGps,
          entryContext: 'standalone',
          ignoreUserLocation: true,
          explicitOrigin: {
            lat: mismatchRes.proposed_origin!.lat,
            lon: mismatchRes.proposed_origin!.lon,
            label: mismatchRes.proposed_origin!.label,
            stop_id: mismatchRes.proposed_origin!.stop_id
          },
          allowColdBootstrap: false
        });

        expect(confirmedRes.requires_confirmation).toBeUndefined();
        expect(confirmedRes.intent_type).toBe('TRIP_PLANNER');
        expect(confirmedRes.route.short_name).toBe('480');
        expect(directSpy).toHaveBeenCalledWith(32.0837, 34.7978, 31.789, 35.203, 600);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('resolves Eilat and Be\'er Sheva via Layer 1 GTFS central bus station and caches geo:cache with 24h TTL', async () => {
      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      const setJsonSpy = vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const centralSpy = vi
        .spyOn(supabaseService, 'findCentralStopForCity')
        .mockImplementation(async (city) => {
          if (city === 'אילת') {
            return {
              stop_id: 'stop-59001',
              stop_code: '59001',
              stop_name: 'Eilat - Central Bus Station',
              stop_name_he: 'אילת - תחנה מרכזית',
              lat: 29.5569,
              lon: 34.9498,
              routes_count: 4,
              is_central_hub: true
            };
          }
          if (city === 'באר שבע') {
            return {
              stop_id: 'stop-53001',
              stop_code: '53001',
              stop_name: "Be'er Sheva - Central Bus Station",
              stop_name_he: 'באר שבע - תחנה מרכזית',
              lat: 31.2439,
              lon: 34.7966,
              routes_count: 6,
              is_central_hub: true
            };
          }
          return null;
        });
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      try {
        const eilat = await resolveDestinationText('Эйлат', { lat: 32.7895, lon: 34.964 });
        expect(eilat.source).toBe('gtfs_db');
        expect(eilat.resolved_stop?.stop_id).toBe('stop-59001');
        expect(eilat.lat).toBeCloseTo(29.5569, 4);

        const beerSheva = await resolveDestinationText('Беэр-Шева', { lat: 32.7895, lon: 34.964 });
        expect(beerSheva.source).toBe('gtfs_db');
        expect(beerSheva.resolved_stop?.stop_id).toBe('stop-53001');
        expect(centralSpy).toHaveBeenCalledTimes(2);
        // External geocoders are NOT called when Layer 1 GTFS resolves the city
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(setJsonSpy.mock.calls.some(([k, , ttl]) => String(k).startsWith('geo:cache:') && ttl === 86_400)).toBe(true);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('resolves nationwide cities such as Rehovot (Реховот), Lod (לוד), and Tiberias (Тверия) via GTFS central hubs', async () => {
      expect(classifyDestinationGranularity('Реховот')).toMatchObject({
        granularity: 'city',
        cityName: 'רחובות'
      });
      expect(classifyDestinationGranularity('לרחובות')).toMatchObject({
        granularity: 'city',
        cityName: 'רחובות'
      });
      expect(classifyDestinationGranularity('לוד')).toMatchObject({
        granularity: 'city',
        cityName: 'לוד'
      });
      expect(classifyDestinationGranularity('Тверия')).toMatchObject({
        granularity: 'city',
        cityName: 'טבריה'
      });

      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const centralSpy = vi
        .spyOn(supabaseService, 'findCentralStopForCity')
        .mockResolvedValue({
          stop_id: 'stop-31100',
          stop_code: '31100',
          stop_name: 'ת. מרכזית רחובות/רציפים (רחובות)',
          stop_name_he: 'ת. מרכזית רחובות/רציפים (רחובות)',
          lat: 31.8935,
          lon: 34.8077,
          routes_count: 18,
          is_central_hub: true
        });

      try {
        const rehovot = await resolveDestinationText('Реховот (רחובות)', { lat: 32.7615, lon: 34.9718 });
        expect(['gtfs_db', 'gazetteer']).toContain(rehovot.source);
        expect(rehovot.resolved_stop?.stop_id).toBe('stop-31100');
        expect(centralSpy).toHaveBeenCalledWith('רחובות');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('prevents city gazetteer from hijacking POIs like "סופרפארם טירת כרמל" to Tirat Carmel center', async () => {
      expect(classifyDestinationGranularity('סופרפארם טירת כרמל')).toMatchObject({
        granularity: 'poi',
        cityName: 'טירת כרמל'
      });

      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const centralSpy = vi.spyOn(supabaseService, 'findCentralStopForCity').mockResolvedValue(null);
      vi.spyOn(supabaseService, 'findNearestStopsToPoint').mockResolvedValue([
        {
          stop_id: 'stop-42682',
          stop_code: '42682',
          stop_name: 'קופת חולים כללית /ששת הימים (טירת כרמל)',
          stop_name_he: 'קופת חולים כללית /ששת הימים (טירת כרמל)',
          lat: 32.7595,
          lon: 34.9732,
          distance_meters: 35
        }
      ]);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('nominatim.openstreetmap.org')) {
          return new Response(
            JSON.stringify([
              {
                lat: '32.7595743',
                lon: '34.9728838',
                display_name: 'סופר-פארם, טירת כרמל, ישראל',
                name: 'סופר-פארם',
                addresstype: 'pharmacy',
                type: 'pharmacy'
              }
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      try {
        const res = await resolveDestinationText('סופרפארם טירת כרמל', { lat: 32.7662, lon: 34.9675 });
        expect(res.source).toBe('osm_nominatim');
        expect(res.lat).toBeCloseTo(32.7595743, 4);
        expect(res.lon).toBeCloseTo(34.9728838, 4);
        expect(res.resolved_stop?.stop_id).toBe('stop-42682');
        expect(centralSpy).not.toHaveBeenCalled();
        expect(fetchSpy).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('strips non-Haifa city names cleanly for street queries like "רחוב הרצל נתניה"', async () => {
      expect(classifyDestinationGranularity('רחוב הרצל נתניה')).toMatchObject({
        granularity: 'street',
        cityName: 'נתניה',
        streetName: 'הרצל'
      });

      vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
      vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
      const streetSpy = vi
        .spyOn(supabaseService, 'findPopularStopOnStreet')
        .mockResolvedValue([
          {
            stop_id: 'stop-39247',
            stop_code: '39247',
            stop_name: 'הרצל/עולי הגרדום (נתניה)',
            stop_name_he: 'הרצל/עולי הגרדום (נתניה)',
            lat: 32.327,
            lon: 34.855,
            routes_count: 14
          }
        ]);

      try {
        const res = await resolveDestinationText('רחוב הרצל נתניה', { lat: 32.28, lon: 34.858 });
        expect(res.source).toBe('gtfs_db');
        expect(res.city_name).toBe('נתניה');
        expect(res.resolved_stop?.stop_id).toBe('stop-39247');
        expect(streetSpy).toHaveBeenCalledWith('הרצל', 'נתניה', 32.28, 34.858);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});

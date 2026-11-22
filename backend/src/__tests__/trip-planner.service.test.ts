import { describe, expect, it, vi } from 'vitest';
import { buildRoutePairCacheKey, redisService } from '../services/redis.service.js';
import { scheduleService } from '../services/schedule.service.js';
import { supabaseService, type RouteStopCoord } from '../services/supabase.service.js';
import {
  buildTripOptions,
  calculateTransferTripMetrics,
  calculateTripMetrics,
  filterApproachingVehicles,
  filterValidDirectionMatches,
  filterValidTransferMatches,
  filterValidTwoTransferMatches,
  planBestBusesToDestination,
  rankTopBusOptions,
  selectBestSingleOption,
  selectTop3MixedOptions
} from '../services/trip-planner.service.js';
import type {
  DirectRouteMatch,
  RecommendedBusOption,
  TransferRouteMatch,
  VehicleTelemetry
} from '../types/bus.types.js';

function makeOption(
  shortName: string,
  etaToBoardingMin: number,
  totalArrivalMin: number
): RecommendedBusOption {
  return {
    rank: 1,
    route: {
      route_id: `stride-${shortName}`,
      short_name: shortName,
      long_name: `Line ${shortName}`,
      direction_id: 0,
      direction_label: 'Origin -> Dest',
      available_directions: []
    },
    origin_stop: {
      stop_id: 'stop-a',
      stop_code: '42362',
      stop_name: 'Origin',
      stop_name_he: 'מוצא',
      stop_sequence: 3,
      lat: 32.7896,
      lon: 34.9621
    },
    dest_stop: {
      stop_id: 'stop-b',
      stop_code: '43013',
      stop_name: 'Horev',
      stop_name_he: 'חורב',
      stop_sequence: 7,
      lat: 32.7832,
      lon: 34.9859
    },
    bus: {
      vehicle_id: `bus-${shortName}`,
      lat: 32.79,
      lon: 34.96,
      bearing: 90,
      recorded_at_time: '2026-11-17T17:00:00.000Z',
      current_stop_sequence: 1,
      stops_away: 2,
      eta_minutes: etaToBoardingMin
    },
    eta_to_boarding_min: etaToBoardingMin,
    stops_between: 4,
    ride_duration_min: totalArrivalMin - etaToBoardingMin,
    total_arrival_min: totalArrivalMin,
    estimated_arrival_time: '19:45',
    timeline_stops: []
  };
}

describe('Trip Planner A -> B matching and Top-3 ranking', () => {
  describe('filterValidDirectionMatches', () => {
    it('keeps only matches where origin_stop_sequence < dest_stop_sequence', () => {
      const base: DirectRouteMatch = {
        route_id: 'stride-10024',
        route_short_name: '24',
        route_long_name: 'Line 24',
        direction_id: 0,
        origin_stop_id: 'stop-a',
        origin_stop_code: '42362',
        origin_stop_name: 'Matam',
        origin_stop_name_he: 'מת"מ',
        origin_stop_sequence: 3,
        origin_lat: 32.7896,
        origin_lon: 34.9621,
        dest_stop_id: 'stop-b',
        dest_stop_code: '43013',
        dest_stop_name: 'Horev',
        dest_stop_name_he: 'חורב',
        dest_stop_sequence: 7,
        dest_lat: 32.7832,
        dest_lon: 34.9859,
        stops_between: 4
      };

      const reverseDirection: DirectRouteMatch = {
        ...base,
        route_id: 'stride-10024-rev',
        direction_id: 1,
        origin_stop_sequence: 8,
        dest_stop_sequence: 4,
        stops_between: -4
      };

      const sameStop: DirectRouteMatch = {
        ...base,
        route_id: 'stride-same',
        origin_stop_sequence: 5,
        dest_stop_sequence: 5,
        stops_between: 0
      };

      const valid = filterValidDirectionMatches([base, reverseDirection, sameStop]);
      expect(valid).toHaveLength(1);
      expect(valid[0].route_id).toBe('stride-10024');
    });
  });

  describe('filterApproachingVehicles', () => {
    it('excludes vehicles that already passed the boarding stop sequence', () => {
      const vehicles: VehicleTelemetry[] = [
        {
          vehicle_id: 'v-before',
          lat: 32.793,
          lon: 34.959,
          bearing: 90,
          recorded_at_time: '2026-11-17T17:00:00.000Z',
          current_stop_sequence: 1
        },
        {
          vehicle_id: 'v-at-stop',
          lat: 32.7896,
          lon: 34.9621,
          bearing: 90,
          recorded_at_time: '2026-11-17T17:00:00.000Z',
          current_stop_sequence: 3
        },
        {
          vehicle_id: 'v-passed',
          lat: 32.7868,
          lon: 34.9768,
          bearing: 90,
          recorded_at_time: '2026-11-17T17:00:00.000Z',
          current_stop_sequence: 6
        }
      ];

      const filtered = filterApproachingVehicles(vehicles, 3);
      expect(filtered.map((v) => v.vehicle_id)).toEqual(['v-before', 'v-at-stop']);
    });
  });

  describe('calculateTripMetrics', () => {
    it('computes ride duration using stops_between * 1.8 and adds boarding ETA', () => {
      const fixedNow = new Date('2026-11-17T17:00:00.000Z'); // 19:00 Asia/Jerusalem (UTC+2)
      const metrics = calculateTripMetrics(4, 4, fixedNow);
      // round(4 * 1.8 = 7.2) = 7 min ride; total = 4 + 7 = 11 min
      expect(metrics.ride_duration_min).toBe(7);
      expect(metrics.total_arrival_min).toBe(11);
      expect(metrics.estimated_arrival_time).toBe('19:11');
    });

    it('computes realistic highway travel time for intercity trips > 15 km', () => {
      // 85 km from Haifa to Tel Aviv
      const metrics = calculateTripMetrics(5, 5, new Date('2026-11-17T17:00:00.000Z'), 85000);
      expect(metrics.ride_duration_min).toBeGreaterThanOrEqual(60);
      expect(metrics.total_arrival_min).toBe(metrics.ride_duration_min + 5);
    });
  });

  describe('rankTopBusOptions', () => {
    it('sorts by total_arrival_min ascending and caps result at Top-3', () => {
      const options = [
        makeOption('49', 8, 22),
        makeOption('123', 6, 12),
        makeOption('24', 3, 10),
        makeOption('11', 5, 12),
        makeOption('37', 10, 25)
      ];

      const top3 = rankTopBusOptions(options, 3);
      expect(top3).toHaveLength(3);
      expect(top3.map((o) => o.route.short_name)).toEqual(['24', '11', '123']);
      expect(top3.map((o) => o.rank)).toEqual([1, 2, 3]);
    });

    it('filters out routes further than 600m and sorts from closest boarding stop ascending', () => {
      const farOption = makeOption('99', 1, 5);
      farOption.origin_stop.distance_meters = 650;

      const midOption = makeOption('24', 2, 8);
      midOption.origin_stop.distance_meters = 420;

      const closeOption = makeOption('49', 7, 18);
      closeOption.origin_stop.distance_meters = 110;

      const boundaryOption = makeOption('11', 3, 12);
      boundaryOption.origin_stop.distance_meters = 600;

      const ranked = rankTopBusOptions([farOption, midOption, closeOption, boundaryOption], 5);
      expect(ranked.map((o) => o.route.short_name)).toEqual(['49', '24', '11']);
      expect(ranked.map((o) => o.origin_stop.distance_meters)).toEqual([110, 420, 600]);
    });

    it('falls back to strictly 1 closest route when all candidates are further than 600m', () => {
      const far1 = makeOption('99', 2, 10);
      far1.origin_stop.distance_meters = 950;

      const far2 = makeOption('49', 5, 15);
      far2.origin_stop.distance_meters = 720;

      const far3 = makeOption('24', 1, 8);
      far3.origin_stop.distance_meters = 1100;

      const ranked = rankTopBusOptions([far1, far2, far3], 3);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].route.short_name).toBe('49');
      expect(ranked[0].origin_stop.distance_meters).toBe(720);
      expect(ranked[0].rank).toBe(1);
    });
  });

  describe('filterValidTransferMatches', () => {
    it('rejects same-route transfers or reversed leg stop sequences', () => {
      const valid: TransferRouteMatch = {
        leg1_route_id: 'stride-10024',
        leg1_route_short_name: '24',
        leg1_route_long_name: 'Line 24',
        leg1_direction_id: 0,
        origin_stop_id: 'stop-a',
        origin_stop_code: '42362',
        origin_stop_name: 'Matam',
        origin_stop_name_he: 'מת"מ',
        origin_stop_sequence: 3,
        origin_lat: 32.7896,
        origin_lon: 34.9621,
        xfer_alight_stop_id: 'stop-43013',
        xfer_alight_stop_code: '43013',
        xfer_alight_stop_name: 'Horev Center',
        xfer_alight_stop_name_he: 'מרכז חורב',
        xfer_alight_stop_sequence: 7,
        xfer_alight_lat: 32.7832,
        xfer_alight_lon: 34.9859,
        leg1_stops_between: 4,
        transfer_walk_meters_actual: 0,
        leg2_route_id: 'stride-10037',
        leg2_route_short_name: '37',
        leg2_route_long_name: 'Line 37',
        leg2_direction_id: 0,
        xfer_board_stop_id: 'stop-43013',
        xfer_board_stop_code: '43013',
        xfer_board_stop_name: 'Horev Center',
        xfer_board_stop_name_he: 'מרכז חורב',
        xfer_board_stop_sequence: 3,
        xfer_board_lat: 32.7832,
        xfer_board_lon: 34.9859,
        dest_stop_id: 'stop-43042',
        dest_stop_code: '43042',
        dest_stop_name: 'University of Haifa',
        dest_stop_name_he: 'אוניברסיטת חיפה',
        dest_stop_sequence: 5,
        dest_lat: 32.762,
        dest_lon: 35.0185,
        leg2_stops_between: 2
      };

      const sameRoute: TransferRouteMatch = { ...valid, leg2_route_id: 'stride-10024' };
      const reversedLeg2: TransferRouteMatch = {
        ...valid,
        leg2_route_id: 'stride-10028',
        xfer_board_stop_sequence: 6,
        dest_stop_sequence: 2,
        leg2_stops_between: -4
      };

      const res = filterValidTransferMatches([valid, sameRoute, reversedLeg2]);
      expect(res).toHaveLength(1);
      expect(res[0].leg2_route_id).toBe('stride-10037');
    });
  });

  describe('calculateTransferTripMetrics', () => {
    it('computes hub exit time, wait duration, Bus 2 boarding time and total ETA', () => {
      const fixedNow = new Date('2026-11-17T17:00:00.000Z'); // 19:00 Asia/Jerusalem
      const metrics = calculateTransferTripMetrics({
        etaToBoardingMin: 3,
        leg1Stops: 4, // round(7.2) = 7 -> arrive hub at 10 min (19:10)
        transferWalkMeters: 40, // ceil(0.5) = 1 min walk
        leg2BusEtaMin: 14, // wait = 4 min -> board Bus 2 at 14 min (19:14)
        leg2Stops: 2, // round(3.6) = 4 min ride -> total 18 min (19:18)
        now: fixedNow
      });

      expect(metrics.arrive_at_hub_min).toBe(10);
      expect(metrics.arrive_at_hub_time).toBe('19:10');
      expect(metrics.wait_minutes).toBe(4);
      expect(metrics.next_bus_board_time).toBe('19:14');
      expect(metrics.total_arrival_min).toBe(18);
      expect(metrics.estimated_arrival_time).toBe('19:18');
    });
  });

  describe('selectTop3MixedOptions', () => {
    it('uses transfer options when zero direct routes exist', () => {
      const t1: RecommendedBusOption = { ...makeOption('24', 3, 15), is_transfer: true };
      const t2: RecommendedBusOption = { ...makeOption('11', 5, 19), is_transfer: true };
      const t3: RecommendedBusOption = { ...makeOption('123', 4, 17), is_transfer: true };
      const picked = selectTop3MixedOptions([], [t1, t2, t3], 3);
      expect(picked.map((o) => o.route.short_name)).toEqual(['24', '123', '11']);
      expect(picked.every((o) => o.is_transfer)).toBe(true);
    });

    it('includes fastest transfer option in slot #3 when >=3 direct options also exist', () => {
      const directs = [
        makeOption('123', 1, 6),
        makeOption('11', 0, 7),
        makeOption('24', 1, 8)
      ];
      const transfer: RecommendedBusOption = { ...makeOption('49', 2, 12), is_transfer: true };
      const picked = selectTop3MixedOptions(directs, [transfer], 3);
      expect(picked).toHaveLength(3);
      expect(picked[2].is_transfer).toBe(true);
      expect(picked[2].route.short_name).toBe('49');
    });

    it('prefers direct route over slower transfer even when transfer boards at a closer stop within 600m', () => {
      const direct = makeOption('47', 4, 11);
      direct.origin_stop.distance_meters = 260;

      const slowCloserTransfer: RecommendedBusOption = {
        ...makeOption('14', 3, 24),
        is_transfer: true
      };
      slowCloserTransfer.origin_stop.distance_meters = 110;

      const picked = selectTop3MixedOptions([direct], [slowCloserTransfer], 3);
      expect(picked[0].route.short_name).toBe('47');
      expect(picked[0].is_transfer).toBeFalsy();
    });
  });

  describe('selectBestSingleOption', () => {
    it('picks the single fastest direct route and discards redundant mid-corridor transfers', () => {
      const directs = [
        makeOption('24', 3, 9),
        makeOption('11', 2, 7)
      ];
      // Even if marked faster on paper, transfer starting with direct Line 11 is redundant
      const redundantTransfer: RecommendedBusOption = {
        ...makeOption('11', 1, 5),
        is_transfer: true
      };
      const picked = selectBestSingleOption(directs, [redundantTransfer]);
      expect(picked?.route.short_name).toBe('11');
      expect(picked?.is_transfer).toBeUndefined();
      expect(picked?.rank).toBe(1);
    });

    it('picks the single fastest 1-transfer route when no direct route exists', () => {
      const tSlow: RecommendedBusOption = { ...makeOption('123', 4, 24), is_transfer: true };
      const tFast: RecommendedBusOption = { ...makeOption('24', 2, 16), is_transfer: true };
      const picked = selectBestSingleOption([], [tSlow, tFast]);
      expect(picked?.route.short_name).toBe('24');
      expect(picked?.is_transfer).toBe(true);
      expect(picked?.rank).toBe(1);
    });
  });

  describe('buildTripOptions', () => {
    it('builds structured legs for direct and transfer trips up to 3 options', () => {
      const direct = makeOption('24', 3, 12);
      const baseTransfer = makeOption('49', 4, 25);
      const transfer: RecommendedBusOption = {
        ...baseTransfer,
        is_transfer: true,
        stops_between: 9,
        ride_duration_min: 17,
        transfer_info: {
          alight_stop: {
            stop_id: 'stop-hub',
            stop_code: '42656',
            stop_name: 'Matam',
            stop_name_he: 'מת"מ',
            stop_sequence: 10,
            lat: 32.7904,
            lon: 34.9613
          },
          board_stop: {
            stop_id: 'stop-hub2',
            stop_code: '42658',
            stop_name: 'Hof HaCarmel',
            stop_name_he: 'חוף הכרמל',
            stop_sequence: 1,
            lat: 32.7933,
            lon: 34.959
          },
          walk_meters: 95,
          wait_minutes: 4,
          arrive_at_hub_time: '19:12',
          next_bus_board_time: '19:16',
          instruction_ru: 'Выйти -> 17',
          instruction_en: 'Exit -> 17',
          instruction_he: 'לרדת -> 17'
        },
        second_leg: {
          route: {
            route_id: 'stride-10017',
            short_name: '17',
            long_name: 'Line 17',
            direction_id: 0,
            direction_label: 'Hof HaCarmel -> Rambam',
            available_directions: []
          },
          board_stop: {
            stop_id: 'stop-hub2',
            stop_code: '42658',
            stop_name: 'Hof HaCarmel',
            stop_name_he: 'חוף הכרמל',
            stop_sequence: 1,
            lat: 32.7933,
            lon: 34.959
          },
          alight_stop: baseTransfer.dest_stop,
          bus: { ...baseTransfer.bus, eta_minutes: 16 },
          stops_between: 3,
          ride_duration_min: 9,
          timeline_stops: []
        }
      };

      const tripOpts = buildTripOptions([direct, transfer], new Date('2026-11-17T17:00:00.000Z'));
      expect(tripOpts).toHaveLength(2);
      expect(tripOpts[0].transfers_count).toBe(0);
      expect(tripOpts[0].legs[0].leg_type).toBe('BOARD_AND_RIDE');
      expect(tripOpts[1].transfers_count).toBe(1);
      expect(tripOpts[1].legs.map((l) => l.leg_type)).toEqual(['BOARD_AND_RIDE', 'TRANSFER']);
      expect(tripOpts[1].legs[1].line_number).toBe('17');
      expect(tripOpts[1].legs[1].transfer_wait_min).toBe(4);
    });

    it('slices TripLeg.timeline_stops strictly between board and alight sequences while keeping full option timeline', () => {
      const fullTimeline = Array.from({ length: 8 }, (_, idx) => ({
        stop_id: `stop-${idx + 1}`,
        stop_code: String(40001 + idx),
        stop_name: `Stop ${idx + 1}`,
        stop_name_he: `תחנה ${idx + 1}`,
        stop_sequence: idx + 1,
        lat: 32.75 + idx * 0.002,
        lon: 34.97 + idx * 0.001,
        status: (idx + 1 === 3 ? 'user_stop' : idx + 1 < 2 ? 'passed' : 'upcoming') as
          | 'passed'
          | 'approaching'
          | 'user_stop'
          | 'upcoming'
      }));
      const direct = makeOption('47', 3, 12);
      direct.origin_stop.stop_sequence = 3;
      direct.dest_stop.stop_sequence = 6;
      direct.timeline_stops = fullTimeline;

      const tripOpts = buildTripOptions([direct], new Date('2026-11-17T17:00:00.000Z'));
      expect(direct.timeline_stops).toHaveLength(8);
      expect(tripOpts[0].legs[0].board_stop.stop_sequence).toBe(3);
      expect(tripOpts[0].legs[0].alight_stop.stop_sequence).toBe(6);
      expect(tripOpts[0].legs[0].timeline_stops?.map((s) => s.stop_sequence)).toEqual([3, 4, 5, 6]);
    });
  });

  describe('Route-Pair Cache (route:pair:...) with live ETA enrichment', () => {
    it('builds stable grid keys (~150m) for nearby coordinates and separates distant cells', () => {
      const k1 = buildRoutePairCacheKey(32.7618, 34.9711, 32.7828, 34.9859);
      const k2 = buildRoutePairCacheKey(32.7621, 34.9708, 32.7831, 34.9857);
      const kFar = buildRoutePairCacheKey(32.7900, 34.9600, 32.7828, 34.9859);

      expect(k1).toMatch(/^route:pair:-?\d+\.\d{4},-?\d+\.\d{4}:-?\d+\.\d{4},-?\d+\.\d{4}$/);
      expect(k1).toBe(k2);
      expect(k1).not.toBe(kFar);
    });

    it('skips DB topology search on CACHE HIT while recalculating live ETA from Redis bus:state', async () => {
      const routeStops: RouteStopCoord[] = [
        { stop_id: 's1', stop_code: '1001', stop_name: 'Stop 1', stop_name_he: 'תחנה 1', stop_sequence: 1, lat: 32.7600, lon: 34.9600 },
        { stop_id: 's2', stop_code: '1002', stop_name: 'Stop 2', stop_name_he: 'תחנה 2', stop_sequence: 2, lat: 32.7610, lon: 34.9640 },
        { stop_id: 's3', stop_code: '1003', stop_name: 'Stop 3', stop_name_he: 'תחנה 3', stop_sequence: 3, lat: 32.7615, lon: 34.9670 },
        { stop_id: 's4', stop_code: '1004', stop_name: 'Stop 4', stop_name_he: 'תחנה 4', stop_sequence: 4, lat: 32.7618, lon: 34.9690 },
        { stop_id: 's5', stop_code: '1005', stop_name: 'Origin Board', stop_name_he: 'תחנת עלייה', stop_sequence: 5, lat: 32.7621, lon: 34.9711 },
        { stop_id: 's6', stop_code: '1006', stop_name: 'Stop 6', stop_name_he: 'תחנה 6', stop_sequence: 6, lat: 32.7750, lon: 34.9800 },
        { stop_id: 's7', stop_code: '1007', stop_name: 'Horev Dest', stop_name_he: 'מרכז חורב', stop_sequence: 7, lat: 32.7832, lon: 34.9859 }
      ];

      const pairCacheStore = new Map<string, unknown>();
      let liveBusSeq = 1;
      let liveBusLat = 32.7600;
      let liveBusLon = 34.9600;

      const findDirectSpy = vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([
        {
          route_id: 'stride-10024',
          route_short_name: '24',
          route_long_name: 'Line 24 Express',
          direction_id: 0,
          origin_stop_id: 's5',
          origin_stop_code: '1005',
          origin_stop_name: 'Origin Board',
          origin_stop_name_he: 'תחנת עלייה',
          origin_stop_sequence: 5,
          origin_lat: 32.7621,
          origin_lon: 34.9711,
          dest_stop_id: 's7',
          dest_stop_code: '1007',
          dest_stop_name: 'Horev Dest',
          dest_stop_name_he: 'מרכז חורב',
          dest_stop_sequence: 7,
          dest_lat: 32.7832,
          dest_lon: 34.9859,
          stops_between: 2
        }
      ]);
      const findTransferSpy = vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([]);
      const stopsSpy = vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue(routeStops);
      const getPairSpy = vi
        .spyOn(redisService, 'getCachedRoutePair')
        .mockImplementation(async (key: string) => (pairCacheStore.get(key) as never) ?? null);
      const setPairSpy = vi
        .spyOn(redisService, 'setCachedRoutePair')
        .mockImplementation(async (key: string, payload: unknown) => {
          pairCacheStore.set(key, payload);
        });
      const touchSpy = vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      const busStateSpy = vi.spyOn(redisService, 'getBusState').mockImplementation(async () => ({
        route_id: 'stride-10024',
        direction_id: 0,
        updated_at: '2026-11-21T12:00:00Z',
        source: 'stride',
        vehicles: [
          {
            vehicle_id: 'bus-24-live',
            lat: liveBusLat,
            lon: liveBusLon,
            bearing: 45,
            recorded_at_time: '2026-11-21T12:00:00Z',
            current_stop_sequence: liveBusSeq,
            speed_kmh: 24
          }
        ]
      }));

      try {
        const destination = {
          lat: 32.7828,
          lon: 34.9859,
          place_name: 'Horev Center',
          formatted_address: 'Horev 15, Haifa',
          source: 'cache'
        };

        // 1st call: CACHE MISS -> queries Supabase & stores topology without ETA
        const firstRes = await planBestBusesToDestination({
          userLocation: { lat: 32.7618, lon: 34.9711 },
          destination,
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(findDirectSpy).toHaveBeenCalledTimes(1);
        expect(findTransferSpy).toHaveBeenCalledTimes(1);
        expect(setPairSpy).toHaveBeenCalledTimes(1);
        expect(setPairSpy.mock.calls[0]?.[2]).toBe(10_800);
        const storedJson = JSON.stringify(setPairSpy.mock.calls[0]?.[1]);
        expect(storedJson).not.toContain('eta_minutes');
        const firstEta = firstRes.recommended_options?.[0]?.eta_to_boarding_min ?? 99;

        // Advance vehicle closer to boarding stop in live bus:state cache
        liveBusSeq = 4;
        liveBusLat = 32.7618;
        liveBusLon = 34.9690;

        // 2nd call from nearby (~45m) coordinates in same ~150m grid cell: CACHE HIT
        const secondRes = await planBestBusesToDestination({
          userLocation: { lat: 32.7621, lon: 34.9708 },
          destination: { ...destination, lat: 32.7831, lon: 34.9857 },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(getPairSpy).toHaveBeenCalledTimes(2);
        expect(secondRes.cache_hit).toBe(true);
        // Zero additional Supabase queries on CACHE HIT
        expect(findDirectSpy).toHaveBeenCalledTimes(1);
        expect(findTransferSpy).toHaveBeenCalledTimes(1);
        expect(stopsSpy).toHaveBeenCalledTimes(1);
        expect(busStateSpy).toHaveBeenCalledTimes(2);
        expect(touchSpy).toHaveBeenCalledTimes(2);

        const secondEta = secondRes.recommended_options?.[0]?.eta_to_boarding_min ?? 99;
        expect(secondEta).toBeLessThan(firstEta);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('Strict GTFS route & transfer validation (no fabricated lines)', () => {
    it('rejects 2-transfer chains with repeated route IDs or invalid stop sequences', () => {
      const valid = {
        transfers_count: 2 as const,
        leg1_route_id: 'r1',
        leg1_route_short_name: '49',
        leg1_route_long_name: 'L49',
        leg1_direction_id: 0 as const,
        origin_stop_id: 's1',
        origin_stop_code: '1',
        origin_stop_name: 'O',
        origin_stop_name_he: 'O',
        origin_stop_sequence: 1,
        origin_lat: 32.7,
        origin_lon: 34.9,
        xfer1_alight_stop_id: 'x1a',
        xfer1_alight_stop_code: '2',
        xfer1_alight_stop_name: 'X1A',
        xfer1_alight_stop_name_he: 'X1A',
        xfer1_alight_stop_sequence: 10,
        xfer1_alight_lat: 32.79,
        xfer1_alight_lon: 34.95,
        leg1_stops_between: 9,
        xfer1_walk_meters: 50,
        leg2_route_id: 'r2',
        leg2_route_short_name: '910',
        leg2_route_long_name: 'L910',
        leg2_direction_id: 0 as const,
        xfer1_board_stop_id: 'x1b',
        xfer1_board_stop_code: '3',
        xfer1_board_stop_name: 'X1B',
        xfer1_board_stop_name_he: 'X1B',
        xfer1_board_stop_sequence: 1,
        xfer1_board_lat: 32.79,
        xfer1_board_lon: 34.95,
        xfer2_alight_stop_id: 'x2a',
        xfer2_alight_stop_code: '4',
        xfer2_alight_stop_name: 'X2A',
        xfer2_alight_stop_name_he: 'X2A',
        xfer2_alight_stop_sequence: 5,
        xfer2_alight_lat: 32.08,
        xfer2_alight_lon: 34.79,
        leg2_stops_between: 4,
        xfer2_walk_meters: 0,
        leg3_route_id: 'r3',
        leg3_route_short_name: '280',
        leg3_route_long_name: 'L280',
        leg3_direction_id: 0 as const,
        xfer2_board_stop_id: 'x2b',
        xfer2_board_stop_code: '5',
        xfer2_board_stop_name: 'X2B',
        xfer2_board_stop_name_he: 'X2B',
        xfer2_board_stop_sequence: 1,
        xfer2_board_lat: 32.08,
        xfer2_board_lon: 34.79,
        dest_stop_id: 'd1',
        dest_stop_code: '6',
        dest_stop_name: 'D',
        dest_stop_name_he: 'D',
        dest_stop_sequence: 3,
        dest_lat: 31.79,
        dest_lon: 34.65,
        leg3_stops_between: 2
      };

      const invalidDuplicateRoute = { ...valid, leg3_route_id: 'r1' };
      const invalidSeq = { ...valid, xfer2_board_stop_sequence: 5, dest_stop_sequence: 2 };

      const filtered = filterValidTwoTransferMatches([valid, invalidDuplicateRoute, invalidSeq]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].leg3_route_id).toBe('r3');
    });

    it('returns no_verified_route and nearest_confirmed_hub instead of guessing an unverified intercity bus', async () => {
      vi.spyOn(redisService, 'getCachedRoutePair').mockResolvedValue(null);
      vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'findNearestConfirmedHub').mockResolvedValue({
        stop_id: 'stop-42658',
        stop_code: '42658',
        stop_name: 'Hof HaCarmel Central Station',
        stop_name_he: 'ת. מרכזית חוף הכרמל (חיפה)',
        stop_sequence: 1,
        lat: 32.7934,
        lon: 34.959,
        distance_meters: 2100
      });

      try {
        const res = await planBestBusesToDestination({
          userLocation: { lat: 32.7618, lon: 34.9711 },
          destination: {
            lat: 29.5569,
            lon: 34.9498,
            place_name: 'אילת - תחנה מרכזית',
            formatted_address: 'Eilat, Israel',
            destination_granularity: 'city'
          },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(res.no_verified_route).toBe(true);
        expect(res.trip_options).toEqual([]);
        expect(res.recommended_options).toEqual([]);
        expect(res.routing_notice?.nearest_confirmed_hub?.stop_id).toBe('stop-42658');
        expect(res.routing_notice?.message_ru).toContain('Подтверждённой автобусной связки GTFS');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('returns full GTFS stops & an explicitly estimated (non-live) ETA for Eilat / Be\'er Sheva when Redis bus:state is empty', async () => {
      vi.spyOn(redisService, 'getCachedRoutePair').mockResolvedValue(null);
      vi.spyOn(redisService, 'setCachedRoutePair').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

      vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([
        {
          route_id: 'stride-10993',
          route_short_name: '993',
          route_long_name: 'חיפה - תל אביב - באר שבע - אילת',
          direction_id: 0,
          origin_stop_id: 'stop-42362',
          origin_stop_code: '42362',
          origin_stop_name: 'Matam (Haifa)',
          origin_stop_name_he: "מת''מ/ההגנה (חיפה)",
          origin_stop_sequence: 2,
          origin_lat: 32.7896,
          origin_lon: 34.9621,
          dest_stop_id: 'stop-59001',
          dest_stop_code: '59001',
          dest_stop_name: 'Eilat - Central Bus Station',
          dest_stop_name_he: 'אילת - תחנה מרכזית',
          dest_stop_sequence: 8,
          dest_lat: 29.5569,
          dest_lon: 34.9498,
          stops_between: 6
        }
      ]);
      vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'getDirectionStopCoords').mockResolvedValue([
        { stop_id: 'stop-42658', stop_code: '42658', stop_name: 'Hof HaCarmel', stop_name_he: 'חוף הכרמל', stop_sequence: 1, lat: 32.7934, lon: 34.959 },
        { stop_id: 'stop-42362', stop_code: '42362', stop_name: 'Matam', stop_name_he: "מת''מ/ההגנה", stop_sequence: 2, lat: 32.7896, lon: 34.9621 },
        { stop_id: 'stop-45003', stop_code: '45003', stop_name: 'Tel Aviv Savidor', stop_name_he: 'תל אביב סבידור', stop_sequence: 3, lat: 32.0837, lon: 34.7978 },
        { stop_id: 'stop-48001', stop_code: '48001', stop_name: 'Kiryat Gat', stop_name_he: 'קריית גת', stop_sequence: 4, lat: 31.6095, lon: 34.7642 },
        { stop_id: 'stop-53001', stop_code: '53001', stop_name: "Be'er Sheva CBS", stop_name_he: 'באר שבע - ת. מרכזית', stop_sequence: 5, lat: 31.2439, lon: 34.7966 },
        { stop_id: 'stop-54001', stop_code: '54001', stop_name: 'Dimona', stop_name_he: 'דימונה', stop_sequence: 6, lat: 31.07, lon: 35.033 },
        { stop_id: 'stop-55001', stop_code: '55001', stop_name: 'Mitzpe Ramon', stop_name_he: 'מצפה רמון', stop_sequence: 7, lat: 30.61, lon: 34.801 },
        { stop_id: 'stop-59001', stop_code: '59001', stop_name: 'Eilat CBS', stop_name_he: 'אילת - תחנה מרכזית', stop_sequence: 8, lat: 29.5569, lon: 34.9498 },
        { stop_id: 'stop-59002', stop_code: '59002', stop_name: 'Eilat Mall HaYam', stop_name_he: 'אילת - מול הים', stop_sequence: 9, lat: 29.5472, lon: 34.9535 }
      ]);

      try {
        const res = await planBestBusesToDestination({
          userLocation: { lat: 32.7895, lon: 34.964 },
          destination: {
            lat: 29.5569,
            lon: 34.9498,
            place_name: 'אילת - תחנה מרכזית',
            formatted_address: 'Eilat Central Bus Station, Israel',
            destination_granularity: 'city'
          },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        expect(res.no_verified_route).toBeUndefined();
        expect(res.route.short_name).toBe('993');
        expect(res.nearest_bus?.eta_source).toBe('estimated');
        expect(res.nearest_bus?.is_realtime).toBe(false);
        expect(res.timeline_stops).toHaveLength(9);
        expect(res.timeline_window?.total_stops_count).toBe(9);
        expect(res.trip_options).toHaveLength(1);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('decomposes 2-transfer intercity journeys via major hubs without calling unpruned SQL joins', async () => {
      const directSpy = vi
        .spyOn(supabaseService, 'findDirectRoutesBetweenPoints')
        .mockImplementation(async (origLat, _origLon, destLat) => {
          // Leg 1: Tirat Carmel -> Hof HaCarmel (Line 49)
          if (Math.abs(origLat - 32.7615) < 0.01 && Math.abs(destLat - 32.7934) < 0.02) {
            return [
              {
                route_id: 'stride-10049',
                route_short_name: '49',
                route_long_name: 'טירת כרמל - חוף הכרמל',
                direction_id: 0,
                origin_stop_id: 'stop-40888',
                origin_stop_code: '40888',
                origin_stop_name: 'שדרות אריאל שרון/השחף (טירת כרמל)',
                origin_stop_name_he: 'שדרות אריאל שרון/השחף (טירת כרמל)',
                origin_stop_sequence: 3,
                origin_lat: 32.7615,
                origin_lon: 34.9718,
                dest_stop_id: 'stop-42657',
                dest_stop_code: '42657',
                dest_stop_name: 'ת. מרכזית חוף הכרמל/הורדה (חיפה)',
                dest_stop_name_he: 'ת. מרכזית חוף הכרמל/הורדה (חיפה)',
                dest_stop_sequence: 20,
                dest_lat: 32.7934,
                dest_lon: 34.9596,
                stops_between: 17
              }
            ];
          }
          // Leg 2: Hof HaCarmel -> Tel Aviv Savidor (Line 910)
          if (Math.abs(origLat - 32.7934) < 0.02 && Math.abs(destLat - 32.0837) < 0.05) {
            return [
              {
                route_id: 'gtfs-7192-7189',
                route_short_name: '910',
                route_long_name: 'חיפה - תל אביב',
                direction_id: 0,
                origin_stop_id: 'stop-42658',
                origin_stop_code: '42658',
                origin_stop_name: 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)',
                origin_stop_name_he: 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)',
                origin_stop_sequence: 1,
                origin_lat: 32.7934,
                origin_lon: 34.9590,
                dest_stop_id: 'stop-28624',
                dest_stop_code: '28624',
                dest_stop_name: 'ת. רכבת תל אביב - סבידור מרכז/רציפים (תל אביב יפו)',
                dest_stop_name_he: 'ת. רכבת תל אביב - סבידור מרכז/רציפים (תל אביב יפו)',
                dest_stop_sequence: 25,
                dest_lat: 32.0837,
                dest_lon: 34.7978,
                stops_between: 24
              }
            ];
          }
          // Leg 3: Tel Aviv Savidor -> Rehovot (Line 301)
          if (Math.abs(origLat - 32.0837) < 0.05 && Math.abs(destLat - 31.8935) < 0.05) {
            return [
              {
                route_id: 'gtfs-3354-3356',
                route_short_name: '301',
                route_long_name: 'תל אביב - רחובות - אשקלון',
                direction_id: 0,
                origin_stop_id: 'stop-28624',
                origin_stop_code: '28624',
                origin_stop_name: 'ת. רכבת תל אביב - סבידור מרכז/רציפים (תל אביב יפו)',
                origin_stop_name_he: 'ת. רכבת תל אביב - סבידור מרכז/רציפים (תל אביב יפו)',
                origin_stop_sequence: 1,
                origin_lat: 32.0837,
                origin_lon: 34.7978,
                dest_stop_id: 'stop-31100',
                dest_stop_code: '31100',
                dest_stop_name: 'ת. מרכזית רחובות/רציפים (רחובות)',
                dest_stop_name_he: 'ת. מרכזית רחובות/רציפים (רחובות)',
                dest_stop_sequence: 22,
                dest_lat: 31.8935,
                dest_lon: 34.8077,
                stops_between: 21
              }
            ];
          }
          return [];
        });

      const xferSpy = vi
        .spyOn(supabaseService, 'findTransferRoutesBetweenPoints')
        .mockResolvedValue([]);

      try {
        const matches = await supabaseService.findTransferTrips(
          32.7615,
          34.9718,
          31.8935,
          34.8077,
          600,
          2
        );
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].transfers_count).toBe(2);
        expect(matches[0].leg1_route_short_name).toBe('49');
        expect(matches[0].leg2_route_short_name).toBe('910');
        expect(matches[0].leg3_route_short_name).toBe('301');
        expect(matches[0].dest_stop_id).toBe('stop-31100');
        expect(directSpy).toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('uses GTFS stop_times schedules, real 1-transfer wait times, and final walk to destination', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-23T10:00:00+02:00'));

      scheduleService.setScheduleOverrideForTests(
        new Map([
          // Leg 1: departs 10:05 (605) at seq 1, arrives seq 3 at 10:15 (offset 10 -> ride 10m from seq 1)
          ['gtfs-1x-a:0', { w: [605, 640], f: [], s: [], o: [0, 5, 10] }],
          // Leg 2: arrives hub at 10:15 + 1m walk + 1m margin = 10:17 (17m).
          // Scheduled dep at 626 + offset 0 at seq 1 -> 10:26 (eta=26 -> wait = 26 - 15 = 11m, ride 12m -> alight 10:38)
          // Final walk ~225m -> ceil(225/75) = 3m -> total = 41m (10:41)
          ['gtfs-1x-b:0', { w: [610, 626], f: [], s: [], o: [0, 6, 12] }]
        ])
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
      vi.spyOn(redisService, 'getCachedRoutePair').mockResolvedValue(null);
      vi.spyOn(redisService, 'setCachedRoutePair').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

      const makeStops = (prefix: string, count: number, baseLat: number, endLat?: number): RouteStopCoord[] =>
        Array.from({ length: count }, (_, idx) => ({
          stop_id: `${prefix}-s${idx + 1}`,
          stop_code: `${prefix}${idx + 1}`,
          stop_name: `${prefix} Stop ${idx + 1}`,
          stop_name_he: `${prefix} תחנה ${idx + 1}`,
          stop_sequence: idx + 1,
          lat: idx === count - 1 && endLat !== undefined ? endLat : baseLat + idx * 0.01,
          lon: 34.96
        }));

      vi.spyOn(supabaseService, 'getDirectionStopCoords').mockImplementation(async (routeId) => {
        if (routeId === 'gtfs-1x-a') return makeStops('a', 3, 32.76);
        return makeStops('b', 3, 32.78, 32.81);
      });
      vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([
        {
          transfers_count: 1,
          leg1_route_id: 'gtfs-1x-a',
          leg1_route_short_name: '24',
          leg1_route_long_name: 'Leg A',
          leg1_direction_id: 0,
          origin_stop_id: 'a-s1',
          origin_stop_code: 'a1',
          origin_stop_name: 'Origin',
          origin_stop_name_he: 'מוצא',
          origin_stop_sequence: 1,
          origin_lat: 32.76,
          origin_lon: 34.96,
          xfer1_alight_stop_id: 'a-s3',
          xfer1_alight_stop_code: 'a3',
          xfer1_alight_stop_name: 'Hub',
          xfer1_alight_stop_name_he: 'צומת',
          xfer1_alight_stop_sequence: 3,
          xfer1_alight_lat: 32.78,
          xfer1_alight_lon: 34.96,
          leg1_stops_between: 2,
          xfer1_walk_meters: 50,
          leg2_route_id: 'gtfs-1x-b',
          leg2_route_short_name: '37',
          leg2_route_long_name: 'Leg B',
          leg2_direction_id: 0,
          xfer1_board_stop_id: 'b-s1',
          xfer1_board_stop_code: 'b1',
          xfer1_board_stop_name: 'Hub Board',
          xfer1_board_stop_name_he: 'צומת עלייה',
          xfer1_board_stop_sequence: 1,
          xfer1_board_lat: 32.7804,
          xfer1_board_lon: 34.96,
          dest_stop_id: 'b-s3',
          dest_stop_code: 'b3',
          dest_stop_name: 'Dest',
          dest_stop_name_he: 'יעד',
          dest_stop_sequence: 3,
          dest_lat: 32.81,
          dest_lon: 34.96,
          leg2_stops_between: 2
        }
      ]);

      try {
        // Destination is ~225 m south of b-s3 -> 3 min final walk
        const res = await planBestBusesToDestination({
          userLocation: { lat: 32.76, lon: 34.96 },
          destination: {
            lat: 32.808,
            lon: 34.96,
            place_name: 'Technion',
            formatted_address: 'Technion, Haifa'
          },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        const opt = res.recommended_options?.[0];
        const trip = res.trip_options?.[0];
        expect(opt?.bus.eta_source).toBe('scheduled');
        expect(opt?.eta_to_boarding_min).toBe(5);
        expect(opt?.ride_duration_min).toBe(22);
        expect(opt?.transfer_info?.wait_minutes).toBe(11);
        expect(trip?.legs[1].transfer_wait_min).toBe(11);
        expect(opt?.walk_to_dest_min).toBe(3);
        expect(opt?.total_arrival_min).toBe(41);
        expect(opt?.estimated_arrival_time).toBe('10:41');
      } finally {
        vi.useRealTimers();
        scheduleService.clearScheduleOverrideForTests();
        vi.restoreAllMocks();
      }
    });

    it('uses GTFS stop_times schedules, real 2-transfer wait times, and final walk to destination in total ETA', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // Monday 10:00 IST -> minutesSinceMidnight = 600
      vi.setSystemTime(new Date('2026-11-23T10:00:00+02:00'));

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      scheduleService.setScheduleOverrideForTests(
        new Map([
          // Leg 1: departs 10:05 (605) at seq 1, offset 5m at seq 2 -> boards at 10:10 (eta=10), arrives hub1 seq 4 (+18-5=13m -> 10:23)
          ['gtfs-leg1:0', { w: [605, 640], f: [], s: [], o: [0, 5, 11, 18] }],
          // Leg 2: arrives hub1 10:23 + 1m walk + 1m margin = minBoard 10:25 (25m from now).
          // Scheduled dep at 637 + offset 0 at seq 1 -> 10:37 (eta=37 -> wait = 37 - 23 = 14 min, NOT fixed 5!)
          // Ride seq 1..3 = 20 min -> arrives hub2 at 10:57 (57m from now).
          ['gtfs-leg2:0', { w: [615, 637], f: [], s: [], o: [0, 10, 20] }],
          // Leg 3: arrives hub2 10:57 + 1m walk + 1m margin = minBoard 10:59 (59m from now).
          // Scheduled dep 668 + offset 0 -> 11:08 (eta=68 -> wait = 68 - 57 = 11 min, NOT fixed 6!)
          // Ride seq 1..3 = 15 min -> alight at 11:23 (83m).
          // Plus ~300m final walk from alight stop to destination -> ceil(300/75) = 4 min -> total = 87 min (11:27)!
          ['gtfs-leg3:0', { w: [645, 668], f: [], s: [], o: [0, 7, 15] }]
        ])
      );

      vi.spyOn(redisService, 'getCachedRoutePair').mockResolvedValue(null);
      vi.spyOn(redisService, 'setCachedRoutePair').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'touchActiveRoute').mockResolvedValue(undefined);
      vi.spyOn(redisService, 'getBusState').mockResolvedValue(null);

      const makeStops = (prefix: string, count: number, baseLat: number, endLat?: number, endLon?: number): RouteStopCoord[] =>
        Array.from({ length: count }, (_, idx) => ({
          stop_id: `${prefix}-s${idx + 1}`,
          stop_code: `${prefix}${idx + 1}`,
          stop_name: `${prefix} Stop ${idx + 1}`,
          stop_name_he: `${prefix} תחנה ${idx + 1}`,
          stop_sequence: idx + 1,
          lat: idx === count - 1 && endLat !== undefined ? endLat : baseLat + idx * 0.01,
          lon: idx === count - 1 && endLon !== undefined ? endLon : 34.96
        }));

      vi.spyOn(supabaseService, 'getDirectionStopCoords').mockImplementation(async (routeId) => {
        if (routeId === 'gtfs-leg1') return makeStops('l1', 4, 32.76);
        if (routeId === 'gtfs-leg2') return makeStops('l2', 3, 32.50);
        return makeStops('l3', 3, 31.90, 31.8913, 34.7796);
      });

      vi.spyOn(supabaseService, 'findDirectTrips').mockResolvedValue([]);
      vi.spyOn(supabaseService, 'findTransferTrips').mockResolvedValue([
        {
          transfers_count: 2,
          leg1_route_id: 'gtfs-leg1',
          leg1_route_short_name: '49',
          leg1_route_long_name: 'Leg 1',
          leg1_direction_id: 0,
          origin_stop_id: 'l1-s2',
          origin_stop_code: 'l12',
          origin_stop_name: 'Origin Board',
          origin_stop_name_he: 'עלייה',
          origin_stop_sequence: 2,
          origin_lat: 32.77,
          origin_lon: 34.96,
          xfer1_alight_stop_id: 'l1-s4',
          xfer1_alight_stop_code: 'l14',
          xfer1_alight_stop_name: 'Hub 1',
          xfer1_alight_stop_name_he: 'מרכזית 1',
          xfer1_alight_stop_sequence: 4,
          xfer1_alight_lat: 32.79,
          xfer1_alight_lon: 34.96,
          leg1_stops_between: 2,
          xfer1_walk_meters: 50,
          leg2_route_id: 'gtfs-leg2',
          leg2_route_short_name: '900',
          leg2_route_long_name: 'Leg 2',
          leg2_direction_id: 0,
          xfer1_board_stop_id: 'l2-s1',
          xfer1_board_stop_code: 'l21',
          xfer1_board_stop_name: 'Hub 1 Board',
          xfer1_board_stop_name_he: 'מרכזית 1 עלייה',
          xfer1_board_stop_sequence: 1,
          xfer1_board_lat: 32.7904,
          xfer1_board_lon: 34.96,
          xfer2_alight_stop_id: 'l2-s3',
          xfer2_alight_stop_code: 'l23',
          xfer2_alight_stop_name: 'Hub 2',
          xfer2_alight_stop_name_he: 'מרכזית 2',
          xfer2_alight_stop_sequence: 3,
          xfer2_alight_lat: 32.08,
          xfer2_alight_lon: 34.79,
          leg2_stops_between: 2,
          xfer2_walk_meters: 60,
          leg3_route_id: 'gtfs-leg3',
          leg3_route_short_name: '272',
          leg3_route_long_name: 'Leg 3',
          leg3_direction_id: 0,
          xfer2_board_stop_id: 'l3-s1',
          xfer2_board_stop_code: 'l31',
          xfer2_board_stop_name: 'Hub 2 Board',
          xfer2_board_stop_name_he: 'מרכזית 2 עלייה',
          xfer2_board_stop_sequence: 1,
          xfer2_board_lat: 32.0805,
          xfer2_board_lon: 34.79,
          dest_stop_id: 'l3-s3',
          dest_stop_code: 'l33',
          dest_stop_name: 'Dest Alight',
          dest_stop_name_he: 'יעד',
          dest_stop_sequence: 3,
          dest_lat: 31.8913,
          dest_lon: 34.7796,
          leg3_stops_between: 2
        }
      ]);

      try {
        // Destination is ~300 m south of dest_stop -> 4 min walk added to total arrival time!
        const res = await planBestBusesToDestination({
          userLocation: { lat: 32.77, lon: 34.96 },
          destination: {
            lat: 31.8886,
            lon: 34.7796,
            place_name: 'Final Dest',
            formatted_address: 'Dest St, Rehovot'
          },
          entryContext: 'standalone',
          allowColdBootstrap: false
        });

        const opt = res.recommended_options?.[0];
        const trip = res.trip_options?.[0];
        expect(opt).toBeDefined();
        expect(trip).toBeDefined();
        expect(opt?.bus.eta_source).toBe('scheduled');
        expect(opt?.eta_to_boarding_min).toBe(10);
        expect(opt?.ride_duration_min).toBe(13 + 20 + 15);
        expect(trip?.legs[1].transfer_wait_min).toBe(14);
        expect(trip?.legs[2].transfer_wait_min).toBe(11);
        expect(opt?.walk_to_dest_min).toBe(4);
        expect(trip?.walk_to_dest_min).toBe(4);
        expect(trip?.walk_to_dest_meters).toBeGreaterThan(250);
        expect(opt?.total_arrival_min).toBe(87);
        expect(trip?.total_duration_min).toBe(87);
        expect(opt?.estimated_arrival_time).toBe('11:27');
      } finally {
        vi.useRealTimers();
        scheduleService.clearScheduleOverrideForTests();
        vi.restoreAllMocks();
      }
    });
  });
});

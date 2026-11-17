import { describe, expect, it } from 'vitest';
import {
  calculateTransferTripMetrics,
  calculateTripMetrics,
  filterApproachingVehicles,
  filterValidDirectionMatches,
  filterValidTransferMatches,
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
});

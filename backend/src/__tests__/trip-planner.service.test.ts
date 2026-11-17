import { describe, expect, it } from 'vitest';
import {
  calculateTripMetrics,
  filterApproachingVehicles,
  filterValidDirectionMatches,
  rankTopBusOptions
} from '../services/trip-planner.service.js';
import type {
  DirectRouteMatch,
  RecommendedBusOption,
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
});

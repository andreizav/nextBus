import { describe, expect, it } from 'vitest';
import {
  buildTimelineWindow,
  calculateEtaMinutes,
  calculateStopsAway,
  projectCoordinatesToBbox,
  resolveRenderMode,
  selectNearestApproachingVehicle
} from '../services/eta.service.js';
import type { BoundingBox, StopTimelineItem, VehicleTelemetry } from '../types/bus.types.js';

describe('ETA and Hybrid Rendering calculations', () => {
  describe('calculateStopsAway', () => {
    it('returns the exact stop sequence difference when bus is approaching', () => {
      expect(calculateStopsAway(5, 3)).toBe(2);
      expect(calculateStopsAway(7, 2)).toBe(5);
    });

    it('clamps to 0 when the bus is at or past the user stop', () => {
      expect(calculateStopsAway(5, 5)).toBe(0);
      expect(calculateStopsAway(3, 6)).toBe(0);
    });
  });

  describe('calculateEtaMinutes', () => {
    it('returns 0 when bus is 0 stops away and within 80m', () => {
      expect(calculateEtaMinutes(0, 40)).toBe(0);
    });

    it('estimates realistic minutes from stopsAway when distance is omitted', () => {
      expect(calculateEtaMinutes(2)).toBe(4);
      expect(calculateEtaMinutes(5)).toBe(10);
    });

    it('uses distance and speed plus dwell time when provided', () => {
      // 1.6 km at 24 km/h = 4 min travel + (3 - 1) * 0.6 min dwell = 5.2 -> 5 min
      expect(calculateEtaMinutes(3, 1600, 24)).toBe(5);
    });
  });

  describe('resolveRenderMode', () => {
    it('selects "lite" when ETA <= 8 minutes and includeNearbyPlaces is false', () => {
      expect(resolveRenderMode(1, false)).toBe('lite');
      expect(resolveRenderMode(4, false)).toBe('lite');
      expect(resolveRenderMode(8, false)).toBe('lite');
      expect(resolveRenderMode(8)).toBe('lite');
    });

    it('selects "interactive" when ETA > 8 minutes', () => {
      expect(resolveRenderMode(9, false)).toBe('interactive');
      expect(resolveRenderMode(15, false)).toBe('interactive');
    });

    it('selects "interactive" whenever includeNearbyPlaces is true, regardless of ETA', () => {
      expect(resolveRenderMode(2, true)).toBe('interactive');
      expect(resolveRenderMode(8, true)).toBe('interactive');
      expect(resolveRenderMode(12, true)).toBe('interactive');
    });
  });

  describe('projectCoordinatesToBbox', () => {
    const bbox: BoundingBox = {
      minLat: 32.755,
      maxLat: 32.798,
      minLon: 34.955,
      maxLon: 34.980
    };

    it('projects midpoint to ~50% on both axes', () => {
      const projection = projectCoordinatesToBbox(32.7765, 34.9675, bbox);
      expect(projection.xPercent).toBeCloseTo(50, 1);
      expect(projection.yPercent).toBeCloseTo(50, 1);
    });

    it('clamps coordinates outside bbox safely inside [2, 98]', () => {
      const topLeft = projectCoordinatesToBbox(33.0, 34.0, bbox);
      expect(topLeft.xPercent).toBe(2);
      expect(topLeft.yPercent).toBe(2);

      const bottomRight = projectCoordinatesToBbox(32.0, 35.5, bbox);
      expect(bottomRight.xPercent).toBe(98);
      expect(bottomRight.yPercent).toBe(98);
    });
  });

  describe('selectNearestApproachingVehicle', () => {
    const vehicles: VehicleTelemetry[] = [
      {
        vehicle_id: 'bus-far',
        lat: 32.759,
        lon: 34.972,
        bearing: 0,
        recorded_at_time: '2026-11-17T16:00:00Z',
        current_stop_sequence: 1
      },
      {
        vehicle_id: 'bus-near',
        lat: 32.771,
        lon: 34.971,
        bearing: 0,
        recorded_at_time: '2026-11-17T16:00:00Z',
        current_stop_sequence: 4
      },
      {
        vehicle_id: 'bus-passed',
        lat: 32.787,
        lon: 34.962,
        bearing: 0,
        recorded_at_time: '2026-11-17T16:00:00Z',
        current_stop_sequence: 6
      }
    ];

    it('prefers the closest approaching vehicle at or before the user stop', () => {
      const picked = selectNearestApproachingVehicle(vehicles, 5, 32.7804, 34.9658);
      expect(picked?.vehicle_id).toBe('bus-near');
    });

    it('returns null when all buses have already passed the user stop', () => {
      const onlyPassed = vehicles.filter((v) => v.current_stop_sequence > 5);
      expect(selectNearestApproachingVehicle(onlyPassed, 5, 32.7804, 34.9658)).toBeNull();
    });

    it('returns null when no vehicles are active', () => {
      expect(selectNearestApproachingVehicle([], 5, 32.7804, 34.9658)).toBeNull();
    });
  });

  describe('buildTimelineWindow', () => {
    it('slices long 30-stop routes into a compact window and preserves hidden counts', () => {
      const longStops: StopTimelineItem[] = Array.from({ length: 30 }, (_, idx) => {
        const seq = idx + 1;
        return {
          stop_id: `s-${seq}`,
          stop_code: `${40000 + seq}`,
          stop_name: `Stop ${seq}`,
          stop_name_he: `תחנה ${seq}`,
          stop_sequence: seq,
          lat: 32.75 + seq * 0.001,
          lon: 34.96,
          status: seq < 16 ? 'passed' : seq === 20 ? 'user_stop' : 'upcoming'
        };
      });

      const win = buildTimelineWindow(longStops, 20, 16, 2);
      expect(win.total_stops_count).toBe(30);
      expect(win.user_stop?.stop_sequence).toBe(20);
      expect(win.current_bus_stop?.stop_sequence).toBe(16);
      expect(win.compact_stops.map((s) => s.stop_sequence)).toEqual([16, 18, 19, 20, 21, 22, 23]);
      expect(win.compact_stops.length + win.hidden_past_count + win.hidden_upcoming_count).toBe(30);
      expect(win.hidden_past_count).toBe(16);
      expect(win.hidden_upcoming_count).toBe(7);
    });
  });
});

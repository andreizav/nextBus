import { afterEach, describe, expect, it } from 'vitest';
import {
  clearScheduleOverrideForTests,
  getIsraelLocalClock,
  getLoadedScheduleCount,
  getNextScheduledDeparture,
  getScheduledRideDuration,
  setScheduleOverrideForTests,
  type CompactRouteSchedule
} from '../services/schedule.service.js';

describe('GTFS Schedule Service', () => {
  afterEach(() => {
    clearScheduleOverrideForTests();
  });

  it('loads the compiled nationwide GTFS schedule snapshot with >5,000 route directions', () => {
    expect(getLoadedScheduleCount()).toBeGreaterThan(5000);
  });

  it('resolves Israel local weekday, Friday, Saturday, and Sunday schedules accurately', () => {
    const map = new Map<string, CompactRouteSchedule>([
      [
        'gtfs-test:0',
        {
          w: [480, 500, 520], // Mon-Thu: 08:00, 08:20, 08:40
          u: [490, 515], // Sun: 08:10, 08:35
          f: [510, 570], // Fri: 08:30, 09:30
          s: [1200, 1260], // Sat: 20:00, 21:00
          o: [0, 3, 7, 12]
        }
      ]
    ]);
    setScheduleOverrideForTests(map);

    // Monday 2026-11-23 08:05 IST (+02:00) -> 485 min -> next dep at stop seq 3 (+7m): dep 480 arrives 487 (2 min!), OR if minWait=5 (target 490) -> skips 487, takes dep 500 -> arr 507 -> eta=22!
    const mon = new Date('2026-11-23T08:05:00+02:00');
    expect(getIsraelLocalClock(mon)).toEqual({ dayOfWeek: 1, minutesSinceMidnight: 485 });

    const monFast = getNextScheduledDeparture('gtfs-test', 0, 3, mon, 0);
    expect(monFast?.etaMinutes).toBe(2);
    expect(monFast?.stopOffsetMin).toBe(7);

    const monWalk = getNextScheduledDeparture('gtfs-test', 0, 3, mon, 5);
    expect(monWalk?.etaMinutes).toBe(22);

    // Sunday 2026-11-22 08:02 IST -> uses distinct `u` bucket (490 + 3 = 493 at seq 2 -> eta = 11)
    const sun = new Date('2026-11-22T08:02:00+02:00');
    expect(getNextScheduledDeparture('gtfs-test', 0, 2, sun, 0)?.etaMinutes).toBe(11);

    // Friday 2026-11-27 08:15 IST -> uses `f` bucket (510 at seq 1 -> eta = 15)
    const fri = new Date('2026-11-27T08:15:00+02:00');
    expect(getNextScheduledDeparture('gtfs-test', 0, 1, fri, 0)?.etaMinutes).toBe(15);

    // Saturday 2026-11-28 19:50 IST -> uses `s` bucket (1200 at seq 1 -> eta = 10)
    const sat = new Date('2026-11-28T19:50:00+02:00');
    expect(getNextScheduledDeparture('gtfs-test', 0, 1, sat, 0)?.etaMinutes).toBe(10);
  });

  it('handles overnight post-midnight GTFS departures (>= 24:00) from the previous service day', () => {
    setScheduleOverrideForTests(
      new Map([
        [
          'gtfs-night:0',
          {
            w: [360, 1465], // 06:00 and 24:25 (Thursday service continuing into early Friday)
            f: [420],
            s: [],
            o: [0, 5]
          }
        ]
      ])
    );

    // Friday 00:20 IST (min=20) at stop_sequence 2 (+5m) -> 24:25 + 5 = 24:30 -> eta = 10 min
    const earlyFri = new Date('2026-11-27T00:20:00+02:00');
    const dep = getNextScheduledDeparture('gtfs-night', 0, 2, earlyFri, 0);
    expect(dep?.etaMinutes).toBe(10);
  });

  it('computes exact scheduled ride duration between stop sequences', () => {
    setScheduleOverrideForTests(
      new Map([
        ['gtfs-dur:0', { w: [480], f: [], s: [], o: [0, 4, 9, 15, 22] }]
      ])
    );
    expect(getScheduledRideDuration('gtfs-dur', 0, 2, 5)).toBe(18);
    expect(getScheduledRideDuration('gtfs-dur', 0, 5, 2)).toBeNull();
    expect(getScheduledRideDuration('gtfs-missing', 0, 1, 3)).toBeNull();
  });
});

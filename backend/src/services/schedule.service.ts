import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CompactRouteSchedule {
  w: number[]; // Mon-Thu weekday departures (minutes from midnight, may exceed 1440 for post-midnight trips)
  u?: number[]; // Sunday departures when distinct from w
  f: number[]; // Friday departures
  s: number[]; // Saturday / Motzei Shabbat departures
  o: number[]; // Minutes offset per stop_sequence (index = stop_sequence - 1)
}

export interface ScheduledDepartureResult {
  etaMinutes: number;
  scheduledTimeHHMM: string;
  stopOffsetMin: number;
  originDepartureMin: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const MAX_SCHEDULE_LOOKAHEAD_MINUTES = 720; // 12 hours

let scheduleCache: Map<string, CompactRouteSchedule> | null = null;
let scheduleOverride: Map<string, CompactRouteSchedule> | null = null;

function resolveBundlePath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../data/gtfs-schedules.json.gz'),
    path.resolve(process.cwd(), 'data/gtfs-schedules.json.gz'),
    path.resolve(process.cwd(), 'backend/data/gtfs-schedules.json.gz')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getScheduleMap(): Map<string, CompactRouteSchedule> {
  if (scheduleOverride) {
    return scheduleOverride;
  }
  if (scheduleCache) {
    return scheduleCache;
  }

  const loaded = new Map<string, CompactRouteSchedule>();
  const bundlePath = resolveBundlePath();
  if (bundlePath) {
    try {
      const compressed = fs.readFileSync(bundlePath);
      const rawJson = zlib.gunzipSync(compressed).toString('utf8');
      const parsed = JSON.parse(rawJson) as { schedules?: Record<string, CompactRouteSchedule> };
      if (parsed && parsed.schedules && typeof parsed.schedules === 'object') {
        for (const [k, v] of Object.entries(parsed.schedules)) {
          loaded.set(k, v);
        }
      }
    } catch (err) {
      console.warn('[ScheduleService] Failed to load GTFS schedule snapshot:', (err as Error).message);
    }
  }

  scheduleCache = loaded;
  return scheduleCache;
}

export function setScheduleOverrideForTests(map: Map<string, CompactRouteSchedule>): void {
  scheduleOverride = map;
}

export function clearScheduleOverrideForTests(): void {
  scheduleOverride = null;
}

export function getIsraelLocalClock(date: Date): {
  dayOfWeek: number;
  minutesSinceMidnight: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  let weekdayStr = 'Sun';
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekdayStr = part.value;
    else if (part.type === 'hour') hour = Number.parseInt(part.value, 10) || 0;
    else if (part.type === 'minute') minute = Number.parseInt(part.value, 10) || 0;
  }
  if (hour === 24) hour = 0;

  return {
    dayOfWeek: WEEKDAY_MAP[weekdayStr] ?? 0,
    minutesSinceMidnight: hour * 60 + minute
  };
}

function formatIsraelHHMM(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).format(date);
}

function getBucketForDay(entry: CompactRouteSchedule, dayOfWeek: number): number[] {
  if (dayOfWeek === 0) return entry.u ?? entry.w;
  if (dayOfWeek === 5) return entry.f;
  if (dayOfWeek === 6) return entry.s;
  return entry.w;
}

function findFirstGreaterOrEqual(sorted: number[], minValue: number): number | undefined {
  if (sorted.length === 0) return undefined;
  let lo = 0;
  let hi = sorted.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] >= minValue) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans >= 0 ? sorted[ans] : undefined;
}

export function getNextScheduledDeparture(
  routeId: string,
  directionId: 0 | 1,
  stopSequence: number,
  now: Date = new Date(),
  minWaitMinutes = 0
): ScheduledDepartureResult | null {
  const entry = getScheduleMap().get(`${routeId}:${directionId}`);
  if (!entry) return null;

  const offsets = entry.o ?? [];
  const stopIdx = offsets.length > 0 ? Math.min(offsets.length - 1, Math.max(0, stopSequence - 1)) : -1;
  const stopOffsetMin = stopIdx >= 0 ? Math.max(0, offsets[stopIdx] ?? 0) : 0;

  const { dayOfWeek, minutesSinceMidnight: localMin } = getIsraelLocalClock(now);
  const minOffset = Math.max(0, Math.ceil(minWaitMinutes));
  const targetMin = localMin + minOffset;

  // 1. Check overnight trips from yesterday if local time is early morning (00:00..03:59)
  if (localMin < 240) {
    const yesterdayDow = (dayOfWeek + 6) % 7;
    const yesterdayDeps = getBucketForDay(entry, yesterdayDow);
    const overnightDep = findFirstGreaterOrEqual(
      yesterdayDeps,
      Math.max(1440, targetMin + 1440 - stopOffsetMin)
    );
    if (overnightDep !== undefined) {
      const arrivalMinOfDay = overnightDep - 1440 + stopOffsetMin;
      const etaMinutes = Math.max(minOffset, arrivalMinOfDay - localMin);
      if (etaMinutes <= MAX_SCHEDULE_LOOKAHEAD_MINUTES) {
        return {
          etaMinutes,
          scheduledTimeHHMM: formatIsraelHHMM(new Date(now.getTime() + etaMinutes * 60_000)),
          stopOffsetMin,
          originDepartureMin: overnightDep
        };
      }
    }
  }

  // 2. Check today's scheduled trips
  const todayDeps = getBucketForDay(entry, dayOfWeek);
  const todayDep = findFirstGreaterOrEqual(todayDeps, targetMin - stopOffsetMin);
  if (todayDep !== undefined) {
    const etaMinutes = Math.max(minOffset, todayDep + stopOffsetMin - localMin);
    if (etaMinutes <= MAX_SCHEDULE_LOOKAHEAD_MINUTES) {
      return {
        etaMinutes,
        scheduledTimeHHMM: formatIsraelHHMM(new Date(now.getTime() + etaMinutes * 60_000)),
        stopOffsetMin,
        originDepartureMin: todayDep
      };
    }
  }

  // 3. Check tomorrow's first trips (for late-night / early-morning rollover within 12h)
  const tomorrowDow = (dayOfWeek + 1) % 7;
  const tomorrowDeps = getBucketForDay(entry, tomorrowDow);
  const tomorrowDep = findFirstGreaterOrEqual(tomorrowDeps, targetMin - 1440 - stopOffsetMin);
  if (tomorrowDep !== undefined) {
    const etaMinutes = Math.max(minOffset, tomorrowDep + 1440 + stopOffsetMin - localMin);
    if (etaMinutes <= MAX_SCHEDULE_LOOKAHEAD_MINUTES) {
      return {
        etaMinutes,
        scheduledTimeHHMM: formatIsraelHHMM(new Date(now.getTime() + etaMinutes * 60_000)),
        stopOffsetMin,
        originDepartureMin: tomorrowDep
      };
    }
  }

  return null;
}

export function getScheduledRideDuration(
  routeId: string,
  directionId: 0 | 1,
  fromStopSequence: number,
  toStopSequence: number
): number | null {
  if (toStopSequence <= fromStopSequence || fromStopSequence < 1) {
    return null;
  }
  const entry = getScheduleMap().get(`${routeId}:${directionId}`);
  if (!entry || !entry.o || entry.o.length === 0) {
    return null;
  }
  const fromIdx = fromStopSequence - 1;
  const toIdx = toStopSequence - 1;
  if (fromIdx < 0 || toIdx >= entry.o.length) {
    return null;
  }
  return Math.max(1, (entry.o[toIdx] ?? 0) - (entry.o[fromIdx] ?? 0));
}

export function getLoadedScheduleCount(): number {
  return getScheduleMap().size;
}

export const scheduleService = {
  getIsraelLocalClock,
  getNextScheduledDeparture,
  getScheduledRideDuration,
  getLoadedScheduleCount,
  setScheduleOverrideForTests,
  clearScheduleOverrideForTests
};

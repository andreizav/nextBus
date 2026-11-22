import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MOT_GTFS_ZIP_URL = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';
const DEFAULT_GTFS_DIR = '/tmp/nextbus-gtfs-inspect';
const OUTPUT_GZ_PATH = path.resolve(__dirname, '../backend/data/gtfs-schedules.json.gz');

const LEGACY_LINE_REF_ALIASES: Record<string, [string, string]> = {
  'stride-10049': ['19632', '19631'],
  'route-49-haifa': ['19632', '19631'],
  'stride-10024': ['3695', '3697'],
  'stride-10011': ['3529', '3530'],
  'stride-10123': ['4134', '4135'],
  'stride-10037': ['3705', '3706'],
  'stride-10028': ['3721', '3722'],
  'stride-10017': ['3683', '3684']
};

export interface CompactRouteSchedule {
  w: number[];
  u?: number[];
  f: number[];
  s: number[];
  o: number[];
}

interface ParsedRouteCandidate {
  rawRouteId: string;
  shortName: string;
  longName: string;
  makat: string;
  rawDir: '1' | '2' | '3';
  alt: string;
  endpointPairKey: string;
  tripsCount: number;
  sampleTripId?: string;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function readGtfsCsv(
  filePath: string,
  onRow: (row: Record<string, string>) => void
): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let headers: string[] | null = null;
  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, '');
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols.map((h) => h.trim());
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cols[i] ?? '';
    }
    onRow(row);
  }
}

function normalizeEndpointPair(longName: string): string {
  const withoutSuffix = longName.replace(/-[^-]+$/, '').trim();
  const parts = withoutSuffix
    .split('<->')
    .map((p) => p.replace(/\/(?:רציפים|הורדה|איסוף)[^-]*/g, '').trim());
  if (parts.length === 2) {
    return [parts[0], parts[1]].sort().join('<->');
  }
  return withoutSuffix;
}

function parseHmsToMinutes(hms: string): number {
  const parts = hms.trim().split(':');
  if (parts.length < 2) return -1;
  const h = Number.parseInt(parts[0], 10);
  const m = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 36 || m < 0 || m >= 60) {
    return -1;
  }
  return h * 60 + m;
}

function addDaysYyyymmdd(yyyymmdd: string, deltaDays: number): string {
  const y = Number.parseInt(yyyymmdd.slice(0, 4), 10);
  const m = Number.parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = Number.parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function getDowYyyymmdd(yyyymmdd: string): number {
  const y = Number.parseInt(yyyymmdd.slice(0, 4), 10);
  const m = Number.parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = Number.parseInt(yyyymmdd.slice(6, 8), 10);
  return new Date(Date.UTC(y, m, d)).getUTCDay();
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function buildCanonicalCalendarBuckets(calendarFile: string): Promise<{
  serviceBuckets: Map<string, number>;
  feedWeek: { sun: string; wed: string; fri: string; sat: string };
}> {
  interface CalRow {
    serviceId: string;
    start: string;
    end: string;
    sunday: boolean;
    wednesday: boolean;
    friday: boolean;
    saturday: boolean;
  }
  const rows: CalRow[] = [];
  let minStart = '99999999';

  await readGtfsCsv(calendarFile, (r) => {
    const serviceId = r.service_id?.trim();
    const start = r.start_date?.trim() || '';
    const end = r.end_date?.trim() || '';
    if (!serviceId || start.length !== 8 || end.length !== 8) return;
    if (start < minStart) minStart = start;
    rows.push({
      serviceId,
      start,
      end,
      sunday: r.sunday === '1',
      wednesday: r.wednesday === '1',
      friday: r.friday === '1',
      saturday: r.saturday === '1'
    });
  });

  // Canonical week starting the day after minStartDate (avoids crossing into future-week duplicate services)
  const weekStart = addDaysYyyymmdd(minStart, 1);
  const refByDow: Record<number, string> = {};
  for (let k = 0; k < 7; k++) {
    const dateStr = addDaysYyyymmdd(weekStart, k);
    refByDow[getDowYyyymmdd(dateStr)] = dateStr;
  }
  const feedWeek = {
    sun: refByDow[0],
    wed: refByDow[3],
    fri: refByDow[5],
    sat: refByDow[6]
  };

  // bit 0 = u (Sun), bit 1 = w (Mon-Thu / canonical Wed), bit 2 = f (Fri), bit 3 = s (Sat)
  const serviceBuckets = new Map<string, number>();
  for (const r of rows) {
    let mask = 0;
    if (r.sunday && r.start <= feedWeek.sun && feedWeek.sun <= r.end) mask |= 1;
    if (r.wednesday && r.start <= feedWeek.wed && feedWeek.wed <= r.end) mask |= 2;
    if (r.friday && r.start <= feedWeek.fri && feedWeek.fri <= r.end) mask |= 4;
    if (r.saturday && r.start <= feedWeek.sat && feedWeek.sat <= r.end) mask |= 8;
    if (mask > 0) {
      serviceBuckets.set(r.serviceId, mask);
    }
  }

  return { serviceBuckets, feedWeek };
}

async function importSchedulesFromDir(gtfsDir: string): Promise<{
  generatedAt: string;
  feedWeek: { sun: string; wed: string; fri: string; sat: string };
  schedules: Record<string, CompactRouteSchedule>;
}> {
  const routesFile = path.join(gtfsDir, 'routes.txt');
  const stopsFile = path.join(gtfsDir, 'stops.txt');
  const tripsFile = path.join(gtfsDir, 'trips.txt');
  const stopTimesFile = path.join(gtfsDir, 'stop_times.txt');
  const calendarFile = path.join(gtfsDir, 'calendar.txt');
  const zipPath = path.join(gtfsDir, 'gtfs.zip');

  if (!fs.existsSync(calendarFile) && fs.existsSync(zipPath)) {
    console.log('[Schedule Importer] Extracting calendar.txt from gtfs.zip...');
    execFileSync('unzip', ['-o', '-q', zipPath, 'calendar.txt', '-d', gtfsDir]);
  }

  for (const f of [routesFile, stopsFile, tripsFile, stopTimesFile, calendarFile]) {
    if (!fs.existsSync(f)) {
      throw new Error(`Missing required GTFS file: ${f}`);
    }
  }

  const t0 = Date.now();
  const { serviceBuckets, feedWeek } = await buildCanonicalCalendarBuckets(calendarFile);
  console.log(
    `[Schedule Importer] Canonical week Sun=${feedWeek.sun} Wed=${feedWeek.wed} Fri=${feedWeek.fri} Sat=${feedWeek.sat} (${serviceBuckets.size} active services)`
  );

  // Map raw stop_id -> normalized `stop-<code>` (matching import-full-gtfs.ts adjacent dedupe)
  const rawStopToNormalized = new Map<string, string>();
  await readGtfsCsv(stopsFile, (row) => {
    const rawId = row.stop_id?.trim();
    if (!rawId) return;
    const stopCode = row.stop_code?.trim() || rawId;
    rawStopToNormalized.set(rawId, rawId.startsWith('stop-') ? rawId : `stop-${stopCode}`);
  });

  // Match exact route grouping logic from import-full-gtfs.ts
  const routeCandidates = new Map<string, ParsedRouteCandidate>();
  await readGtfsCsv(routesFile, (row) => {
    const rawId = row.route_id?.trim();
    const agencyId = row.agency_id?.trim() || '3';
    const routeType = row.route_type?.trim() || '3';
    const shortName = row.route_short_name?.trim() || '';
    if (!rawId || !shortName || routeType === '2' || agencyId === '2') return;

    const longName = row.route_long_name?.trim() || shortName;
    const desc = row.route_desc?.trim() || '';
    const descMatch = desc.match(/^(\d+)-(\d+)-(.+)$/);
    const makat = descMatch ? descMatch[1] : rawId;
    const rawDir: '1' | '2' | '3' =
      descMatch && descMatch[2] === '2'
        ? '2'
        : descMatch && descMatch[2] === '3'
          ? '3'
          : '1';
    const alt = descMatch ? descMatch[3] : '#';

    routeCandidates.set(rawId, {
      rawRouteId: rawId,
      shortName,
      longName,
      makat,
      rawDir,
      alt,
      endpointPairKey: normalizeEndpointPair(longName),
      tripsCount: 0
    });
  });

  const tripMeta = new Map<string, { rawRouteId: string; bucketMask: number }>();
  await readGtfsCsv(tripsFile, (row) => {
    const rawRouteId = row.route_id?.trim();
    const tripId = row.trip_id?.trim();
    const serviceId = row.service_id?.trim();
    if (!rawRouteId || !tripId) return;
    const cand = routeCandidates.get(rawRouteId);
    if (!cand) return;
    cand.tripsCount++;
    if (!cand.sampleTripId) {
      cand.sampleTripId = tripId;
    }
    const bucketMask = serviceBuckets.get(serviceId) ?? 0;
    if (bucketMask > 0) {
      tripMeta.set(tripId, { rawRouteId, bucketMask });
    }
  });

  const grouped = new Map<string, ParsedRouteCandidate[]>();
  for (const cand of routeCandidates.values()) {
    if (!cand.sampleTripId) continue;
    const key = `${cand.makat}:${cand.shortName}:${cand.endpointPairKey}`;
    const arr = grouped.get(key) ?? [];
    arr.push(cand);
    grouped.set(key, arr);
  }

  const pickBestVariant = (items: ParsedRouteCandidate[]): ParsedRouteCandidate | undefined =>
    items.sort(
      (a, b) =>
        (b.alt === '#' ? 1 : 0) - (a.alt === '#' ? 1 : 0) || b.tripsCount - a.tripsCount
    )[0];

  const rawToDb = new Map<string, { dbKey: string; sampleTripId: string }>();
  for (const cands of grouped.values()) {
    const d1 = pickBestVariant(cands.filter((c) => c.rawDir === '1'));
    const d2 = pickBestVariant(cands.filter((c) => c.rawDir === '2'));
    const d3 = pickBestVariant(cands.filter((c) => c.rawDir === '3'));

    if (d1 && (d2 || d3)) {
      const inbound = d2 ?? d3!;
      const dbRouteId = `gtfs-${d1.rawRouteId}-${inbound.rawRouteId}`;
      rawToDb.set(d1.rawRouteId, { dbKey: `${dbRouteId}:0`, sampleTripId: d1.sampleTripId! });
      rawToDb.set(inbound.rawRouteId, { dbKey: `${dbRouteId}:1`, sampleTripId: inbound.sampleTripId! });
      if (d2 && d3) {
        rawToDb.set(d3.rawRouteId, { dbKey: `gtfs-${d3.rawRouteId}:0`, sampleTripId: d3.sampleTripId! });
      }
    } else {
      const solo = d1 ?? d2 ?? d3;
      if (!solo) continue;
      rawToDb.set(solo.rawRouteId, { dbKey: `gtfs-${solo.rawRouteId}:0`, sampleTripId: solo.sampleTripId! });
    }
  }

  const sampleTrips = new Set(Array.from(rawToDb.values(), (v) => v.sampleTripId));
  const depBuckets = new Map<
    string,
    { u: Set<number>; w: Set<number>; f: Set<number>; s: Set<number> }
  >();
  const sampleStops = new Map<string, Array<{ seq: number; stopId: string; depMin: number }>>();

  const rl = readline.createInterface({
    input: fs.createReadStream(stopTimesFile, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  let isHeader = true;
  let scannedRows = 0;

  for await (const rawLine of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    const line = rawLine.trim();
    if (!line) continue;
    scannedRows++;

    const p1 = line.indexOf(',');
    if (p1 < 0) continue;
    const tripId = line.slice(0, p1);
    const meta = tripMeta.get(tripId);
    const isSample = sampleTrips.has(tripId);
    if (!meta && !isSample) continue;

    const p2 = line.indexOf(',', p1 + 1);
    const p3 = line.indexOf(',', p2 + 1);
    const p4 = line.indexOf(',', p3 + 1);
    const p5 = line.indexOf(',', p4 + 1);
    if (p2 < 0 || p3 < 0 || p4 < 0) continue;

    const seqStr = p5 > 0 ? line.slice(p4 + 1, p5) : line.slice(p4 + 1);
    if (seqStr !== '1' && !isSample) continue;

    const depStr = line.slice(p2 + 1, p3);
    const depMin = parseHmsToMinutes(depStr);
    if (depMin < 0) continue;

    if (seqStr === '1' && meta) {
      const mapped = rawToDb.get(meta.rawRouteId);
      if (mapped) {
        let entry = depBuckets.get(mapped.dbKey);
        if (!entry) {
          entry = { u: new Set(), w: new Set(), f: new Set(), s: new Set() };
          depBuckets.set(mapped.dbKey, entry);
        }
        if (meta.bucketMask & 1) entry.u.add(depMin);
        if (meta.bucketMask & 2) entry.w.add(depMin);
        if (meta.bucketMask & 4) entry.f.add(depMin);
        if (meta.bucketMask & 8) entry.s.add(depMin);
      }
    }

    if (isSample) {
      const rawStopId = line.slice(p3 + 1, p4);
      const normStopId = rawStopToNormalized.get(rawStopId) ?? `stop-${rawStopId}`;
      const seq = Number.parseInt(seqStr, 10);
      if (Number.isFinite(seq)) {
        const list = sampleStops.get(tripId) ?? [];
        list.push({ seq, stopId: normStopId, depMin });
        sampleStops.set(tripId, list);
      }
    }
  }

  const schedules: Record<string, CompactRouteSchedule> = {};
  for (const mapped of rawToDb.values()) {
    const buckets = depBuckets.get(mapped.dbKey);
    if (!buckets) continue;

    const w = Array.from(buckets.w).sort((a, b) => a - b);
    const u = Array.from(buckets.u).sort((a, b) => a - b);
    const f = Array.from(buckets.f).sort((a, b) => a - b);
    const s = Array.from(buckets.s).sort((a, b) => a - b);
    if (w.length === 0 && u.length === 0 && f.length === 0 && s.length === 0) continue;

    const ss = sampleStops.get(mapped.sampleTripId) ?? [];
    ss.sort((a, b) => a.seq - b.seq);
    const baseMin = ss[0]?.depMin ?? 0;
    const offsets: number[] = [];
    let prevStop: string | null = null;
    for (const item of ss) {
      if (item.stopId === prevStop) continue;
      prevStop = item.stopId;
      offsets.push(Math.max(0, item.depMin - baseMin));
    }

    const compact: CompactRouteSchedule = { w, f, s, o: offsets };
    if (!arraysEqual(u, w)) {
      compact.u = u;
    }
    schedules[mapped.dbKey] = compact;
  }

  for (const [aliasRouteId, [rawDir0, rawDir1]] of Object.entries(LEGACY_LINE_REF_ALIASES)) {
    const m0 = rawToDb.get(rawDir0);
    if (m0 && schedules[m0.dbKey]) {
      schedules[`${aliasRouteId}:0`] = schedules[m0.dbKey];
    }
    const m1 = rawToDb.get(rawDir1);
    if (m1 && schedules[m1.dbKey]) {
      schedules[`${aliasRouteId}:1`] = schedules[m1.dbKey];
    }
  }

  console.log(
    `[Schedule Importer] Scanned ${scannedRows} stop_times rows in ${Date.now() - t0} ms -> ${Object.keys(schedules).length} schedules`
  );

  return {
    generatedAt: new Date().toISOString(),
    feedWeek,
    schedules
  };
}

async function syncSchedulesToDatabases(schedules: Record<string, CompactRouteSchedule>): Promise<void> {
  const rows: Array<{
    route_id: string;
    direction_id: number;
    day_type: string;
    departure_minutes: number[];
    stop_offset_minutes: number[];
  }> = [];

  for (const [key, entry] of Object.entries(schedules)) {
    const sep = key.lastIndexOf(':');
    if (sep <= 0) continue;
    const routeId = key.slice(0, sep);
    const dir = Number(key.slice(sep + 1));
    rows.push(
      { route_id: routeId, direction_id: dir, day_type: 'w', departure_minutes: entry.w, stop_offset_minutes: entry.o },
      { route_id: routeId, direction_id: dir, day_type: 'u', departure_minutes: entry.u ?? entry.w, stop_offset_minutes: entry.o },
      { route_id: routeId, direction_id: dir, day_type: 'f', departure_minutes: entry.f, stop_offset_minutes: entry.o },
      { route_id: routeId, direction_id: dir, day_type: 's', departure_minutes: entry.s, stop_offset_minutes: entry.o }
    );
  }

  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const check = await pool.query(`SELECT to_regclass('public.route_schedules') AS tbl`);
      if (check.rows[0]?.tbl) {
        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          const vals: unknown[] = [];
          const ph = batch.map((r, idx) => {
            const b = idx * 5;
            vals.push(r.route_id, r.direction_id, r.day_type, r.departure_minutes, r.stop_offset_minutes);
            return `($${b + 1}, $${b + 2}::SMALLINT, $${b + 3}, $${b + 4}::SMALLINT[], $${b + 5}::SMALLINT[])`;
          });
          await pool.query(
            `INSERT INTO route_schedules (route_id, direction_id, day_type, departure_minutes, stop_offset_minutes)
             VALUES ${ph.join(',')}
             ON CONFLICT (route_id, direction_id, day_type) DO UPDATE SET
               departure_minutes = EXCLUDED.departure_minutes,
               stop_offset_minutes = EXCLUDED.stop_offset_minutes,
               updated_at = NOW()`,
            vals
          );
        }
        console.log(`[PostgreSQL] Upserted ${rows.length} route_schedules rows to local Postgres.`);
      } else {
        console.log('[PostgreSQL] route_schedules table not present; skipped local PG upsert.');
      }
    } catch (err) {
      console.warn('[PostgreSQL] route_schedules upsert skipped:', (err as Error).message);
    } finally {
      await pool.end();
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (supabaseUrl && supabaseKey) {
    const sb = createClient(supabaseUrl, supabaseKey);
    const { error } = await sb.from('route_schedules').select('route_id').limit(1);
    if (!error) {
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error: upErr } = await sb
          .from('route_schedules')
          .upsert(rows.slice(i, i + BATCH), { onConflict: 'route_id,direction_id,day_type' });
        if (upErr) {
          console.warn('[Supabase] route_schedules upsert warning:', upErr.message);
          break;
        }
      }
      console.log(`[Supabase] Upserted ${rows.length} route_schedules rows.`);
    } else {
      console.log('[Supabase] route_schedules table not present; skipped remote DB upsert (bundle file will be used).');
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromMot = args.includes('--from-mot');
  const dirArg = args.find((a) => a.startsWith('--dir='));

  let gtfsDir = dirArg ? path.resolve(dirArg.slice('--dir='.length)) : DEFAULT_GTFS_DIR;
  let tmpCleanup: string | null = null;

  if (fromMot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextbus-mot-sched-'));
    const zipPath = path.join(tmpDir, 'gtfs.zip');
    console.log(`[Schedule Importer] Downloading ${MOT_GTFS_ZIP_URL}...`);
    const res = await fetch(MOT_GTFS_ZIP_URL, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    execFileSync('unzip', ['-o', '-q', zipPath, 'routes.txt', 'stops.txt', 'trips.txt', 'calendar.txt', 'stop_times.txt', '-d', tmpDir]);
    gtfsDir = tmpDir;
    tmpCleanup = tmpDir;
  }

  try {
    const payload = await importSchedulesFromDir(gtfsDir);
    fs.mkdirSync(path.dirname(OUTPUT_GZ_PATH), { recursive: true });
    const jsonBuf = Buffer.from(
      JSON.stringify({
        generated_at: payload.generatedAt,
        feed_week: payload.feedWeek,
        schedules: payload.schedules
      })
    );
    const gzBuf = zlib.gzipSync(jsonBuf, { level: 9 });
    fs.writeFileSync(OUTPUT_GZ_PATH, gzBuf);
    console.log(
      `[Schedule Importer] Wrote ${OUTPUT_GZ_PATH} (${Math.round(gzBuf.length / 1024)} KB gzipped, ${Math.round(jsonBuf.length / 1024)} KB raw)`
    );

    await syncSchedulesToDatabases(payload.schedules);
  } finally {
    if (tmpCleanup) {
      fs.rmSync(tmpCleanup, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('[Schedule Importer] Failed:', err);
  process.exitCode = 1;
});

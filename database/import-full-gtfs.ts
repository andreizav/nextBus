import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MOT_GTFS_ZIP_URL = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';
const UPSERT_BATCH_SIZE = 1000;
const UPSERT_CONCURRENCY = 4;

interface StopRow {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  lat: number;
  lon: number;
}

interface RouteRow {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  city_area: string;
}

interface RouteStopRow {
  route_id: string;
  direction_id: 0 | 1;
  stop_id: string;
  stop_sequence: number;
}

const VERIFIED_SOUTHERN_AND_NATIONWIDE_STOPS: StopRow[] = [
  {
    stop_id: 'stop-49001',
    stop_code: '49001',
    stop_name: 'Ashkelon - Central Bus Station',
    stop_name_he: 'אשקלון - תחנה מרכזית',
    lat: 31.6688,
    lon: 34.5743
  },
  {
    stop_id: 'stop-53001',
    stop_code: '53001',
    stop_name: "Be'er Sheva - Central Bus Station",
    stop_name_he: 'באר שבע - תחנה מרכזית',
    lat: 31.2439,
    lon: 34.7966
  },
  {
    stop_id: 'stop-53002',
    stop_code: '53002',
    stop_name: "Be'er Sheva - Soroka Medical Center / BGU",
    stop_name_he: 'באר שבע - בית חולים סורוקה / אוניברסיטה',
    lat: 31.2589,
    lon: 34.8012
  },
  {
    stop_id: 'stop-53003',
    stop_code: '53003',
    stop_name: "Be'er Sheva - Center / Rager Blvd",
    stop_name_he: "באר שבע - מרכז הנגב / שד' רגר",
    lat: 31.2515,
    lon: 34.7985
  },
  {
    stop_id: 'stop-54001',
    stop_code: '54001',
    stop_name: 'Dimona - Central Bus Station / Junction',
    stop_name_he: 'דימונה - תחנה מרכזית / צומת',
    lat: 31.07,
    lon: 35.033
  },
  {
    stop_id: 'stop-55001',
    stop_code: '55001',
    stop_name: 'Mitzpe Ramon - Visitor Center / Route 40',
    stop_name_he: 'מצפה רמון - מרכז מבקרים / כביש 40',
    lat: 30.61,
    lon: 34.801
  },
  {
    stop_id: 'stop-59001',
    stop_code: '59001',
    stop_name: 'Eilat - Central Bus Station',
    stop_name_he: 'אילת - תחנה מרכזית',
    lat: 29.5569,
    lon: 34.9498
  },
  {
    stop_id: 'stop-59002',
    stop_code: '59002',
    stop_name: 'Eilat - Mall HaYam / Promenade',
    stop_name_he: 'אילת - קניון מול הים / טיילת',
    lat: 29.5472,
    lon: 34.9535
  },
  {
    stop_id: 'stop-59003',
    stop_code: '59003',
    stop_name: 'Eilat - Coral Beach / Underwater Observatory',
    stop_name_he: 'אילת - חוף אלמוג / המצפה התת ימי',
    lat: 29.5042,
    lon: 34.9182
  }
];

const VERIFIED_SOUTHERN_ROUTES: RouteRow[] = [
  {
    route_id: 'stride-10993',
    agency_id: '3',
    route_short_name: '993',
    route_long_name: 'חיפה (חוף הכרמל) - תל אביב (סבידור) - באר שבע (ת. מרכזית) - אילת (ת. מרכזית)',
    city_area: 'Intercity Haifa - Beer Sheva - Eilat'
  },
  {
    route_id: 'stride-10390',
    agency_id: '3',
    route_short_name: '390',
    route_long_name: 'תל אביב (ת. מרכזית / סבידור) - באר שבע - דימונה - אילת (ת. מרכזית)',
    city_area: 'Intercity Tel Aviv - Beer Sheva - Eilat'
  },
  {
    route_id: 'stride-10380',
    agency_id: '3',
    route_short_name: '380',
    route_long_name: 'תל אביב (סבידור / עזריאלי) - קריית גת - באר שבע (תחנה מרכזית)',
    city_area: 'Intercity Tel Aviv - Beer Sheva'
  },
  {
    route_id: 'stride-10397',
    agency_id: '3',
    route_short_name: '397',
    route_long_name: 'באר שבע (תחנה מרכזית) - דימונה - מצפה רמון - אילת (תחנה מרכזית)',
    city_area: 'Intercity Beer Sheva - Eilat'
  },
  {
    route_id: 'stride-10004',
    agency_id: '3',
    route_short_name: '4',
    route_long_name: "באר שבע (תחנה מרכזית) - שד' רגר - בית חולים סורוקה - אוניברסיטת בן גוריון",
    city_area: 'Beer Sheva'
  },
  {
    route_id: 'stride-10015',
    agency_id: '3',
    route_short_name: '15',
    route_long_name: 'אילת (תחנה מרכזית) - קניון מול הים - חוף אלמוג / המצפה התת ימי',
    city_area: 'Eilat'
  },
  {
    route_id: 'stride-10369',
    agency_id: '3',
    route_short_name: '369',
    route_long_name: 'תל אביב (ת. מרכזית / עזריאלי / סבידור) - אשדוד - אשקלון - קריית גת - באר שבע',
    city_area: 'Intercity Tel Aviv - Beer Sheva'
  }
];

const VERIFIED_SOUTHERN_ROUTE_STOPS: RouteStopRow[] = [
  // Line 993: Haifa <-> Tel Aviv <-> Kiryat Gat <-> Be'er Sheva <-> Dimona <-> Mitzpe Ramon <-> Eilat
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-42658', stop_sequence: 1 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-42362', stop_sequence: 2 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-45003', stop_sequence: 3 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-48001', stop_sequence: 4 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 5 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-54001', stop_sequence: 6 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-55001', stop_sequence: 7 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-59001', stop_sequence: 8 },
  { route_id: 'stride-10993', direction_id: 0, stop_id: 'stop-59002', stop_sequence: 9 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-59002', stop_sequence: 1 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-59001', stop_sequence: 2 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-55001', stop_sequence: 3 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-54001', stop_sequence: 4 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 5 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-48001', stop_sequence: 6 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-45003', stop_sequence: 7 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-42362', stop_sequence: 8 },
  { route_id: 'stride-10993', direction_id: 1, stop_id: 'stop-42657', stop_sequence: 9 },

  // Line 390: Tel Aviv <-> Be'er Sheva <-> Dimona <-> Eilat
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-45005', stop_sequence: 1 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-45004', stop_sequence: 2 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-45003', stop_sequence: 3 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 4 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-54001', stop_sequence: 5 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-59001', stop_sequence: 6 },
  { route_id: 'stride-10390', direction_id: 0, stop_id: 'stop-59002', stop_sequence: 7 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-59002', stop_sequence: 1 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-59001', stop_sequence: 2 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-54001', stop_sequence: 3 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 4 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-45003', stop_sequence: 5 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-45004', stop_sequence: 6 },
  { route_id: 'stride-10390', direction_id: 1, stop_id: 'stop-45005', stop_sequence: 7 },

  // Line 380: Tel Aviv <-> Kiryat Gat <-> Be'er Sheva
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-45003', stop_sequence: 1 },
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-45004', stop_sequence: 2 },
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-48001', stop_sequence: 3 },
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-53003', stop_sequence: 4 },
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-53002', stop_sequence: 5 },
  { route_id: 'stride-10380', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 6 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 1 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-53002', stop_sequence: 2 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-53003', stop_sequence: 3 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-48001', stop_sequence: 4 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-45004', stop_sequence: 5 },
  { route_id: 'stride-10380', direction_id: 1, stop_id: 'stop-45003', stop_sequence: 6 },

  // Line 397: Be'er Sheva <-> Dimona <-> Mitzpe Ramon <-> Eilat
  { route_id: 'stride-10397', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 1 },
  { route_id: 'stride-10397', direction_id: 0, stop_id: 'stop-54001', stop_sequence: 2 },
  { route_id: 'stride-10397', direction_id: 0, stop_id: 'stop-55001', stop_sequence: 3 },
  { route_id: 'stride-10397', direction_id: 0, stop_id: 'stop-59001', stop_sequence: 4 },
  { route_id: 'stride-10397', direction_id: 0, stop_id: 'stop-59002', stop_sequence: 5 },
  { route_id: 'stride-10397', direction_id: 1, stop_id: 'stop-59002', stop_sequence: 1 },
  { route_id: 'stride-10397', direction_id: 1, stop_id: 'stop-59001', stop_sequence: 2 },
  { route_id: 'stride-10397', direction_id: 1, stop_id: 'stop-55001', stop_sequence: 3 },
  { route_id: 'stride-10397', direction_id: 1, stop_id: 'stop-54001', stop_sequence: 4 },
  { route_id: 'stride-10397', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 5 },

  // Line 4: Be'er Sheva Local
  { route_id: 'stride-10004', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 1 },
  { route_id: 'stride-10004', direction_id: 0, stop_id: 'stop-53003', stop_sequence: 2 },
  { route_id: 'stride-10004', direction_id: 0, stop_id: 'stop-53002', stop_sequence: 3 },
  { route_id: 'stride-10004', direction_id: 1, stop_id: 'stop-53002', stop_sequence: 1 },
  { route_id: 'stride-10004', direction_id: 1, stop_id: 'stop-53003', stop_sequence: 2 },
  { route_id: 'stride-10004', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 3 },

  // Line 15: Eilat Local
  { route_id: 'stride-10015', direction_id: 0, stop_id: 'stop-59001', stop_sequence: 1 },
  { route_id: 'stride-10015', direction_id: 0, stop_id: 'stop-59002', stop_sequence: 2 },
  { route_id: 'stride-10015', direction_id: 0, stop_id: 'stop-59003', stop_sequence: 3 },
  { route_id: 'stride-10015', direction_id: 1, stop_id: 'stop-59003', stop_sequence: 1 },
  { route_id: 'stride-10015', direction_id: 1, stop_id: 'stop-59002', stop_sequence: 2 },
  { route_id: 'stride-10015', direction_id: 1, stop_id: 'stop-59001', stop_sequence: 3 },

  // Line 369 extended: Tel Aviv <-> Ashdod <-> Ashkelon <-> Kiryat Gat <-> Be'er Sheva
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-45005', stop_sequence: 1 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-45004', stop_sequence: 2 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-45003', stop_sequence: 3 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-47001', stop_sequence: 4 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-49001', stop_sequence: 5 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-48001', stop_sequence: 6 },
  { route_id: 'stride-10369', direction_id: 0, stop_id: 'stop-53001', stop_sequence: 7 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-53001', stop_sequence: 1 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-48001', stop_sequence: 2 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-49001', stop_sequence: 3 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-47001', stop_sequence: 4 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-45003', stop_sequence: 5 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-45004', stop_sequence: 6 },
  { route_id: 'stride-10369', direction_id: 1, stop_id: 'stop-45005', stop_sequence: 7 }
];

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

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  if (rows.length === 0) return;

  const batches: Array<{ offset: number; items: Record<string, unknown>[] }> = [];
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    batches.push({ offset: i, items: rows.slice(i, i + UPSERT_BATCH_SIZE) });
  }

  let cursor = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= batches.length) break;
      const batch = batches[idx];

      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { error } = await supabase
            .from(table)
            .upsert(batch.items as never, { onConflict });
          if (!error) {
            lastErr = null;
            break;
          }
          lastErr = new Error(error.message);
        } catch (err) {
          lastErr = err as Error;
        }
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }

      if (lastErr) {
        throw new Error(
          `Supabase upsert error on ${table} (offset ${batch.offset}): ${lastErr.message}`
        );
      }

      completed++;
      if (batches.length >= 20 && (completed % 25 === 0 || completed === batches.length)) {
        console.log(`[Supabase] ${table}: ${completed}/${batches.length} batches upserted`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPSERT_CONCURRENCY, batches.length) }, () => worker())
  );
}

async function upsertStopsToPg(pgPool: pg.Pool, stops: StopRow[]): Promise<void> {
  for (let i = 0; i < stops.length; i += UPSERT_BATCH_SIZE) {
    const batch = stops.slice(i, i + UPSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((s, idx) => {
      const base = idx * 6;
      values.push(s.stop_id, s.stop_code, s.stop_name, s.stop_name_he, s.lon, s.lat);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, ST_SetSRID(ST_MakePoint($${base + 5}::FLOAT, $${base + 6}::FLOAT), 4326)::geography)`;
    });

    await pgPool.query(
      `INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (stop_id) DO UPDATE SET
         stop_code = EXCLUDED.stop_code,
         stop_name = EXCLUDED.stop_name,
         stop_name_he = EXCLUDED.stop_name_he,
         location = EXCLUDED.location`,
      values
    );
  }
}

async function upsertRoutesToPg(pgPool: pg.Pool, routes: RouteRow[]): Promise<void> {
  for (let i = 0; i < routes.length; i += UPSERT_BATCH_SIZE) {
    const batch = routes.slice(i, i + UPSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((r, idx) => {
      const base = idx * 5;
      values.push(r.route_id, r.agency_id, r.route_short_name, r.route_long_name, r.city_area);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
    });

    await pgPool.query(
      `INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (route_id) DO UPDATE SET
         agency_id = EXCLUDED.agency_id,
         route_short_name = EXCLUDED.route_short_name,
         route_long_name = EXCLUDED.route_long_name,
         city_area = EXCLUDED.city_area`,
      values
    );
  }
}

async function upsertRouteStopsToPg(pgPool: pg.Pool, routeStops: RouteStopRow[]): Promise<void> {
  for (let i = 0; i < routeStops.length; i += UPSERT_BATCH_SIZE) {
    const batch = routeStops.slice(i, i + UPSERT_BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((rs, idx) => {
      const base = idx * 4;
      values.push(rs.route_id, rs.direction_id, rs.stop_id, rs.stop_sequence);
      return `($${base + 1}, $${base + 2}::SMALLINT, $${base + 3}, $${base + 4}::INT)`;
    });

    await pgPool.query(
      `INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
         stop_id = EXCLUDED.stop_id`,
      values
    );
  }
}

async function seedVerifiedNationwideData(
  supabase: SupabaseClient,
  pgPool: pg.Pool | null,
  cityFilter?: string[]
): Promise<void> {
  let stops = VERIFIED_SOUTHERN_AND_NATIONWIDE_STOPS;
  let routes = VERIFIED_SOUTHERN_ROUTES;

  if (cityFilter && cityFilter.length > 0) {
    const pat = new RegExp(cityFilter.join('|'), 'i');
    const filteredStops = stops.filter(
      (s) => pat.test(s.stop_name) || pat.test(s.stop_name_he)
    );
    const filteredRoutes = routes.filter(
      (r) => pat.test(r.city_area) || pat.test(r.route_long_name)
    );
    if (filteredRoutes.length > 0) routes = filteredRoutes;
    // Always keep stop FKs referenced by filteredRoutes + filteredStops
    const usedStopIds = new Set(
      VERIFIED_SOUTHERN_ROUTE_STOPS.filter((rs) =>
        routes.some((r) => r.route_id === rs.route_id)
      ).map((rs) => rs.stop_id)
    );
    const neededMap = new Map<string, StopRow>();
    for (const s of [...filteredStops, ...stops]) {
      if (usedStopIds.has(s.stop_id) || pat.test(s.stop_name) || pat.test(s.stop_name_he)) {
        neededMap.set(s.stop_id, s);
      }
    }
    stops = Array.from(neededMap.values());
  }

  await upsertInBatches(
    supabase,
    'stops',
    stops.map((s) => ({
      stop_id: s.stop_id,
      stop_code: s.stop_code,
      stop_name: s.stop_name,
      stop_name_he: s.stop_name_he,
      location: `SRID=4326;POINT(${s.lon} ${s.lat})`
    })),
    'stop_id'
  );

  await upsertInBatches(
    supabase,
    'routes',
    routes.map((r) => ({ ...r })),
    'route_id'
  );

  const allowedRouteIds = new Set(routes.map((r) => r.route_id));
  const routeStops = VERIFIED_SOUTHERN_ROUTE_STOPS.filter((rs) =>
    allowedRouteIds.has(rs.route_id)
  );

  // Clean existing route_stops on updated routes before upserting contiguous 1..N sequences
  await supabase.from('route_stops').delete().in('route_id', Array.from(allowedRouteIds));
  await upsertInBatches(
    supabase,
    'route_stops',
    routeStops.map((rs) => ({ ...rs })),
    'route_id,direction_id,stop_sequence'
  );

  if (pgPool) {
    await upsertStopsToPg(pgPool, stops);
    await upsertRoutesToPg(pgPool, routes);
    await pgPool.query(`DELETE FROM route_stops WHERE route_id = ANY($1::TEXT[])`, [
      Array.from(allowedRouteIds)
    ]);
    await upsertRouteStopsToPg(pgPool, routeStops);
  }

  console.log(
    `[GTFS Importer] Seeded verified nationwide/southern corridors: ${stops.length} stops, ${routes.length} routes, ${routeStops.length} route_stops.`
  );
}

interface ParsedMotRouteCandidate {
  rawRouteId: string;
  agencyId: string;
  shortName: string;
  longName: string;
  makat: string;
  rawDir: '1' | '2' | '3';
  alt: string;
  endpointPairKey: string;
  tripsCount: number;
  sampleTripId?: string;
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

function extractCityArea(longName: string): string {
  const withoutSuffix = longName.replace(/-[^-]+$/, '').trim();
  const parts = withoutSuffix.split('<->');
  if (parts.length !== 2) return 'Israel GTFS';
  const getCity = (part: string) => {
    const idx = part.lastIndexOf('-');
    return idx >= 0 ? part.slice(idx + 1).trim() : part.trim();
  };
  const c1 = getCity(parts[0]);
  const c2 = getCity(parts[1]);
  if (!c1 && !c2) return 'Israel GTFS';
  if (c1 === c2) return c1;
  return `${c1} - ${c2}`;
}

async function importFromMotGtfsDirectory(
  supabase: SupabaseClient,
  pgPool: pg.Pool | null,
  gtfsDir: string,
  cityFilter?: string[]
): Promise<void> {
  const routesFile = path.join(gtfsDir, 'routes.txt');
  const stopsFile = path.join(gtfsDir, 'stops.txt');
  const tripsFile = path.join(gtfsDir, 'trips.txt');
  const stopTimesFile = path.join(gtfsDir, 'stop_times.txt');

  for (const requiredFile of [routesFile, stopsFile, tripsFile, stopTimesFile]) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(`Missing GTFS file: ${requiredFile}`);
    }
  }

  const cityRegex =
    cityFilter && cityFilter.length > 0 ? new RegExp(cityFilter.join('|'), 'i') : null;

  // 1. Parse stops.txt: extract city name from stop_desc and deduplicate by stop_code
  const rawStopIdToStop = new Map<string, StopRow>();
  const uniqueStopsByStopId = new Map<string, StopRow>();

  await readGtfsCsv(stopsFile, (row) => {
    const rawId = row.stop_id?.trim();
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    if (!rawId || Number.isNaN(lat) || Number.isNaN(lon)) return;

    const stopCode = row.stop_code?.trim() || rawId;
    const stopId = rawId.startsWith('stop-') ? rawId : `stop-${stopCode}`;
    const rawName = row.stop_name?.trim() || stopId;

    const desc = row.stop_desc ?? '';
    const cityMatch = desc.match(/עיר:\s*(.+?)(?:\s+רציף:|$)/);
    const cityHe = cityMatch ? cityMatch[1].trim() : '';

    const stopNameHe =
      cityHe && !rawName.includes(`(${cityHe})`) ? `${rawName} (${cityHe})` : rawName;

    const stopRow: StopRow = {
      stop_id: stopId,
      stop_code: stopCode,
      stop_name: stopNameHe,
      stop_name_he: stopNameHe,
      lat,
      lon
    };

    rawStopIdToStop.set(rawId, stopRow);
    const existing = uniqueStopsByStopId.get(stopId);
    if (!existing || (!existing.stop_name_he.includes('(') && stopNameHe.includes('('))) {
      uniqueStopsByStopId.set(stopId, stopRow);
    }
  });

  // 2. Parse routes.txt (excluding Israel Railways rail routes route_type=2 / agency_id=2)
  const routeCandidates = new Map<string, ParsedMotRouteCandidate>();
  await readGtfsCsv(routesFile, (row) => {
    const rawId = row.route_id?.trim();
    const agencyId = row.agency_id?.trim() || '3';
    const routeType = row.route_type?.trim() || '3';
    const shortName = row.route_short_name?.trim() || '';
    if (!rawId || !shortName || routeType === '2' || agencyId === '2') return;

    const longName = row.route_long_name?.trim() || shortName;
    const desc = row.route_desc?.trim() || '';
    if (cityRegex && !cityRegex.test(longName) && !cityRegex.test(desc)) {
      return;
    }

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
      agencyId,
      shortName,
      longName,
      makat,
      rawDir,
      alt,
      endpointPairKey: normalizeEndpointPair(longName),
      tripsCount: 0
    });
  });

  // 3. Scan trips.txt to count trips and pick representative trip_id per raw route_id
  await readGtfsCsv(tripsFile, (row) => {
    const rawRouteId = row.route_id?.trim();
    const tripId = row.trip_id?.trim();
    if (!rawRouteId || !tripId) return;
    const cand = routeCandidates.get(rawRouteId);
    if (!cand) return;
    cand.tripsCount++;
    if (!cand.sampleTripId) {
      cand.sampleTripId = tripId;
    }
  });

  // Group into bidirectional RouteRows by (makat, shortName, endpointPairKey)
  const grouped = new Map<string, ParsedMotRouteCandidate[]>();
  for (const cand of routeCandidates.values()) {
    if (!cand.sampleTripId) continue;
    const key = `${cand.makat}:${cand.shortName}:${cand.endpointPairKey}`;
    const arr = grouped.get(key) ?? [];
    arr.push(cand);
    grouped.set(key, arr);
  }

  const pickBestVariant = (items: ParsedMotRouteCandidate[]): ParsedMotRouteCandidate | undefined =>
    items.sort(
      (a, b) =>
        (b.alt === '#' ? 1 : 0) - (a.alt === '#' ? 1 : 0) || b.tripsCount - a.tripsCount
    )[0];

  const finalRoutes: RouteRow[] = [];
  const selectedTripMeta = new Map<string, { dbRouteId: string; directionId: 0 | 1 }>();

  for (const candidates of grouped.values()) {
    const d1 = pickBestVariant(candidates.filter((c) => c.rawDir === '1'));
    const d2 = pickBestVariant(candidates.filter((c) => c.rawDir === '2'));
    const d3 = pickBestVariant(candidates.filter((c) => c.rawDir === '3'));

    if (d1 && (d2 || d3)) {
      const inbound = d2 ?? d3!;
      const dbRouteId = `gtfs-${d1.rawRouteId}-${inbound.rawRouteId}`;
      finalRoutes.push({
        route_id: dbRouteId,
        agency_id: d1.agencyId,
        route_short_name: d1.shortName,
        route_long_name: d1.longName.replace(/-\d[^-]*$/, '').trim(),
        city_area: extractCityArea(d1.longName)
      });
      selectedTripMeta.set(d1.sampleTripId!, { dbRouteId, directionId: 0 });
      selectedTripMeta.set(inbound.sampleTripId!, { dbRouteId, directionId: 1 });

      // Preserve distinct circular loop when both d2 and d3 exist
      if (d2 && d3) {
        const loopRouteId = `gtfs-${d3.rawRouteId}`;
        finalRoutes.push({
          route_id: loopRouteId,
          agency_id: d3.agencyId,
          route_short_name: d3.shortName,
          route_long_name: d3.longName.replace(/-\d[^-]*$/, '').trim(),
          city_area: extractCityArea(d3.longName)
        });
        selectedTripMeta.set(d3.sampleTripId!, { dbRouteId: loopRouteId, directionId: 0 });
      }
    } else {
      const solo = d1 ?? d2 ?? d3;
      if (!solo) continue;
      const dbRouteId = `gtfs-${solo.rawRouteId}`;
      finalRoutes.push({
        route_id: dbRouteId,
        agency_id: solo.agencyId,
        route_short_name: solo.shortName,
        route_long_name: solo.longName.replace(/-\d[^-]*$/, '').trim(),
        city_area: extractCityArea(solo.longName)
      });
      selectedTripMeta.set(solo.sampleTripId!, { dbRouteId, directionId: 0 });
    }
  }

  // 4. Parse stop_times.txt for selected representative trips
  const stopsByTrip = new Map<string, Array<{ stopId: string; rawSeq: number }>>();
  const usedFilteredStops = new Map<string, StopRow>();

  await readGtfsCsv(stopTimesFile, (row) => {
    const tripId = row.trip_id?.trim();
    if (!tripId || !selectedTripMeta.has(tripId)) return;
    const stop = rawStopIdToStop.get(row.stop_id?.trim() ?? '');
    const seq = Number(row.stop_sequence);
    if (!stop || Number.isNaN(seq)) return;

    usedFilteredStops.set(stop.stop_id, uniqueStopsByStopId.get(stop.stop_id) ?? stop);
    const list = stopsByTrip.get(tripId) ?? [];
    list.push({ stopId: stop.stop_id, rawSeq: seq });
    stopsByTrip.set(tripId, list);
  });

  // Sort each direction's stops, collapse duplicate adjacent stop_codes, and re-index 1..N
  const routeStops: RouteStopRow[] = [];
  for (const [tripId, meta] of selectedTripMeta.entries()) {
    const items = stopsByTrip.get(tripId);
    if (!items || items.length === 0) continue;
    items.sort((a, b) => a.rawSeq - b.rawSeq);

    let seq = 1;
    let prevStopId: string | null = null;
    for (const item of items) {
      if (item.stopId === prevStopId) continue;
      prevStopId = item.stopId;
      routeStops.push({
        route_id: meta.dbRouteId,
        direction_id: meta.directionId,
        stop_id: item.stopId,
        stop_sequence: seq++
      });
    }
  }

  // For full nationwide import (no cityFilter), persist every unique stop across all 1,204 towns
  const stopsList = cityRegex
    ? Array.from(usedFilteredStops.values())
    : Array.from(uniqueStopsByStopId.values());

  console.log(
    `[GTFS Importer] Prepared ${stopsList.length} unique stops, ${finalRoutes.length} routes, ${routeStops.length} route_stops. Uploading...`
  );

  const stopsPayload = stopsList.map((s) => ({
    stop_id: s.stop_id,
    stop_code: s.stop_code,
    stop_name: s.stop_name,
    stop_name_he: s.stop_name_he,
    location: `SRID=4326;POINT(${s.lon} ${s.lat})`
  }));

  await upsertInBatches(supabase, 'stops', stopsPayload, 'stop_id');
  await upsertInBatches(
    supabase,
    'routes',
    finalRoutes.map((r) => ({ ...r })),
    'route_id'
  );
  await upsertInBatches(
    supabase,
    'route_stops',
    routeStops.map((rs) => ({ ...rs })),
    'route_id,direction_id,stop_sequence'
  );

  if (pgPool) {
    console.log('[PostgreSQL] Syncing full GTFS tables to local PostGIS...');
    await upsertStopsToPg(pgPool, stopsList);
    await upsertRoutesToPg(pgPool, finalRoutes);
    await upsertRouteStopsToPg(pgPool, routeStops);
    console.log('[PostgreSQL] Local PostGIS sync complete.');
  }

  console.log(
    `[GTFS Importer] Imported MOT GTFS: ${stopsPayload.length} stops, ${finalRoutes.length} routes, ${routeStops.length} route_stops.`
  );
}

async function verifyCoverage(supabase: SupabaseClient): Promise<void> {
  const cities = [
    'רחובות',
    'ראשון לציון',
    'פתח תקווה',
    'נתניה',
    'אשדוד',
    'באר שבע',
    'אילת',
    'טבריה',
    'נצרת',
    'חיפה',
    'תל אביב',
    'ירושלים'
  ];
  for (const label of cities) {
    const { count } = await supabase
      .from('stops')
      .select('stop_id', { count: 'exact', head: true })
      .ilike('stop_name_he', `%${label}%`);
    console.log(`[Verify] "${label}" stops in Supabase: ${count ?? 0}`);
  }
  const [{ count: totalStops }, { count: totalRoutes }, { count: totalRs }] = await Promise.all([
    supabase.from('stops').select('*', { count: 'exact', head: true }),
    supabase.from('routes').select('*', { count: 'exact', head: true }),
    supabase.from('route_stops').select('*', { count: 'exact', head: true })
  ]);
  console.log(
    `[Verify] Totals in Supabase -> stops: ${totalStops ?? 0}, routes: ${totalRoutes ?? 0}, route_stops: ${totalRs ?? 0}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seedVerified = args.includes('--seed-verified');
  const fromMot = args.includes('--from-mot');
  const dirArg = args.find((a) => a.startsWith('--dir='));
  const citiesArg = args.find((a) => a.startsWith('--cities='));
  const cityFilter = citiesArg
    ? citiesArg
        .slice('--cities='.length)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
        .flatMap((c) => {
          if (/eilat/i.test(c)) return ['אילת', 'eilat'];
          if (/beer.?sheva/i.test(c)) return ['באר שבע', "be'er sheva", 'beer sheva'];
          return [c];
        })
    : undefined;

  const rawUrl = process.env.SUPABASE_URL;
  const supabaseUrl = rawUrl
    ? rawUrl.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
    : undefined;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment (.env).');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let pgPool: pg.Pool | null = null;
  if (process.env.DATABASE_URL) {
    const candidatePool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await candidatePool.query('SELECT 1');
      pgPool = candidatePool;
      console.log('[PostgreSQL] Connected to local PostGIS via DATABASE_URL.');
    } catch (err) {
      console.warn(
        '[PostgreSQL] Local DATABASE_URL unreachable; skipping local sync:',
        (err as Error).message
      );
      await candidatePool.end().catch(() => undefined);
    }
  }

  try {
    if (dirArg) {
      await importFromMotGtfsDirectory(
        supabase,
        pgPool,
        path.resolve(dirArg.slice('--dir='.length)),
        cityFilter
      );
    } else if (fromMot) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextbus-mot-gtfs-'));
      const zipPath = path.join(tmpDir, 'israel-public-transportation.zip');
      console.log(`[GTFS Importer] Downloading ${MOT_GTFS_ZIP_URL}...`);
      const res = await fetch(MOT_GTFS_ZIP_URL, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) {
        throw new Error(`Failed to download MOT GTFS zip: HTTP ${res.status}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(zipPath, buf);
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmpDir]);
      await importFromMotGtfsDirectory(supabase, pgPool, tmpDir, cityFilter);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    await seedVerifiedNationwideData(supabase, pgPool, cityFilter);

    await verifyCoverage(supabase);
  } finally {
    if (pgPool) {
      await pgPool.end();
    }
  }
}

main().catch((err) => {
  console.error('[GTFS Importer] Failed:', err);
  process.exitCode = 1;
});

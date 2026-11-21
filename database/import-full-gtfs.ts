import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MOT_GTFS_ZIP_URL = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';
const UPSERT_BATCH_SIZE = 500;

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
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch as never, { onConflict });
    if (error) {
      throw new Error(`Supabase upsert error on ${table} (offset ${i}): ${error.message}`);
    }
  }
}

async function seedVerifiedNationwideData(supabase: SupabaseClient, cityFilter?: string[]): Promise<void> {
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

  console.log(
    `[GTFS Importer] Seeded verified nationwide/southern corridors: ${stops.length} stops, ${routes.length} routes, ${routeStops.length} route_stops.`
  );
}

async function importFromMotGtfsDirectory(
  supabase: SupabaseClient,
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

  // 1. Parse stops.txt
  const stopsById = new Map<string, StopRow>();
  await readGtfsCsv(stopsFile, (row) => {
    const id = row.stop_id?.trim();
    const lat = Number(row.stop_lat);
    const lon = Number(row.stop_lon);
    if (!id || Number.isNaN(lat) || Number.isNaN(lon)) return;
    const stopId = id.startsWith('stop-') ? id : `stop-${row.stop_code?.trim() || id}`;
    const name = row.stop_name?.trim() || stopId;
    stopsById.set(id, {
      stop_id: stopId,
      stop_code: row.stop_code?.trim() || id,
      stop_name: name,
      stop_name_he: name,
      lat,
      lon
    });
  });

  // 2. Parse routes.txt
  const routesById = new Map<string, RouteRow>();
  await readGtfsCsv(routesFile, (row) => {
    const rawId = row.route_id?.trim();
    if (!rawId) return;
    const longName = row.route_long_name?.trim() || row.route_short_name?.trim() || rawId;
    if (cityRegex && !cityRegex.test(longName) && !cityRegex.test(row.route_desc ?? '')) {
      return;
    }
    routesById.set(rawId, {
      route_id: rawId.startsWith('stride-') ? rawId : `gtfs-${rawId}`,
      agency_id: row.agency_id?.trim() || '3',
      route_short_name: row.route_short_name?.trim() || rawId,
      route_long_name: longName,
      city_area: 'Israel GTFS'
    });
  });

  // 3. Pick one representative trip_id per (route_id, direction_id)
  const representativeTripByKey = new Map<string, { dbRouteId: string; directionId: 0 | 1 }>();
  await readGtfsCsv(tripsFile, (row) => {
    const rawRouteId = row.route_id?.trim();
    const tripId = row.trip_id?.trim();
    if (!rawRouteId || !tripId) return;
    const route = routesById.get(rawRouteId);
    if (!route) return;
    const dir: 0 | 1 = Number(row.direction_id) === 1 ? 1 : 0;
    const key = `${route.route_id}:${dir}`;
    if (!representativeTripByKey.has(key)) {
      representativeTripByKey.set(key, { dbRouteId: route.route_id, directionId: dir });
      tripMeta.set(tripId, { dbRouteId: route.route_id, directionId: dir });
    }
  });

  const routeStops: RouteStopRow[] = [];
  const usedStops = new Map<string, StopRow>();

  await readGtfsCsv(stopTimesFile, (row) => {
    const tripId = row.trip_id?.trim();
    const meta = tripId ? tripMeta.get(tripId) : undefined;
    if (!meta) return;
    const stop = stopsById.get(row.stop_id?.trim() ?? '');
    const seq = Number(row.stop_sequence);
    if (!stop || Number.isNaN(seq)) return;
    usedStops.set(stop.stop_id, stop);
    routeStops.push({
      route_id: meta.dbRouteId,
      direction_id: meta.directionId,
      stop_id: stop.stop_id,
      stop_sequence: seq
    });
  });

  const stopsPayload = Array.from(usedStops.values()).map((s) => ({
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
    Array.from(routesById.values()).map((r) => ({ ...r })),
    'route_id'
  );
  await upsertInBatches(
    supabase,
    'route_stops',
    routeStops.map((rs) => ({ ...rs })),
    'route_id,direction_id,stop_sequence'
  );

  console.log(
    `[GTFS Importer] Imported MOT GTFS: ${stopsPayload.length} stops, ${routesById.size} routes, ${routeStops.length} route_stops.`
  );
}

const tripMeta = new Map<string, { dbRouteId: string; directionId: 0 | 1 }>();

async function verifyCoverage(supabase: SupabaseClient): Promise<void> {
  for (const label of ['באר שבע', 'אילת']) {
    const { data: stops } = await supabase
      .from('stops')
      .select('stop_id, stop_code, stop_name_he')
      .ilike('stop_name_he', `%${label}%`);
    console.log(`[Verify] "${label}" stops in Supabase: ${stops?.length ?? 0}`);
  }
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

  if (seedVerified || (!dirArg && !fromMot)) {
    await seedVerifiedNationwideData(supabase, cityFilter);
  }

  if (dirArg) {
    await importFromMotGtfsDirectory(supabase, path.resolve(dirArg.slice('--dir='.length)), cityFilter);
  } else if (fromMot) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nextbus-mot-gtfs-'));
    const zipPath = path.join(tmpDir, 'israel-public-transportation.zip');
    console.log(`[GTFS Importer] Downloading ${MOT_GTFS_ZIP_URL}...`);
    const res = await fetch(MOT_GTFS_ZIP_URL, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new Error(`Failed to download MOT GTFS zip: HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmpDir]);
    await importFromMotGtfsDirectory(supabase, tmpDir, cityFilter);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  await verifyCoverage(supabase);
}

main().catch((err) => {
  console.error('[GTFS Importer] Failed:', err);
  process.exitCode = 1;
});

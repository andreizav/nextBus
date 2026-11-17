import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const STRIDE_BASE_URL = 'https://open-bus-stride-api.hasadna.org.il';

interface StrideRoute {
  id: number;
  line_ref?: number;
  operator_ref?: number;
  route_short_name?: string;
  route_long_name?: string;
  route_mkt?: string;
  route_direction?: string;
}

interface StrideStop {
  id: number;
  code?: number | string;
  name?: string;
  city?: string;
  lat?: number;
  lon?: number;
}

interface SeedRoute {
  route_id: string;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  city_area: string;
}

interface SeedStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  location: string;
}

interface SeedRouteStop {
  route_id: string;
  direction_id: 0 | 1;
  stop_id: string;
  stop_sequence: number;
}

const FALLBACK_STOPS_LINE_49: Array<{
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  lat: number;
  lon: number;
}> = [
  {
    stop_id: 'stop-41001',
    stop_code: '41001',
    stop_name: 'Tirat Carmel / HaAtzmaut',
    stop_name_he: 'העצמאות / טירת כרמל',
    lat: 32.7585,
    lon: 34.9721
  },
  {
    stop_id: 'stop-41002',
    stop_code: '41002',
    stop_name: 'Herzl / Tirat Carmel Mall',
    stop_name_he: 'הרצל / קניון טירת כרמל',
    lat: 32.7618,
    lon: 34.9726
  },
  {
    stop_id: 'stop-41003',
    stop_code: '41003',
    stop_name: 'Rambam / HaGalil',
    stop_name_he: 'רמב״ם / הגליל',
    lat: 32.7659,
    lon: 34.9730
  },
  {
    stop_id: 'stop-41004',
    stop_code: '41004',
    stop_name: 'HaHagana / Kfar Galim',
    stop_name_he: 'ההגנה / כפר גלים',
    lat: 32.7712,
    lon: 34.9718
  },
  {
    stop_id: 'stop-41005',
    stop_code: '41005',
    stop_name: 'MATAM High-Tech Park',
    stop_name_he: 'פארק מת״ם / מבוא כרמל',
    lat: 32.7804,
    lon: 34.9658
  },
  {
    stop_id: 'stop-41006',
    stop_code: '41006',
    stop_name: 'Haifa Mall / Fliman',
    stop_name_he: 'קניון חיפה / פלימן',
    lat: 32.7876,
    lon: 34.9622
  },
  {
    stop_id: 'stop-41007',
    stop_code: '41007',
    stop_name: 'Hof HaCarmel Central Station',
    stop_name_he: 'מרכזית חוף הכרמל',
    lat: 32.7938,
    lon: 34.9591
  }
];

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(`Stride API returned HTTP ${response.status} for ${url}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`Unable to reach Stride API (${url}):`, (error as Error).message);
    return null;
  }
}

async function seedGtfs(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment (.env).'
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Fetching GTFS routes for line 49 (Haifa / Tirat Carmel) from Open Bus Stride API...');
  const strideRoutes = await fetchJson<StrideRoute[]>(
    `${STRIDE_BASE_URL}/gtfs_routes/list?route_short_name=49&limit=50`
  );

  const haifaRoute = strideRoutes?.find(
    (r) =>
      r.route_short_name === '49' &&
      (r.route_long_name?.includes('חיפה') || r.route_long_name?.includes('טירת'))
  );

  const primaryRoute: SeedRoute = {
    route_id: haifaRoute ? `stride-${haifaRoute.line_ref ?? haifaRoute.id}` : 'route-49-haifa',
    agency_id: String(haifaRoute?.operator_ref ?? '3'),
    route_short_name: '49',
    route_long_name: haifaRoute?.route_long_name ?? 'טירת כרמל - חיפה חוף הכרמל',
    city_area: 'Haifa / Tirat Carmel'
  };

  console.log('Fetching GTFS stops in Haifa / Tirat Carmel...');
  const strideStops = await fetchJson<StrideStop[]>(
    `${STRIDE_BASE_URL}/gtfs_stops/list?city=${encodeURIComponent('חיפה')}&limit=50`
  );

  const validStrideStops = (strideStops ?? []).filter(
    (s) => typeof s.lat === 'number' && typeof s.lon === 'number' && s.name
  );

  const stopsPayload: SeedStop[] = FALLBACK_STOPS_LINE_49.map((stop) => ({
    stop_id: stop.stop_id,
    stop_code: stop.stop_code,
    stop_name: stop.stop_name,
    stop_name_he: stop.stop_name_he,
    location: `SRID=4326;POINT(${stop.lon} ${stop.lat})`
  }));

  for (const s of validStrideStops.slice(0, 25)) {
    const code = String(s.code ?? s.id);
    if (!stopsPayload.some((existing) => existing.stop_code === code)) {
      stopsPayload.push({
        stop_id: `stride-stop-${s.id}`,
        stop_code: code,
        stop_name: s.name ?? `Stop ${code}`,
        stop_name_he: s.name ?? `תחנה ${code}`,
        location: `SRID=4326;POINT(${s.lon} ${s.lat})`
      });
    }
  }

  const routeStopsPayload: SeedRouteStop[] = [
    ...FALLBACK_STOPS_LINE_49.map((stop, index) => ({
      route_id: primaryRoute.route_id,
      direction_id: 0 as const,
      stop_id: stop.stop_id,
      stop_sequence: index + 1
    })),
    ...[...FALLBACK_STOPS_LINE_49].reverse().map((stop, index) => ({
      route_id: primaryRoute.route_id,
      direction_id: 1 as const,
      stop_id: stop.stop_id,
      stop_sequence: index + 1
    }))
  ];

  console.log(`Upserting route ${primaryRoute.route_id} into Supabase...`);
  const { error: routeError } = await supabase
    .from('routes')
    .upsert([primaryRoute], { onConflict: 'route_id' });
  if (routeError) throw routeError;

  console.log(`Upserting ${stopsPayload.length} stops into Supabase...`);
  const { error: stopsError } = await supabase
    .from('stops')
    .upsert(stopsPayload, { onConflict: 'stop_id' });
  if (stopsError) throw stopsError;

  console.log(`Upserting ${routeStopsPayload.length} route_stops mappings...`);
  const { error: rsError } = await supabase
    .from('route_stops')
    .upsert(routeStopsPayload, { onConflict: 'route_id,direction_id,stop_sequence' });
  if (rsError) throw rsError;

  console.log('GTFS seed completed successfully!');
}

seedGtfs().catch((err) => {
  console.error('GTFS seed failed:', err);
  process.exitCode = 1;
});

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
  route_direction?: string;
}

interface StrideRide {
  id: number;
  gtfs_route_id: number;
}

interface StrideRideStop {
  stop_sequence: number;
  gtfs_stop_id: number;
  gtfs_stop__code?: number | string;
  gtfs_stop__name?: string;
  gtfs_stop__city?: string;
  gtfs_stop__lat?: number;
  gtfs_stop__lon?: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Stride API HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStopsForRoute(routeId: number) {
  const rides = await fetchJson<StrideRide[]>(
    `${STRIDE_BASE_URL}/gtfs_rides/list?gtfs_route_id=${routeId}&limit=1`
  );
  if (!rides.length) return [];

  const rideStops = await fetchJson<StrideRideStop[]>(
    `${STRIDE_BASE_URL}/gtfs_ride_stops/list?gtfs_ride_ids=${rides[0].id}&order_by=stop_sequence%20asc&limit=100`
  );

  return rideStops
    .filter(
      (rs) =>
        typeof rs.gtfs_stop__lat === 'number' &&
        typeof rs.gtfs_stop__lon === 'number' &&
        Boolean(rs.gtfs_stop__name)
    )
    .map((rs) => {
      const code = String(rs.gtfs_stop__code ?? rs.gtfs_stop_id);
      const city = rs.gtfs_stop__city ? ` (${rs.gtfs_stop__city})` : '';
      const nameHe = `${rs.gtfs_stop__name}${city}`;
      return {
        stop_id: `stop-${code}`,
        stop_code: code,
        stop_name: nameHe,
        stop_name_he: nameHe,
        lat: rs.gtfs_stop__lat!,
        lon: rs.gtfs_stop__lon!,
        stop_sequence: rs.stop_sequence
      };
    });
}

async function seedGtfs(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment (.env).');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Fetching real Haifa / Tirat Carmel Line 49 routes from Open Bus Stride API...');
  const strideRoutes = await fetchJson<StrideRoute[]>(
    `${STRIDE_BASE_URL}/gtfs_routes/list?route_short_name=49&order_by=id%20desc&limit=50`
  );

  const haifaRoutes = strideRoutes.filter(
    (r) =>
      r.route_short_name === '49' &&
      r.route_long_name &&
      (r.route_long_name.includes('טירת כרמל') || r.route_long_name.includes('חוף הכרמל'))
  );

  const dir0Route =
    haifaRoutes.find((r) => r.line_ref === 19632 || r.route_direction === '2') ?? haifaRoutes[0];
  const dir1Route =
    haifaRoutes.find((r) => r.line_ref === 19631 || r.route_direction === '1') ?? haifaRoutes[1];

  if (!dir0Route || !dir1Route) {
    throw new Error('Could not locate Haifa Line 49 directions from Stride API.');
  }

  const [dir0Stops, dir1Stops] = await Promise.all([
    fetchStopsForRoute(dir0Route.id),
    fetchStopsForRoute(dir1Route.id)
  ]);

  const routeId = 'stride-10049';
  const { error: routeError } = await supabase.from('routes').upsert(
    [
      {
        route_id: routeId,
        agency_id: String(dir0Route.operator_ref ?? '3'),
        route_short_name: '49',
        route_long_name: dir0Route.route_long_name ?? 'טירת כרמל <-> חוף הכרמל חיפה',
        city_area: 'Haifa / Tirat Carmel'
      }
    ],
    { onConflict: 'route_id' }
  );
  if (routeError) throw routeError;

  const uniqueStops = new Map<string, (typeof dir0Stops)[number]>();
  for (const s of [...dir0Stops, ...dir1Stops]) {
    uniqueStops.set(s.stop_id, s);
  }

  const stopsPayload = Array.from(uniqueStops.values()).map((stop) => ({
    stop_id: stop.stop_id,
    stop_code: stop.stop_code,
    stop_name: stop.stop_name,
    stop_name_he: stop.stop_name_he,
    location: `SRID=4326;POINT(${stop.lon} ${stop.lat})`
  }));

  const { error: stopsError } = await supabase
    .from('stops')
    .upsert(stopsPayload, { onConflict: 'stop_id' });
  if (stopsError) throw stopsError;

  const routeStopsPayload = [
    ...dir0Stops.map((s) => ({
      route_id: routeId,
      direction_id: 0 as const,
      stop_id: s.stop_id,
      stop_sequence: s.stop_sequence
    })),
    ...dir1Stops.map((s) => ({
      route_id: routeId,
      direction_id: 1 as const,
      stop_id: s.stop_id,
      stop_sequence: s.stop_sequence
    }))
  ];

  const { error: rsError } = await supabase
    .from('route_stops')
    .upsert(routeStopsPayload, { onConflict: 'route_id,direction_id,stop_sequence' });
  if (rsError) throw rsError;

  console.log(`GTFS seed completed: ${stopsPayload.length} stops, ${routeStopsPayload.length} route_stops.`);
}

seedGtfs().catch((err) => {
  console.error('GTFS seed failed:', err);
  process.exitCode = 1;
});

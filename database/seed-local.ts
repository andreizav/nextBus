import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

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
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStopsForDirection(
  routeId: number
): Promise<Array<{
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  lat: number;
  lon: number;
  stop_sequence: number;
}>> {
  const rides = await fetchJson<StrideRide[]>(
    `${STRIDE_BASE_URL}/gtfs_rides/list?gtfs_route_id=${routeId}&limit=1`
  );
  if (!rides.length) {
    throw new Error(`No gtfs_rides found for gtfs_route_id=${routeId}`);
  }

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

async function seedRealLocalGtfs(): Promise<void> {
  const dbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgrespassword@localhost:5432/nextbus';

  console.log('Fetching real Haifa / Tirat Carmel Line 49 routes from Stride API...');
  const routes = await fetchJson<StrideRoute[]>(
    `${STRIDE_BASE_URL}/gtfs_routes/list?route_short_name=49&order_by=id%20desc&limit=50`
  );

  const haifaRoutes = routes.filter(
    (r) =>
      r.route_short_name === '49' &&
      r.route_long_name &&
      (r.route_long_name.includes('טירת כרמל') || r.route_long_name.includes('חוף הכרמל'))
  );

  // Direction 0: Tirat Carmel -> Hof HaCarmel (line_ref 19632, route_direction '2')
  const dir0Route =
    haifaRoutes.find((r) => r.line_ref === 19632 || r.route_direction === '2') ??
    haifaRoutes[0];
  // Direction 1: Hof HaCarmel -> Tirat Carmel (line_ref 19631, route_direction '1')
  const dir1Route =
    haifaRoutes.find((r) => r.line_ref === 19631 || r.route_direction === '1') ??
    haifaRoutes[1];

  if (!dir0Route || !dir1Route) {
    throw new Error('Could not find both directions of Haifa/Tirat Carmel Line 49 in Stride API.');
  }

  console.log(
    `Found Stride routes: dir0=${dir0Route.id} (line_ref=${dir0Route.line_ref}), dir1=${dir1Route.id} (line_ref=${dir1Route.line_ref})`
  );

  const [dir0Stops, dir1Stops] = await Promise.all([
    fetchStopsForDirection(dir0Route.id),
    fetchStopsForDirection(dir1Route.id)
  ]);

  if (dir0Stops.length === 0 || dir1Stops.length === 0) {
    throw new Error(`Empty stops received from Stride API: dir0=${dir0Stops.length}, dir1=${dir1Stops.length}`);
  }

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE routes, stops, route_stops RESTART IDENTITY CASCADE');

    const routeId = 'stride-10049';
    await client.query(
      `INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        routeId,
        String(dir0Route.operator_ref ?? '3'),
        '49',
        dir0Route.route_long_name ?? 'טירת כרמל <-> חוף הכרמל חיפה',
        'Haifa / Tirat Carmel'
      ]
    );

    const allStopsMap = new Map<string, (typeof dir0Stops)[number]>();
    for (const s of [...dir0Stops, ...dir1Stops]) {
      allStopsMap.set(s.stop_id, s);
    }

    for (const stop of allStopsMap.values()) {
      await client.query(
        `INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
         ON CONFLICT (stop_id) DO UPDATE SET
           stop_name = EXCLUDED.stop_name,
           stop_name_he = EXCLUDED.stop_name_he,
           location = EXCLUDED.location`,
        [stop.stop_id, stop.stop_code, stop.stop_name, stop.stop_name_he, stop.lon, stop.lat]
      );
    }

    for (const s of dir0Stops) {
      await client.query(
        `INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
         VALUES ($1, 0, $2, $3)`,
        [routeId, s.stop_id, s.stop_sequence]
      );
    }

    for (const s of dir1Stops) {
      await client.query(
        `INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
         VALUES ($1, 1, $2, $3)`,
        [routeId, s.stop_id, s.stop_sequence]
      );
    }

    await client.query('COMMIT');
    console.log(
      `Seeded real Line 49 GTFS into PostgreSQL: ${allStopsMap.size} unique stops, dir0=${dir0Stops.length} stops, dir1=${dir1Stops.length} stops.`
    );

    const check = await client.query(
      `SELECT * FROM find_nearest_stop_for_line($1, $2, $3, $4)`,
      ['49', 32.7895, 34.9640, 0]
    );
    console.log('Nearest stop check (32.7895, 34.9640, dir=0):', check.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

seedRealLocalGtfs().catch((err) => {
  console.error('Real local seed failed:', err);
  process.exitCode = 1;
});

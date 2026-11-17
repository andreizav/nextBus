import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

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
    lon: 34.973
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

async function seedDirect(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/nextbus';
  console.log('Connecting to PostgreSQL at:', dbUrl);

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  try {
    const routeId = 'route-49-haifa';
    console.log(`Upserting route ${routeId}...`);
    await client.query(
      `INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (route_id) DO UPDATE SET
         route_short_name = EXCLUDED.route_short_name,
         route_long_name = EXCLUDED.route_long_name,
         city_area = EXCLUDED.city_area`,
      [routeId, '3', '49', 'Tirat Carmel -> Haifa Hof HaCarmel', 'Haifa / Tirat Carmel']
    );

    console.log(`Upserting ${FALLBACK_STOPS_LINE_49.length} stops...`);
    for (const stop of FALLBACK_STOPS_LINE_49) {
      await client.query(
        `INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
         ON CONFLICT (stop_id) DO UPDATE SET
           stop_code = EXCLUDED.stop_code,
           stop_name = EXCLUDED.stop_name,
           stop_name_he = EXCLUDED.stop_name_he,
           location = EXCLUDED.location`,
        [stop.stop_id, stop.stop_code, stop.stop_name, stop.stop_name_he, stop.lon, stop.lat]
      );
    }

    console.log('Upserting route_stops...');
    const dir0Stops = FALLBACK_STOPS_LINE_49;
    for (let i = 0; i < dir0Stops.length; i++) {
      await client.query(
        `INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
           stop_id = EXCLUDED.stop_id`,
        [routeId, 0, dir0Stops[i].stop_id, i + 1]
      );
    }

    const dir1Stops = [...FALLBACK_STOPS_LINE_49].reverse();
    for (let i = 0; i < dir1Stops.length; i++) {
      await client.query(
        `INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
           stop_id = EXCLUDED.stop_id`,
        [routeId, 1, dir1Stops[i].stop_id, i + 1]
      );
    }

    console.log('Testing RPC find_nearest_stop_for_line...');
    const res = await client.query(
      `SELECT * FROM find_nearest_stop_for_line($1, $2, $3)`,
      ['49', 32.7804, 34.9658]
    );
    console.log('RPC Test Result (MATAM Park coords):', res.rows);

    console.log('Direct PostgreSQL seed completed successfully!');
  } finally {
    await client.end();
  }
}

seedDirect().catch((err) => {
  console.error('Direct seed failed:', err);
  process.exitCode = 1;
});

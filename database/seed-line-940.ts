import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function cleanSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

async function seedLine940() {
  const url = cleanSupabaseUrl(process.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  const supabase = createClient(url, key);

  console.log('1. Upserting Route 940...');
  const { error: rErr } = await supabase.from('routes').upsert([
    {
      route_id: 'stride-10940',
      agency_id: '3',
      route_short_name: '940',
      route_long_name: 'חיפה (חוף הכרמל) - ירושלים (תחנה מרכזית / רכבת נבון - ישיר אקספרס)',
      city_area: 'Intercity Haifa - Jerusalem'
    }
  ], { onConflict: 'route_id' });
  if (rErr) throw rErr;

  console.log('2. Upserting Highway waypoints...');
  const waypoints = [
    {
      stop_id: 'stop-hwy-atlit',
      stop_code: '45101',
      stop_name: 'Atlit Interchange / Highway 2',
      stop_name_he: 'מחלף עתלית / כביש 2',
      location: 'SRID=4326;POINT(34.9520 32.7050)'
    },
    {
      stop_id: 'stop-hwy-zikhron',
      stop_code: '45102',
      stop_name: 'Zikhron Yaakov Interchange / Highway 2',
      stop_name_he: 'מחלף זכרון יעקב / כביש 2',
      location: 'SRID=4326;POINT(34.9310 32.5710)'
    },
    {
      stop_id: 'stop-hwy-hadera',
      stop_code: '45103',
      stop_name: 'Olga Interchange / Hadera',
      stop_name_he: 'מחלף אולגה / חדרה',
      location: 'SRID=4326;POINT(34.8920 32.4410)'
    },
    {
      stop_id: 'stop-hwy-bengurion',
      stop_code: '46101',
      stop_name: 'Ben Gurion Airport Interchange / Highway 1',
      stop_name_he: 'מחלף נתב"ג / כביש 1',
      location: 'SRID=4326;POINT(34.8870 32.0080)'
    },
    {
      stop_id: 'stop-hwy-latrun',
      stop_code: '46102',
      stop_name: 'Latrun Interchange / Sha\'ar HaGai',
      stop_name_he: 'מחלף לטרון / שער הגיא',
      location: 'SRID=4326;POINT(34.9860 31.8340)'
    },
    {
      stop_id: 'stop-hwy-mevaseret',
      stop_code: '46103',
      stop_name: 'Harel Interchange / Mevaseret Zion',
      stop_name_he: 'מחלף הראל / מבשרת ציון',
      location: 'SRID=4326;POINT(35.1520 31.7990)'
    }
  ];

  const { error: sErr } = await supabase.from('stops').upsert(waypoints, { onConflict: 'stop_id' });
  if (sErr) throw sErr;

  console.log('3. Upserting Route Stops for Line 940...');
  const dir0Stops = [
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-42658', stop_sequence: 1 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-42362', stop_sequence: 2 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-atlit', stop_sequence: 3 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-zikhron', stop_sequence: 4 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-hadera', stop_sequence: 5 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-45001', stop_sequence: 6 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-bengurion', stop_sequence: 7 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-latrun', stop_sequence: 8 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-hwy-mevaseret', stop_sequence: 9 },
    { route_id: 'stride-10940', direction_id: 0, stop_id: 'stop-46001', stop_sequence: 10 }
  ];

  const dir1Stops = [
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-46001', stop_sequence: 1 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-mevaseret', stop_sequence: 2 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-latrun', stop_sequence: 3 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-bengurion', stop_sequence: 4 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-45001', stop_sequence: 5 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-hadera', stop_sequence: 6 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-zikhron', stop_sequence: 7 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-hwy-atlit', stop_sequence: 8 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-42362', stop_sequence: 9 },
    { route_id: 'stride-10940', direction_id: 1, stop_id: 'stop-42657', stop_sequence: 10 }
  ];

  // Also update Line 480 (Tel Aviv Savidor <-> Jerusalem)
  const line480Dir0 = [
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-45003', stop_sequence: 1 },
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-45004', stop_sequence: 2 },
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-hwy-bengurion', stop_sequence: 3 },
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-hwy-latrun', stop_sequence: 4 },
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-hwy-mevaseret', stop_sequence: 5 },
    { route_id: 'stride-10480', direction_id: 0, stop_id: 'stop-46001', stop_sequence: 6 }
  ];

  const line480Dir1 = [
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-46001', stop_sequence: 1 },
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-hwy-mevaseret', stop_sequence: 2 },
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-hwy-latrun', stop_sequence: 3 },
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-hwy-bengurion', stop_sequence: 4 },
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-45004', stop_sequence: 5 },
    { route_id: 'stride-10480', direction_id: 1, stop_id: 'stop-45003', stop_sequence: 6 }
  ];

  const allRouteStops = [...dir0Stops, ...dir1Stops, ...line480Dir0, ...line480Dir1];

  const { error: rsErr } = await supabase.from('route_stops').upsert(allRouteStops, {
    onConflict: 'route_id,direction_id,stop_sequence'
  });
  if (rsErr) throw rsErr;

  console.log(`Seeded Line 940 and highway waypoints to remote Supabase successfully! (${allRouteStops.length} stops mapped)`);
}

seedLine940().catch((err) => {
  console.error('Seed Line 940 failed:', err);
  process.exitCode = 1;
});

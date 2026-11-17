-- nextBus Migration 02: Direct A -> B Route Matching RPC & Haifa Feeder Routes

DROP FUNCTION IF EXISTS find_direct_routes_between_points(FLOAT, FLOAT, FLOAT, FLOAT, INT);

CREATE OR REPLACE FUNCTION find_direct_routes_between_points(
  origin_lat FLOAT,
  origin_lon FLOAT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  radius_meters INT DEFAULT 500
)
RETURNS TABLE (
  route_id TEXT,
  route_short_name TEXT,
  route_long_name TEXT,
  direction_id SMALLINT,
  origin_stop_id TEXT,
  origin_stop_code TEXT,
  origin_stop_name TEXT,
  origin_stop_name_he TEXT,
  origin_stop_sequence INT,
  origin_lat FLOAT,
  origin_lon FLOAT,
  dest_stop_id TEXT,
  dest_stop_code TEXT,
  dest_stop_name TEXT,
  dest_stop_name_he TEXT,
  dest_stop_sequence INT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  stops_between INT
)
LANGUAGE sql
STABLE
AS $$
  WITH origin_point AS (
    SELECT ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)::geography AS geog
  ),
  dest_point AS (
    SELECT ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::geography AS geog
  ),
  origin_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS lat,
      ST_X(s.location::geometry)::FLOAT AS lon,
      ST_Distance(s.location, op.geog)::FLOAT AS dist_m
    FROM stops s
    CROSS JOIN origin_point op
    WHERE ST_DWithin(s.location, op.geog, radius_meters)
  ),
  dest_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS lat,
      ST_X(s.location::geometry)::FLOAT AS lon,
      ST_Distance(s.location, dp.geog)::FLOAT AS dist_m
    FROM stops s
    CROSS JOIN dest_point dp
    WHERE ST_DWithin(s.location, dp.geog, radius_meters)
  )
  SELECT DISTINCT ON (r.route_id, rs_origin.direction_id)
    r.route_id,
    r.route_short_name,
    r.route_long_name,
    rs_origin.direction_id,
    os.stop_id AS origin_stop_id,
    os.stop_code AS origin_stop_code,
    os.stop_name AS origin_stop_name,
    os.stop_name_he AS origin_stop_name_he,
    rs_origin.stop_sequence AS origin_stop_sequence,
    os.lat AS origin_lat,
    os.lon AS origin_lon,
    ds.stop_id AS dest_stop_id,
    ds.stop_code AS dest_stop_code,
    ds.stop_name AS dest_stop_name,
    ds.stop_name_he AS dest_stop_name_he,
    rs_dest.stop_sequence AS dest_stop_sequence,
    ds.lat AS dest_lat,
    ds.lon AS dest_lon,
    (rs_dest.stop_sequence - rs_origin.stop_sequence)::INT AS stops_between
  FROM route_stops rs_origin
  JOIN origin_stops os ON os.stop_id = rs_origin.stop_id
  JOIN route_stops rs_dest
    ON rs_dest.route_id = rs_origin.route_id
   AND rs_dest.direction_id = rs_origin.direction_id
   AND rs_origin.stop_sequence < rs_dest.stop_sequence
  JOIN dest_stops ds ON ds.stop_id = rs_dest.stop_id
  JOIN routes r ON r.route_id = rs_origin.route_id
  ORDER BY
    r.route_id,
    rs_origin.direction_id,
    (os.dist_m + ds.dist_m) ASC,
    (rs_dest.stop_sequence - rs_origin.stop_sequence) ASC;
$$;

-- Seed additional Haifa corridor routes (Lines 24, 11, 123) connecting Hof HaCarmel / Matam / Tirat Carmel
-- with Horev Center, Carmel Center, Technion and Grand Canyon (idempotent upsert).
INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10024', '3', '24', 'חוף הכרמל - מת''מ - מרכז חורב - מרכז הכרמל (חיפה)', 'Haifa'),
  ('stride-10011', '3', '11', 'חוף הכרמל - מת''מ - פרויד - חורב - טכניון (חיפה)', 'Haifa'),
  ('stride-10123', '3', '123', 'טירת כרמל - מת''מ - חורב - גרנד קניון (חיפה)', 'Haifa / Tirat Carmel')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  ('stop-43011', '43011', 'Freud / Binyamin (Haifa)', 'פרויד / בנימין (חיפה)', ST_SetSRID(ST_MakePoint(34.9695, 32.7885), 4326)::geography),
  ('stop-43012', '43012', 'Freud / Ramat Eshkol (Haifa)', 'פרויד / רמת אשכול (חיפה)', ST_SetSRID(ST_MakePoint(34.9768, 32.7868), 4326)::geography),
  ('stop-43013', '43013', 'Horev Center / Clinic (Haifa)', 'מרכז חורב / מרפאה (חיפה)', ST_SetSRID(ST_MakePoint(34.9859, 32.7832), 4326)::geography),
  ('stop-43014', '43014', 'Horev / Freud (Haifa)', 'חורב / פרויד (חיפה)', ST_SetSRID(ST_MakePoint(34.9863, 32.7848), 4326)::geography),
  ('stop-43015', '43015', 'Moriah Blvd / Sinai (Haifa)', 'שד'' מוריה / סיני (חיפה)', ST_SetSRID(ST_MakePoint(34.9850, 32.7924), 4326)::geography),
  ('stop-43016', '43016', 'Carmel Center / Hanassi (Haifa)', 'מרכז הכרמל / הנשיא (חיפה)', ST_SetSRID(ST_MakePoint(34.9855, 32.8018), 4326)::geography),
  ('stop-43021', '43021', 'Carmel Hospital / Renak (Haifa)', 'בית חולים כרמל / רנ''ק (חיפה)', ST_SetSRID(ST_MakePoint(34.9815, 32.7841), 4326)::geography),
  ('stop-43022', '43022', 'Pika / Horev (Haifa)', 'פיק''א / חורב (חיפה)', ST_SetSRID(ST_MakePoint(34.9912, 32.7836), 4326)::geography),
  ('stop-43023', '43023', 'Pika / Hadasah (Haifa)', 'פיק''א / הדסה (חיפה)', ST_SetSRID(ST_MakePoint(34.9998, 32.7830), 4326)::geography),
  ('stop-43024', '43024', 'Technion / Neve Shaanan (Haifa)', 'טכניון / נווה שאנן (חיפה)', ST_SetSRID(ST_MakePoint(35.0215, 32.7775), 4326)::geography),
  ('stop-43031', '43031', 'Einstein / Horev (Haifa)', 'איינשטיין / חורב (חיפה)', ST_SetSRID(ST_MakePoint(34.9950, 32.7850), 4326)::geography),
  ('stop-43032', '43032', 'Grand Canyon Mall (Haifa)', 'גרנד קניון / שמחה גולן (חיפה)', ST_SetSRID(ST_MakePoint(35.0082, 32.7892), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

-- Line 24 direction 0: Hof HaCarmel -> Matam -> Horev -> Carmel Center
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10024', 0, 'stop-42658', 1),
  ('stride-10024', 0, 'stop-42502', 2),
  ('stride-10024', 0, 'stop-42362', 3),
  ('stride-10024', 0, 'stop-42656', 4),
  ('stride-10024', 0, 'stop-43011', 5),
  ('stride-10024', 0, 'stop-43012', 6),
  ('stride-10024', 0, 'stop-43013', 7),
  ('stride-10024', 0, 'stop-43014', 8),
  ('stride-10024', 0, 'stop-43015', 9),
  ('stride-10024', 0, 'stop-43016', 10),
  -- Line 24 direction 1: Carmel Center -> Horev -> Matam -> Hof HaCarmel
  ('stride-10024', 1, 'stop-43016', 1),
  ('stride-10024', 1, 'stop-43015', 2),
  ('stride-10024', 1, 'stop-43014', 3),
  ('stride-10024', 1, 'stop-43013', 4),
  ('stride-10024', 1, 'stop-43012', 5),
  ('stride-10024', 1, 'stop-43011', 6),
  ('stride-10024', 1, 'stop-42656', 7),
  ('stride-10024', 1, 'stop-42362', 8),
  ('stride-10024', 1, 'stop-42657', 9),
  -- Line 11 direction 0: Hof HaCarmel -> Matam -> Freud -> Horev -> Technion
  ('stride-10011', 0, 'stop-42658', 1),
  ('stride-10011', 0, 'stop-42656', 2),
  ('stride-10011', 0, 'stop-42362', 3),
  ('stride-10011', 0, 'stop-43011', 4),
  ('stride-10011', 0, 'stop-43012', 5),
  ('stride-10011', 0, 'stop-43021', 6),
  ('stride-10011', 0, 'stop-43013', 7),
  ('stride-10011', 0, 'stop-43022', 8),
  ('stride-10011', 0, 'stop-43023', 9),
  ('stride-10011', 0, 'stop-43024', 10),
  -- Line 11 direction 1: Technion -> Horev -> Matam -> Hof HaCarmel
  ('stride-10011', 1, 'stop-43024', 1),
  ('stride-10011', 1, 'stop-43023', 2),
  ('stride-10011', 1, 'stop-43022', 3),
  ('stride-10011', 1, 'stop-43013', 4),
  ('stride-10011', 1, 'stop-43021', 5),
  ('stride-10011', 1, 'stop-43012', 6),
  ('stride-10011', 1, 'stop-43011', 7),
  ('stride-10011', 1, 'stop-42362', 8),
  ('stride-10011', 1, 'stop-42657', 9),
  -- Line 123 direction 0: Tirat Carmel -> Matam -> Horev -> Grand Canyon
  ('stride-10123', 0, 'stop-41949', 1),
  ('stride-10123', 0, 'stop-40958', 2),
  ('stride-10123', 0, 'stop-40965', 3),
  ('stride-10123', 0, 'stop-42362', 4),
  ('stride-10123', 0, 'stop-43011', 5),
  ('stride-10123', 0, 'stop-43012', 6),
  ('stride-10123', 0, 'stop-43013', 7),
  ('stride-10123', 0, 'stop-43031', 8),
  ('stride-10123', 0, 'stop-43032', 9),
  -- Line 123 direction 1: Grand Canyon -> Horev -> Matam -> Tirat Carmel
  ('stride-10123', 1, 'stop-43032', 1),
  ('stride-10123', 1, 'stop-43031', 2),
  ('stride-10123', 1, 'stop-43013', 3),
  ('stride-10123', 1, 'stop-43012', 4),
  ('stride-10123', 1, 'stop-43011', 5),
  ('stride-10123', 1, 'stop-42362', 6),
  ('stride-10123', 1, 'stop-40965', 7),
  ('stride-10123', 1, 'stop-40958', 8),
  ('stride-10123', 1, 'stop-41949', 9)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;

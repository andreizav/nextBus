-- =============================================================================
-- nextBus Consolidated Supabase / PostgreSQL + PostGIS Setup
-- Run this script once in the Supabase SQL Editor (https://twrdbgtyewzpqxcrizls.supabase.co)
-- After running, execute `npm --prefix database run seed` to load all Line 49 GTFS stops.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Core Schema (from database/schema.sql)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Routes table
CREATE TABLE IF NOT EXISTS routes (
  route_id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL,
  route_short_name TEXT NOT NULL,
  route_long_name TEXT NOT NULL,
  city_area TEXT
);

CREATE INDEX IF NOT EXISTS idx_routes_short_name
  ON routes (route_short_name);

-- 2. Stops table with PostGIS Geography Point
CREATE TABLE IF NOT EXISTS stops (
  stop_id TEXT PRIMARY KEY,
  stop_code TEXT NOT NULL,
  stop_name TEXT NOT NULL,
  stop_name_he TEXT,
  location GEOGRAPHY(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stops_code
  ON stops (stop_code);

CREATE INDEX IF NOT EXISTS idx_stops_location_gist
  ON stops USING GIST (location);

-- 3. Route-to-Stop ordered mapping per direction
CREATE TABLE IF NOT EXISTS route_stops (
  id SERIAL PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE,
  direction_id SMALLINT NOT NULL CHECK (direction_id IN (0, 1)),
  stop_id TEXT NOT NULL REFERENCES stops(stop_id) ON DELETE CASCADE,
  stop_sequence INT NOT NULL,
  UNIQUE (route_id, direction_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_route_stops_lookup
  ON route_stops (route_id, direction_id, stop_sequence);

-- 4. Single-query PostGIS RPC to locate nearest stop for a bus line
DROP FUNCTION IF EXISTS find_nearest_stop_for_line(TEXT, FLOAT, FLOAT);
DROP FUNCTION IF EXISTS find_nearest_stop_for_line(TEXT, FLOAT, FLOAT, SMALLINT);

CREATE OR REPLACE FUNCTION find_nearest_stop_for_line(
  line_num TEXT,
  user_lat FLOAT,
  user_lon FLOAT,
  preferred_dir SMALLINT DEFAULT NULL
)
RETURNS TABLE (
  route_id TEXT,
  direction_id SMALLINT,
  stop_id TEXT,
  stop_sequence INT,
  stop_code TEXT,
  stop_name TEXT,
  stop_name_he TEXT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  route_short_name TEXT,
  route_long_name TEXT,
  distance_meters FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.route_id,
    rs.direction_id,
    s.stop_id,
    rs.stop_sequence,
    s.stop_code,
    s.stop_name,
    COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
    ST_Y(s.location::geometry)::FLOAT AS stop_lat,
    ST_X(s.location::geometry)::FLOAT AS stop_lon,
    r.route_short_name,
    r.route_long_name,
    ST_Distance(
      s.location,
      ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography
    )::FLOAT AS distance_meters
  FROM routes r
  JOIN route_stops rs ON rs.route_id = r.route_id
  JOIN stops s ON s.stop_id = rs.stop_id
  WHERE r.route_short_name = line_num
    AND (preferred_dir IS NULL OR rs.direction_id = preferred_dir)
  ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. Ordered Stop Coordinates RPC (for PostgREST / Railway production)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_direction_stop_coords(TEXT, SMALLINT);

CREATE OR REPLACE FUNCTION get_direction_stop_coords(
  p_route_id TEXT,
  p_direction_id SMALLINT
)
RETURNS TABLE (
  stop_id TEXT,
  stop_code TEXT,
  stop_name TEXT,
  stop_name_he TEXT,
  stop_sequence INT,
  lat FLOAT,
  lon FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.stop_id,
    s.stop_code,
    s.stop_name,
    COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
    rs.stop_sequence,
    ST_Y(s.location::geometry)::FLOAT AS lat,
    ST_X(s.location::geometry)::FLOAT AS lon
  FROM route_stops rs
  JOIN stops s ON s.stop_id = rs.stop_id
  WHERE rs.route_id = p_route_id
    AND rs.direction_id = p_direction_id
  ORDER BY rs.stop_sequence ASC;
$$;

-- -----------------------------------------------------------------------------
-- 3. Base Shared Hub Stops (ensures FK integrity before migration_02/03)
-- -----------------------------------------------------------------------------
INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  ('stop-40958', '40958', 'תעש טירה (טירת כרמל)', 'תעש טירה (טירת כרמל)', ST_SetSRID(ST_MakePoint(34.962876, 32.781207), 4326)::geography),
  ('stop-40965', '40965', 'ההגנה/רוטנברג (חיפה)', 'ההגנה/רוטנברג (חיפה)', ST_SetSRID(ST_MakePoint(34.962823, 32.785647), 4326)::geography),
  ('stop-41949', '41949', 'מרכז לבריאות הנפש טירת כרמל (טירת כרמל)', 'מרכז לבריאות הנפש טירת כרמל (טירת כרמל)', ST_SetSRID(ST_MakePoint(34.974635, 32.750932), 4326)::geography),
  ('stop-42362', '42362', 'מת''מ/ההגנה (חיפה)', 'מת''מ/ההגנה (חיפה)', ST_SetSRID(ST_MakePoint(34.962117, 32.789609), 4326)::geography),
  ('stop-42502', '42502', 'סחרוב (חיפה)', 'סחרוב (חיפה)', ST_SetSRID(ST_MakePoint(34.959315, 32.790059), 4326)::geography),
  ('stop-42656', '42656', 'מת''מ (חיפה)', 'מת''מ (חיפה)', ST_SetSRID(ST_MakePoint(34.961340, 32.790385), 4326)::geography),
  ('stop-42657', '42657', 'ת. מרכזית חוף הכרמל/הורדה (חיפה)', 'ת. מרכזית חוף הכרמל/הורדה (חיפה)', ST_SetSRID(ST_MakePoint(34.959587, 32.793368), 4326)::geography),
  ('stop-42658', '42658', 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)', 'ת. מרכזית חוף הכרמל/רציפים בינעירוני (חיפה)', ST_SetSRID(ST_MakePoint(34.958985, 32.793372), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

-- -----------------------------------------------------------------------------
-- 4. Migration 02: Direct A -> B Route Matching RPC & Haifa Feeder Routes
-- -----------------------------------------------------------------------------
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
  ('stride-10024', 1, 'stop-43016', 1),
  ('stride-10024', 1, 'stop-43015', 2),
  ('stride-10024', 1, 'stop-43014', 3),
  ('stride-10024', 1, 'stop-43013', 4),
  ('stride-10024', 1, 'stop-43012', 5),
  ('stride-10024', 1, 'stop-43011', 6),
  ('stride-10024', 1, 'stop-42656', 7),
  ('stride-10024', 1, 'stop-42362', 8),
  ('stride-10024', 1, 'stop-42657', 9),
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
  ('stride-10011', 1, 'stop-43024', 1),
  ('stride-10011', 1, 'stop-43023', 2),
  ('stride-10011', 1, 'stop-43022', 3),
  ('stride-10011', 1, 'stop-43013', 4),
  ('stride-10011', 1, 'stop-43021', 5),
  ('stride-10011', 1, 'stop-43012', 6),
  ('stride-10011', 1, 'stop-43011', 7),
  ('stride-10011', 1, 'stop-42362', 8),
  ('stride-10011', 1, 'stop-42657', 9),
  ('stride-10123', 0, 'stop-41949', 1),
  ('stride-10123', 0, 'stop-40958', 2),
  ('stride-10123', 0, 'stop-40965', 3),
  ('stride-10123', 0, 'stop-42362', 4),
  ('stride-10123', 0, 'stop-43011', 5),
  ('stride-10123', 0, 'stop-43012', 6),
  ('stride-10123', 0, 'stop-43013', 7),
  ('stride-10123', 0, 'stop-43031', 8),
  ('stride-10123', 0, 'stop-43032', 9),
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

-- -----------------------------------------------------------------------------
-- 5. Migration 03: 1-Transfer Multi-Leg Route Matching RPC & Connecting Routes
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS find_transfer_routes_between_points(FLOAT, FLOAT, FLOAT, FLOAT, INT, INT);

CREATE OR REPLACE FUNCTION find_transfer_routes_between_points(
  origin_lat FLOAT,
  origin_lon FLOAT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  radius_meters INT DEFAULT 650,
  transfer_walk_meters INT DEFAULT 260
)
RETURNS TABLE (
  leg1_route_id TEXT,
  leg1_route_short_name TEXT,
  leg1_route_long_name TEXT,
  leg1_direction_id SMALLINT,
  origin_stop_id TEXT,
  origin_stop_code TEXT,
  origin_stop_name TEXT,
  origin_stop_name_he TEXT,
  origin_stop_sequence INT,
  origin_lat FLOAT,
  origin_lon FLOAT,
  xfer_alight_stop_id TEXT,
  xfer_alight_stop_code TEXT,
  xfer_alight_stop_name TEXT,
  xfer_alight_stop_name_he TEXT,
  xfer_alight_stop_sequence INT,
  xfer_alight_lat FLOAT,
  xfer_alight_lon FLOAT,
  leg1_stops_between INT,
  transfer_walk_meters_actual INT,
  leg2_route_id TEXT,
  leg2_route_short_name TEXT,
  leg2_route_long_name TEXT,
  leg2_direction_id SMALLINT,
  xfer_board_stop_id TEXT,
  xfer_board_stop_code TEXT,
  xfer_board_stop_name TEXT,
  xfer_board_stop_name_he TEXT,
  xfer_board_stop_sequence INT,
  xfer_board_lat FLOAT,
  xfer_board_lon FLOAT,
  dest_stop_id TEXT,
  dest_stop_code TEXT,
  dest_stop_name TEXT,
  dest_stop_name_he TEXT,
  dest_stop_sequence INT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  leg2_stops_between INT
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
  SELECT DISTINCT ON (r1.route_id, rs1_origin.direction_id, r2.route_id, rs2_xfer.direction_id)
    r1.route_id AS leg1_route_id,
    r1.route_short_name AS leg1_route_short_name,
    r1.route_long_name AS leg1_route_long_name,
    rs1_origin.direction_id AS leg1_direction_id,
    os.stop_id AS origin_stop_id,
    os.stop_code AS origin_stop_code,
    os.stop_name AS origin_stop_name,
    os.stop_name_he AS origin_stop_name_he,
    rs1_origin.stop_sequence AS origin_stop_sequence,
    os.lat AS origin_lat,
    os.lon AS origin_lon,
    sx1.stop_id AS xfer_alight_stop_id,
    sx1.stop_code AS xfer_alight_stop_code,
    sx1.stop_name AS xfer_alight_stop_name,
    COALESCE(sx1.stop_name_he, sx1.stop_name) AS xfer_alight_stop_name_he,
    rs1_xfer.stop_sequence AS xfer_alight_stop_sequence,
    ST_Y(sx1.location::geometry)::FLOAT AS xfer_alight_lat,
    ST_X(sx1.location::geometry)::FLOAT AS xfer_alight_lon,
    (rs1_xfer.stop_sequence - rs1_origin.stop_sequence)::INT AS leg1_stops_between,
    ROUND(ST_Distance(sx1.location, sx2.location))::INT AS transfer_walk_meters_actual,
    r2.route_id AS leg2_route_id,
    r2.route_short_name AS leg2_route_short_name,
    r2.route_long_name AS leg2_route_long_name,
    rs2_xfer.direction_id AS leg2_direction_id,
    sx2.stop_id AS xfer_board_stop_id,
    sx2.stop_code AS xfer_board_stop_code,
    sx2.stop_name AS xfer_board_stop_name,
    COALESCE(sx2.stop_name_he, sx2.stop_name) AS xfer_board_stop_name_he,
    rs2_xfer.stop_sequence AS xfer_board_stop_sequence,
    ST_Y(sx2.location::geometry)::FLOAT AS xfer_board_lat,
    ST_X(sx2.location::geometry)::FLOAT AS xfer_board_lon,
    ds.stop_id AS dest_stop_id,
    ds.stop_code AS dest_stop_code,
    ds.stop_name AS dest_stop_name,
    ds.stop_name_he AS dest_stop_name_he,
    rs2_dest.stop_sequence AS dest_stop_sequence,
    ds.lat AS dest_lat,
    ds.lon AS dest_lon,
    (rs2_dest.stop_sequence - rs2_xfer.stop_sequence)::INT AS leg2_stops_between
  FROM origin_stops os
  JOIN route_stops rs1_origin ON rs1_origin.stop_id = os.stop_id
  JOIN route_stops rs1_xfer
    ON rs1_xfer.route_id = rs1_origin.route_id
   AND rs1_xfer.direction_id = rs1_origin.direction_id
   AND rs1_origin.stop_sequence < rs1_xfer.stop_sequence
  JOIN stops sx1 ON sx1.stop_id = rs1_xfer.stop_id
  JOIN stops sx2
    ON (sx2.stop_id = sx1.stop_id OR ST_DWithin(sx1.location, sx2.location, transfer_walk_meters))
  JOIN route_stops rs2_xfer
    ON rs2_xfer.stop_id = sx2.stop_id
   AND rs2_xfer.route_id <> rs1_origin.route_id
  JOIN route_stops rs2_dest
    ON rs2_dest.route_id = rs2_xfer.route_id
   AND rs2_dest.direction_id = rs2_xfer.direction_id
   AND rs2_xfer.stop_sequence < rs2_dest.stop_sequence
  JOIN dest_stops ds ON ds.stop_id = rs2_dest.stop_id
  JOIN routes r1 ON r1.route_id = rs1_origin.route_id
  JOIN routes r2 ON r2.route_id = rs2_xfer.route_id
  ORDER BY
    r1.route_id,
    rs1_origin.direction_id,
    r2.route_id,
    rs2_xfer.direction_id,
    ((rs1_xfer.stop_sequence - rs1_origin.stop_sequence) + (rs2_dest.stop_sequence - rs2_xfer.stop_sequence)) ASC,
    (os.dist_m + ds.dist_m + ST_Distance(sx1.location, sx2.location)) ASC;
$$;

INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10037', '3', '37', 'מרכז הכרמל - מרכז חורב - דניה - אוניברסיטת חיפה', 'Haifa'),
  ('stride-10028', '3', '28', 'מרכז חורב - מרכז הכרמל - הדר - רמב"ם בת גלים (חיפה)', 'Haifa'),
  ('stride-10017', '3', '17', 'ת. מרכזית חוף הכרמל - המושבה הגרמנית - רמב"ם בת גלים (חיפה)', 'Haifa')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  ('stop-43041', '43041', 'Abba Hushi / Denia (Haifa)', 'אבא חושי / דניה (חיפה)', ST_SetSRID(ST_MakePoint(35.0022, 32.7718), 4326)::geography),
  ('stop-43042', '43042', 'University of Haifa / Eshkol (Haifa)', 'אוניברסיטת חיפה / אשכול (חיפה)', ST_SetSRID(ST_MakePoint(35.0185, 32.7620), 4326)::geography),
  ('stop-43051', '43051', 'Hadar / Herzl St (Haifa)', 'הדר / רחוב הרצל (חיפה)', ST_SetSRID(ST_MakePoint(34.9965, 32.8115), 4326)::geography),
  ('stop-43052', '43052', 'Rambam Hospital / Bat Galim (Haifa)', 'בית חולים רמב"ם / בת גלים (חיפה)', ST_SetSRID(ST_MakePoint(34.9862, 32.8325), 4326)::geography),
  ('stop-43061', '43061', 'German Colony / Ben Gurion (Haifa)', 'המושבה הגרמנית / בן גוריון (חיפה)', ST_SetSRID(ST_MakePoint(34.9895, 32.8195), 4326)::geography),
  ('stop-43062', '43062', 'Allenby / Kiryat Eliezer (Haifa)', 'אלנבי / קרית אליעזר (חיפה)', ST_SetSRID(ST_MakePoint(34.9760, 32.8235), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10037', 0, 'stop-43016', 1),
  ('stride-10037', 0, 'stop-43015', 2),
  ('stride-10037', 0, 'stop-43013', 3),
  ('stride-10037', 0, 'stop-43041', 4),
  ('stride-10037', 0, 'stop-43042', 5),
  ('stride-10037', 1, 'stop-43042', 1),
  ('stride-10037', 1, 'stop-43041', 2),
  ('stride-10037', 1, 'stop-43013', 3),
  ('stride-10037', 1, 'stop-43015', 4),
  ('stride-10037', 1, 'stop-43016', 5),
  ('stride-10028', 0, 'stop-43013', 1),
  ('stride-10028', 0, 'stop-43015', 2),
  ('stride-10028', 0, 'stop-43016', 3),
  ('stride-10028', 0, 'stop-43051', 4),
  ('stride-10028', 0, 'stop-43052', 5),
  ('stride-10028', 1, 'stop-43052', 1),
  ('stride-10028', 1, 'stop-43051', 2),
  ('stride-10028', 1, 'stop-43016', 3),
  ('stride-10028', 1, 'stop-43015', 4),
  ('stride-10028', 1, 'stop-43013', 5),
  ('stride-10017', 0, 'stop-42658', 1),
  ('stride-10017', 0, 'stop-43062', 2),
  ('stride-10017', 0, 'stop-43061', 3),
  ('stride-10017', 0, 'stop-43052', 4),
  ('stride-10017', 1, 'stop-43052', 1),
  ('stride-10017', 1, 'stop-43061', 2),
  ('stride-10017', 1, 'stop-43062', 3),
  ('stride-10017', 1, 'stop-42657', 4)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;
-- nextBus Migration 04: Intercity Corridor (Haifa <-> Tel Aviv <-> Jerusalem) and Tel Aviv Core Lines
-- Connects Haifa Hof HaCarmel & Matam directly to Tel Aviv (Savidor, Azrieli, Central) and Jerusalem.

-- 1. Insert new Intercity and Central District routes
INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10910', '3', '910', 'חיפה (חוף הכרמל) - נתניה - תל אביב (סבידור / עזריאלי / ת. מרכזית)', 'Intercity Haifa - Tel Aviv'),
  ('stride-10900', '3', '900', 'חיפה (חוף הכרמל) - תל אביב (עזריאלי / סבידור - אקספרס ישיר)', 'Intercity Haifa - Tel Aviv'),
  ('stride-10005', '5', '5', 'ת. מרכזית תל אביב - רוטשילד - דיזנגוף סנטר - רכבת מרכז סבידור', 'Tel Aviv'),
  ('stride-10480', '3', '480', 'תל אביב (סבידור) - ירושלים (תחנה מרכזית / רכבת נבון - אקספרס)', 'Intercity Tel Aviv - Jerusalem')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

-- 2. Insert new Tel Aviv, Netanya and Jerusalem major transit stops
INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  -- Netanya Highway 2 Interchange
  ('stop-45001', '45001', 'Netanya Interchange / Highway 2 (Netanya)', 'מחלף נתניה / כביש 2 (נתניה)', ST_SetSRID(ST_MakePoint(34.8565, 32.3275), 4326)::geography),
  -- Glilot Interchange (Cinema City)
  ('stop-45002', '45002', 'Glilot Interchange / Cinema City', 'מחלף גלילות / סינמה סיטי', ST_SetSRID(ST_MakePoint(34.7995, 32.1465), 4326)::geography),
  -- Tel Aviv Savidor Train & Central Bus Terminal
  ('stop-45003', '45003', 'Tel Aviv - Savidor Central Train & Terminal', 'תל אביב - רכבת מרכז / מסוף סבידור', ST_SetSRID(ST_MakePoint(34.7978, 32.0837), 4326)::geography),
  -- Tel Aviv Azrieli Center / Menachem Begin Rd
  ('stop-45004', '45004', 'Tel Aviv - Azrieli Mall / Menachem Begin', 'תל אביב - קניון עזריאלי / דרך מנחם בגין', ST_SetSRID(ST_MakePoint(34.7920, 32.0747), 4326)::geography),
  -- Tel Aviv New Central Bus Station (Level 6)
  ('stop-45005', '45005', 'Tel Aviv - New Central Bus Station (Floor 6)', 'תל אביב - ת. מרכזית חדשה (קומה 6)', ST_SetSRID(ST_MakePoint(34.7788, 32.0558), 4326)::geography),
  -- Tel Aviv Urban Line 5 stops (Rothschild, Habima, Dizengoff)
  ('stop-45011', '45011', 'Tel Aviv - Rothschild Blvd / Nahalat Binyamin', 'תל אביב - שדרות רוטשילד / נחלת בנימין', ST_SetSRID(ST_MakePoint(34.7715, 32.0635), 4326)::geography),
  ('stop-45012', '45012', 'Tel Aviv - Habima Theater / Ben Zion', 'תל אביב - תיאטרון הבימה / בן ציון', ST_SetSRID(ST_MakePoint(34.7785, 32.0722), 4326)::geography),
  ('stop-45013', '45013', 'Tel Aviv - Dizengoff Center / King George', 'תל אביב - דיזנגוף סנטר / המלך ג''ורג''', ST_SetSRID(ST_MakePoint(34.7749, 32.0754), 4326)::geography),
  ('stop-45014', '45014', 'Tel Aviv - Dizengoff Square / Frishman', 'תל אביב - כיכר דיזנגוף / פרישמן', ST_SetSRID(ST_MakePoint(34.7742, 32.0788), 4326)::geography),
  ('stop-45015', '45015', 'Tel Aviv - Arlozorov / Weizmann', 'תל אביב - ארלוזורוב / ויצמן', ST_SetSRID(ST_MakePoint(34.7895, 32.0855), 4326)::geography),
  -- Jerusalem Central Bus Station & Yitzhak Navon Train Station
  ('stop-46001', '46001', 'Jerusalem - Central Bus Station / Navon', 'ירושלים - תחנה מרכזית / רכבת נבון', ST_SetSRID(ST_MakePoint(35.2030, 31.7890), 4326)::geography),
  -- Jerusalem City Center / Jaffa St
  ('stop-46002', '46002', 'Jerusalem - City Center / Jaffa St', 'ירושלים - מרכז העיר / רחוב יפו', ST_SetSRID(ST_MakePoint(35.2180, 31.7820), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

-- 3. Route Stops Mapping

-- Line 910: Dir 0 (Haifa Hof HaCarmel -> Tel Aviv Central)
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10910', 0, 'stop-42658', 1), -- Hof HaCarmel Intercity Platforms
  ('stride-10910', 0, 'stop-42362', 2), -- Matam / HaHagana
  ('stride-10910', 0, 'stop-45001', 3), -- Netanya Interchange
  ('stride-10910', 0, 'stop-45002', 4), -- Glilot Interchange
  ('stride-10910', 0, 'stop-45003', 5), -- Tel Aviv Savidor Central
  ('stride-10910', 0, 'stop-45004', 6), -- Tel Aviv Azrieli
  ('stride-10910', 0, 'stop-45005', 7), -- Tel Aviv Central Bus Station
  -- Line 910: Dir 1 (Tel Aviv Central -> Haifa Hof HaCarmel)
  ('stride-10910', 1, 'stop-45005', 1),
  ('stride-10910', 1, 'stop-45004', 2),
  ('stride-10910', 1, 'stop-45003', 3),
  ('stride-10910', 1, 'stop-45002', 4),
  ('stride-10910', 1, 'stop-45001', 5),
  ('stride-10910', 1, 'stop-42362', 6),
  ('stride-10910', 1, 'stop-42657', 7),
  -- Line 900: Dir 0 (Haifa Hof HaCarmel -> Tel Aviv Express)
  ('stride-10900', 0, 'stop-42658', 1),
  ('stride-10900', 0, 'stop-42362', 2),
  ('stride-10900', 0, 'stop-45003', 3),
  ('stride-10900', 0, 'stop-45004', 4),
  ('stride-10900', 0, 'stop-45005', 5),
  -- Line 900: Dir 1 (Tel Aviv Express -> Haifa Hof HaCarmel)
  ('stride-10900', 1, 'stop-45005', 1),
  ('stride-10900', 1, 'stop-45004', 2),
  ('stride-10900', 1, 'stop-45003', 3),
  ('stride-10900', 1, 'stop-42362', 4),
  ('stride-10900', 1, 'stop-42657', 5),
  -- Line 5: Dir 0 (Tel Aviv Central -> Rothschild -> Dizengoff -> Savidor)
  ('stride-10005', 0, 'stop-45005', 1),
  ('stride-10005', 0, 'stop-45011', 2),
  ('stride-10005', 0, 'stop-45012', 3),
  ('stride-10005', 0, 'stop-45013', 4),
  ('stride-10005', 0, 'stop-45014', 5),
  ('stride-10005', 0, 'stop-45015', 6),
  ('stride-10005', 0, 'stop-45003', 7),
  -- Line 5: Dir 1 (Savidor -> Dizengoff -> Rothschild -> Tel Aviv Central)
  ('stride-10005', 1, 'stop-45003', 1),
  ('stride-10005', 1, 'stop-45015', 2),
  ('stride-10005', 1, 'stop-45014', 3),
  ('stride-10005', 1, 'stop-45013', 4),
  ('stride-10005', 1, 'stop-45012', 5),
  ('stride-10005', 1, 'stop-45011', 6),
  ('stride-10005', 1, 'stop-45005', 7),
  -- Line 480: Dir 0 (Tel Aviv Savidor -> Jerusalem Central)
  ('stride-10480', 0, 'stop-45003', 1),
  ('stride-10480', 0, 'stop-46001', 2),
  -- Line 480: Dir 1 (Jerusalem Central -> Tel Aviv Savidor)
  ('stride-10480', 1, 'stop-46001', 1),
  ('stride-10480', 1, 'stop-45003', 2)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;
-- nextBus Migration 05: Line 940 (Haifa Hof HaCarmel <-> Jerusalem Express) & Highway 1/2 Road Waypoints
-- Provides direct 1-transfer connectivity from Tirat Carmel (Bus 49 -> Hof HaCarmel -> Bus 940 -> Jerusalem)
-- and realistic road curvature for Leaflet polylines.

-- 1. Insert Line 940 (Haifa <-> Jerusalem Direct Express)
INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10940', '3', '940', 'חיפה (חוף הכרמל) - ירושלים (תחנה מרכזית / רכבת נבון - ישיר אקספרס)', 'Intercity Haifa - Jerusalem')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

-- 2. Insert intermediate Highway 2 (Coastal) and Highway 1 (Jerusalem Corridor) waypoints
INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  -- Route 2: Atlit Interchange
  ('stop-hwy-atlit', '45101', 'Atlit Interchange / Highway 2', 'מחלף עתלית / כביש 2', ST_SetSRID(ST_MakePoint(34.9520, 32.7050), 4326)::geography),
  -- Route 2: Zikhron Yaakov Interchange
  ('stop-hwy-zikhron', '45102', 'Zikhron Yaakov Interchange / Highway 2', 'מחלף זכרון יעקב / כביש 2', ST_SetSRID(ST_MakePoint(34.9310, 32.5710), 4326)::geography),
  -- Route 2: Olga / Hadera Interchange
  ('stop-hwy-hadera', '45103', 'Olga Interchange / Hadera', 'מחלף אולגה / חדרה', ST_SetSRID(ST_MakePoint(34.8920, 32.4410), 4326)::geography),
  -- Route 1: Ben Gurion Airport Interchange
  ('stop-hwy-bengurion', '46101', 'Ben Gurion Airport Interchange / Highway 1', 'מחלף נתב''ג / כביש 1', ST_SetSRID(ST_MakePoint(34.8870, 32.0080), 4326)::geography),
  -- Route 1: Latrun / Sha''ar HaGai Interchange
  ('stop-hwy-latrun', '46102', 'Latrun Interchange / Sha''ar HaGai', 'מחלף לטרון / שער הגיא', ST_SetSRID(ST_MakePoint(34.9860, 31.8340), 4326)::geography),
  -- Route 1: Harel Interchange / Mevaseret Zion
  ('stop-hwy-mevaseret', '46103', 'Harel Interchange / Mevaseret Zion', 'מחלף הראל / מבשרת ציון', ST_SetSRID(ST_MakePoint(35.1520, 31.7990), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

-- 3. Delete existing route_stops for updated routes to ensure clean sequence
DELETE FROM route_stops WHERE route_id IN ('stride-10940', 'stride-10480');

-- 4. Map Line 940 (Haifa Hof HaCarmel <-> Jerusalem Central Express)
-- Direction 0: Haifa -> Jerusalem
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10940', 0, 'stop-42658', 1),       -- Haifa Hof HaCarmel Intercity Hub
  ('stride-10940', 0, 'stop-42362', 2),       -- Matam / HaHagana
  ('stride-10940', 0, 'stop-hwy-atlit', 3),   -- Atlit Interchange
  ('stride-10940', 0, 'stop-hwy-zikhron', 4), -- Zikhron Interchange
  ('stride-10940', 0, 'stop-hwy-hadera', 5),  -- Hadera Interchange
  ('stride-10940', 0, 'stop-45001', 6),       -- Netanya Interchange
  ('stride-10940', 0, 'stop-hwy-bengurion', 7),-- Ben Gurion / Route 1
  ('stride-10940', 0, 'stop-hwy-latrun', 8),  -- Latrun / Sha'ar HaGai
  ('stride-10940', 0, 'stop-hwy-mevaseret', 9),-- Mevaseret Zion
  ('stride-10940', 0, 'stop-46001', 10);      -- Jerusalem Central Bus Station / Navon

-- Direction 1: Jerusalem -> Haifa
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10940', 1, 'stop-46001', 1),       -- Jerusalem Central Bus Station
  ('stride-10940', 1, 'stop-hwy-mevaseret', 2),
  ('stride-10940', 1, 'stop-hwy-latrun', 3),
  ('stride-10940', 1, 'stop-hwy-bengurion', 4),
  ('stride-10940', 1, 'stop-45001', 5),
  ('stride-10940', 1, 'stop-hwy-hadera', 6),
  ('stride-10940', 1, 'stop-hwy-zikhron', 7),
  ('stride-10940', 1, 'stop-hwy-atlit', 8),
  ('stride-10940', 1, 'stop-42362', 9),
  ('stride-10940', 1, 'stop-42657', 10);      -- Haifa Hof HaCarmel

-- 5. Update Line 480 (Tel Aviv Savidor <-> Jerusalem Central Express) with road waypoints
-- Direction 0: Tel Aviv Savidor -> Jerusalem Central
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10480', 0, 'stop-45003', 1),       -- Tel Aviv Savidor
  ('stride-10480', 0, 'stop-45004', 2),       -- Tel Aviv Azrieli
  ('stride-10480', 0, 'stop-hwy-bengurion', 3),-- Ben Gurion / Route 1
  ('stride-10480', 0, 'stop-hwy-latrun', 4),  -- Latrun / Sha'ar HaGai
  ('stride-10480', 0, 'stop-hwy-mevaseret', 5),-- Mevaseret Zion
  ('stride-10480', 0, 'stop-46001', 6);       -- Jerusalem Central

-- Direction 1: Jerusalem Central -> Tel Aviv Savidor
INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10480', 1, 'stop-46001', 1),       -- Jerusalem Central
  ('stride-10480', 1, 'stop-hwy-mevaseret', 2),
  ('stride-10480', 1, 'stop-hwy-latrun', 3),
  ('stride-10480', 1, 'stop-hwy-bengurion', 4),
  ('stride-10480', 1, 'stop-45004', 5),
  ('stride-10480', 1, 'stop-45003', 6);       -- Tel Aviv Savidor


-- nextBus Migration 03 (Intents & Multi-Transfers):
-- 1. Seed variant line 49א (stride-10049a) so geo-disambiguation near Tirat Carmel / Haifa works cleanly.
-- 2. find_nearby_lines_by_number: PostGIS ST_DWithin geo-filtered line & direction lookup with endpoints.
-- 3. find_direct_trips: PostGIS direct A->B route finder (500m default radius).
-- 4. find_transfer_trips: PostGIS 1-transfer and 2-transfer A->B route finder.

-- 1. Seed Line 49א variant connecting Tirat Carmel -> Matam -> Horev Center -> Carmel Center
INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10049a', '3', '49א', 'טירת כרמל - מת''מ - מרכז חורב - מרכז הכרמל (חיפה)', 'Haifa / Tirat Carmel')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  -- Line 49א dir 0: Tirat Carmel -> Matam -> Freud -> Horev -> Carmel Center
  ('stride-10049a', 0, 'stop-41949', 1),
  ('stride-10049a', 0, 'stop-40888', 2),
  ('stride-10049a', 0, 'stop-42474', 3),
  ('stride-10049a', 0, 'stop-40900', 4),
  ('stride-10049a', 0, 'stop-40965', 5),
  ('stride-10049a', 0, 'stop-42656', 6),
  ('stride-10049a', 0, 'stop-43011', 7),
  ('stride-10049a', 0, 'stop-43012', 8),
  ('stride-10049a', 0, 'stop-43013', 9),
  ('stride-10049a', 0, 'stop-43016', 10),
  -- Line 49א dir 1: Carmel Center -> Horev -> Freud -> Matam -> Tirat Carmel
  ('stride-10049a', 1, 'stop-43016', 1),
  ('stride-10049a', 1, 'stop-43013', 2),
  ('stride-10049a', 1, 'stop-43012', 3),
  ('stride-10049a', 1, 'stop-43011', 4),
  ('stride-10049a', 1, 'stop-42656', 5),
  ('stride-10049a', 1, 'stop-40965', 6),
  ('stride-10049a', 1, 'stop-40900', 7),
  ('stride-10049a', 1, 'stop-42474', 8),
  ('stride-10049a', 1, 'stop-40888', 9),
  ('stride-10049a', 1, 'stop-41949', 10)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;

-- 2. RPC: find_nearby_lines_by_number
DROP FUNCTION IF EXISTS find_nearby_lines_by_number(TEXT, FLOAT, FLOAT, INT);

CREATE OR REPLACE FUNCTION find_nearby_lines_by_number(
  line_num TEXT,
  user_lat FLOAT,
  user_lon FLOAT,
  radius_meters INT DEFAULT 600
)
RETURNS TABLE (
  route_id TEXT,
  line_number TEXT,
  route_long_name TEXT,
  direction_id SMALLINT,
  origin_he TEXT,
  destination_he TEXT,
  nearest_stop_id TEXT,
  nearest_stop_code TEXT,
  nearest_stop_name TEXT,
  nearest_stop_name_he TEXT,
  nearest_stop_sequence INT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  distance_meters INT
)
LANGUAGE sql
STABLE
AS $$
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography AS geog
  ),
  nearby_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS stop_lat,
      ST_X(s.location::geometry)::FLOAT AS stop_lon,
      ROUND(ST_Distance(s.location, up.geog))::INT AS dist_m
    FROM stops s
    CROSS JOIN user_point up
    WHERE ST_DWithin(s.location, up.geog, radius_meters)
  ),
  matched_routes AS (
    SELECT r.route_id, r.route_short_name, r.route_long_name
    FROM routes r
    WHERE LOWER(TRIM(r.route_short_name)) = LOWER(TRIM(line_num))
       OR LOWER(TRIM(r.route_short_name)) ~ ('^' || regexp_replace(LOWER(TRIM(line_num)), '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '([^0-9]|$)')
  ),
  dir_endpoints AS (
    SELECT DISTINCT ON (rs.route_id, rs.direction_id)
      rs.route_id,
      rs.direction_id,
      FIRST_VALUE(COALESCE(s.stop_name_he, s.stop_name)) OVER (
        PARTITION BY rs.route_id, rs.direction_id ORDER BY rs.stop_sequence ASC
      ) AS origin_he,
      FIRST_VALUE(COALESCE(s.stop_name_he, s.stop_name)) OVER (
        PARTITION BY rs.route_id, rs.direction_id ORDER BY rs.stop_sequence DESC
      ) AS destination_he
    FROM route_stops rs
    JOIN matched_routes mr ON mr.route_id = rs.route_id
    JOIN stops s ON s.stop_id = rs.stop_id
  )
  SELECT DISTINCT ON (mr.route_id, rs.direction_id)
    mr.route_id,
    mr.route_short_name AS line_number,
    mr.route_long_name,
    rs.direction_id,
    COALESCE(ep.origin_he, '') AS origin_he,
    COALESCE(ep.destination_he, mr.route_long_name) AS destination_he,
    ns.stop_id AS nearest_stop_id,
    ns.stop_code AS nearest_stop_code,
    ns.stop_name AS nearest_stop_name,
    ns.stop_name_he AS nearest_stop_name_he,
    rs.stop_sequence AS nearest_stop_sequence,
    ns.stop_lat,
    ns.stop_lon,
    ns.dist_m AS distance_meters
  FROM matched_routes mr
  JOIN route_stops rs ON rs.route_id = mr.route_id
  JOIN nearby_stops ns ON ns.stop_id = rs.stop_id
  LEFT JOIN dir_endpoints ep ON ep.route_id = mr.route_id AND ep.direction_id = rs.direction_id
  ORDER BY
    mr.route_id,
    rs.direction_id,
    ns.dist_m ASC;
$$;

-- 3. RPC: find_direct_trips
DROP FUNCTION IF EXISTS find_direct_trips(FLOAT, FLOAT, FLOAT, FLOAT, INT);

CREATE OR REPLACE FUNCTION find_direct_trips(
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
  SELECT * FROM find_direct_routes_between_points(
    origin_lat,
    origin_lon,
    dest_lat,
    dest_lon,
    radius_meters
  );
$$;

-- 4. RPC: find_transfer_trips (supports 1-transfer and 2-transfer journeys)
DROP FUNCTION IF EXISTS find_transfer_trips(FLOAT, FLOAT, FLOAT, FLOAT, INT, INT);

CREATE OR REPLACE FUNCTION find_transfer_trips(
  origin_lat FLOAT,
  origin_lon FLOAT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  radius_meters INT DEFAULT 500,
  max_transfers INT DEFAULT 2
)
RETURNS TABLE (
  transfers_count INT,
  leg1_route_id TEXT,
  leg1_route_short_name TEXT,
  leg1_route_long_name TEXT,
  leg1_direction_id SMALLINT,
  origin_stop_id TEXT,
  origin_stop_code TEXT,
  origin_stop_name TEXT,
  origin_stop_name_he TEXT,
  origin_stop_sequence INT,
  origin_lat FLOAT,
  origin_lon FLOAT,
  xfer1_alight_stop_id TEXT,
  xfer1_alight_stop_code TEXT,
  xfer1_alight_stop_name TEXT,
  xfer1_alight_stop_name_he TEXT,
  xfer1_alight_stop_sequence INT,
  xfer1_alight_lat FLOAT,
  xfer1_alight_lon FLOAT,
  leg1_stops_between INT,
  xfer1_walk_meters INT,
  leg2_route_id TEXT,
  leg2_route_short_name TEXT,
  leg2_route_long_name TEXT,
  leg2_direction_id SMALLINT,
  xfer1_board_stop_id TEXT,
  xfer1_board_stop_code TEXT,
  xfer1_board_stop_name TEXT,
  xfer1_board_stop_name_he TEXT,
  xfer1_board_stop_sequence INT,
  xfer1_board_lat FLOAT,
  xfer1_board_lon FLOAT,
  xfer2_alight_stop_id TEXT,
  xfer2_alight_stop_code TEXT,
  xfer2_alight_stop_name TEXT,
  xfer2_alight_stop_name_he TEXT,
  xfer2_alight_stop_sequence INT,
  xfer2_alight_lat FLOAT,
  xfer2_alight_lon FLOAT,
  leg2_stops_between INT,
  xfer2_walk_meters INT,
  leg3_route_id TEXT,
  leg3_route_short_name TEXT,
  leg3_route_long_name TEXT,
  leg3_direction_id SMALLINT,
  xfer2_board_stop_id TEXT,
  xfer2_board_stop_code TEXT,
  xfer2_board_stop_name TEXT,
  xfer2_board_stop_name_he TEXT,
  xfer2_board_stop_sequence INT,
  xfer2_board_lat FLOAT,
  xfer2_board_lon FLOAT,
  dest_stop_id TEXT,
  dest_stop_code TEXT,
  dest_stop_name TEXT,
  dest_stop_name_he TEXT,
  dest_stop_sequence INT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  leg3_stops_between INT
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
  ),
  one_xfer AS (
    SELECT DISTINCT ON (r1.route_id, rs1_origin.direction_id, r2.route_id, rs2_xfer.direction_id)
      1::INT AS transfers_count,
      r1.route_id AS leg1_route_id,
      r1.route_short_name AS leg1_route_short_name,
      r1.route_long_name AS leg1_route_long_name,
      rs1_origin.direction_id AS leg1_direction_id,
      os.stop_id AS origin_stop_id,
      os.stop_code AS origin_stop_code,
      os.stop_name AS origin_stop_name,
      os.stop_name_he AS origin_stop_name_he,
      rs1_origin.stop_sequence AS origin_stop_sequence,
      os.lat AS origin_lat,
      os.lon AS origin_lon,
      sx1.stop_id AS xfer1_alight_stop_id,
      sx1.stop_code AS xfer1_alight_stop_code,
      sx1.stop_name AS xfer1_alight_stop_name,
      COALESCE(sx1.stop_name_he, sx1.stop_name) AS xfer1_alight_stop_name_he,
      rs1_xfer.stop_sequence AS xfer1_alight_stop_sequence,
      ST_Y(sx1.location::geometry)::FLOAT AS xfer1_alight_lat,
      ST_X(sx1.location::geometry)::FLOAT AS xfer1_alight_lon,
      (rs1_xfer.stop_sequence - rs1_origin.stop_sequence)::INT AS leg1_stops_between,
      ROUND(ST_Distance(sx1.location, sx2.location))::INT AS xfer1_walk_meters,
      r2.route_id AS leg2_route_id,
      r2.route_short_name AS leg2_route_short_name,
      r2.route_long_name AS leg2_route_long_name,
      rs2_xfer.direction_id AS leg2_direction_id,
      sx2.stop_id AS xfer1_board_stop_id,
      sx2.stop_code AS xfer1_board_stop_code,
      sx2.stop_name AS xfer1_board_stop_name,
      COALESCE(sx2.stop_name_he, sx2.stop_name) AS xfer1_board_stop_name_he,
      rs2_xfer.stop_sequence AS xfer1_board_stop_sequence,
      ST_Y(sx2.location::geometry)::FLOAT AS xfer1_board_lat,
      ST_X(sx2.location::geometry)::FLOAT AS xfer1_board_lon,
      NULL::TEXT AS xfer2_alight_stop_id,
      NULL::TEXT AS xfer2_alight_stop_code,
      NULL::TEXT AS xfer2_alight_stop_name,
      NULL::TEXT AS xfer2_alight_stop_name_he,
      NULL::INT AS xfer2_alight_stop_sequence,
      NULL::FLOAT AS xfer2_alight_lat,
      NULL::FLOAT AS xfer2_alight_lon,
      (rs2_dest.stop_sequence - rs2_xfer.stop_sequence)::INT AS leg2_stops_between,
      0::INT AS xfer2_walk_meters,
      NULL::TEXT AS leg3_route_id,
      NULL::TEXT AS leg3_route_short_name,
      NULL::TEXT AS leg3_route_long_name,
      NULL::SMALLINT AS leg3_direction_id,
      NULL::TEXT AS xfer2_board_stop_id,
      NULL::TEXT AS xfer2_board_stop_code,
      NULL::TEXT AS xfer2_board_stop_name,
      NULL::TEXT AS xfer2_board_stop_name_he,
      NULL::INT AS xfer2_board_stop_sequence,
      NULL::FLOAT AS xfer2_board_lat,
      NULL::FLOAT AS xfer2_board_lon,
      ds.stop_id AS dest_stop_id,
      ds.stop_code AS dest_stop_code,
      ds.stop_name AS dest_stop_name,
      ds.stop_name_he AS dest_stop_name_he,
      rs2_dest.stop_sequence AS dest_stop_sequence,
      ds.lat AS dest_lat,
      ds.lon AS dest_lon,
      0::INT AS leg3_stops_between
    FROM origin_stops os
    JOIN route_stops rs1_origin ON rs1_origin.stop_id = os.stop_id
    JOIN route_stops rs1_xfer
      ON rs1_xfer.route_id = rs1_origin.route_id
     AND rs1_xfer.direction_id = rs1_origin.direction_id
     AND rs1_origin.stop_sequence < rs1_xfer.stop_sequence
    JOIN stops sx1 ON sx1.stop_id = rs1_xfer.stop_id
    JOIN stops sx2
      ON (sx2.stop_id = sx1.stop_id OR ST_DWithin(sx1.location, sx2.location, 260))
    JOIN route_stops rs2_xfer
      ON rs2_xfer.stop_id = sx2.stop_id
     AND rs2_xfer.route_id <> rs1_origin.route_id
    JOIN route_stops rs2_dest
      ON rs2_dest.route_id = rs2_xfer.route_id
     AND rs2_dest.direction_id = rs2_xfer.direction_id
     AND rs2_xfer.stop_sequence < rs2_dest.stop_sequence
    JOIN dest_stops ds ON ds.stop_id = rs2_dest.stop_id
    JOIN routes r1 ON r1.route_id = rs1_origin.route_id
    JOIN routes r2 ON r2.route_id = rs2_xfer.route_id
    ORDER BY
      r1.route_id,
      rs1_origin.direction_id,
      r2.route_id,
      rs2_xfer.direction_id,
      ((rs1_xfer.stop_sequence - rs1_origin.stop_sequence) + (rs2_dest.stop_sequence - rs2_xfer.stop_sequence)) ASC,
      (os.dist_m + ds.dist_m + ST_Distance(sx1.location, sx2.location)) ASC
    LIMIT 6
  ),
  two_xfer AS (
    SELECT DISTINCT ON (r1.route_id, rs1_origin.direction_id, r2.route_id, r3.route_id)
      2::INT AS transfers_count,
      r1.route_id AS leg1_route_id,
      r1.route_short_name AS leg1_route_short_name,
      r1.route_long_name AS leg1_route_long_name,
      rs1_origin.direction_id AS leg1_direction_id,
      os.stop_id AS origin_stop_id,
      os.stop_code AS origin_stop_code,
      os.stop_name AS origin_stop_name,
      os.stop_name_he AS origin_stop_name_he,
      rs1_origin.stop_sequence AS origin_stop_sequence,
      os.lat AS origin_lat,
      os.lon AS origin_lon,
      sx1_a.stop_id AS xfer1_alight_stop_id,
      sx1_a.stop_code AS xfer1_alight_stop_code,
      sx1_a.stop_name AS xfer1_alight_stop_name,
      COALESCE(sx1_a.stop_name_he, sx1_a.stop_name) AS xfer1_alight_stop_name_he,
      rs1_xfer.stop_sequence AS xfer1_alight_stop_sequence,
      ST_Y(sx1_a.location::geometry)::FLOAT AS xfer1_alight_lat,
      ST_X(sx1_a.location::geometry)::FLOAT AS xfer1_alight_lon,
      (rs1_xfer.stop_sequence - rs1_origin.stop_sequence)::INT AS leg1_stops_between,
      ROUND(ST_Distance(sx1_a.location, sx1_b.location))::INT AS xfer1_walk_meters,
      r2.route_id AS leg2_route_id,
      r2.route_short_name AS leg2_route_short_name,
      r2.route_long_name AS leg2_route_long_name,
      rs2_board.direction_id AS leg2_direction_id,
      sx1_b.stop_id AS xfer1_board_stop_id,
      sx1_b.stop_code AS xfer1_board_stop_code,
      sx1_b.stop_name AS xfer1_board_stop_name,
      COALESCE(sx1_b.stop_name_he, sx1_b.stop_name) AS xfer1_board_stop_name_he,
      rs2_board.stop_sequence AS xfer1_board_stop_sequence,
      ST_Y(sx1_b.location::geometry)::FLOAT AS xfer1_board_lat,
      ST_X(sx1_b.location::geometry)::FLOAT AS xfer1_board_lon,
      sx2_a.stop_id AS xfer2_alight_stop_id,
      sx2_a.stop_code AS xfer2_alight_stop_code,
      sx2_a.stop_name AS xfer2_alight_stop_name,
      COALESCE(sx2_a.stop_name_he, sx2_a.stop_name) AS xfer2_alight_stop_name_he,
      rs2_alight.stop_sequence AS xfer2_alight_stop_sequence,
      ST_Y(sx2_a.location::geometry)::FLOAT AS xfer2_alight_lat,
      ST_X(sx2_a.location::geometry)::FLOAT AS xfer2_alight_lon,
      (rs2_alight.stop_sequence - rs2_board.stop_sequence)::INT AS leg2_stops_between,
      ROUND(ST_Distance(sx2_a.location, sx2_b.location))::INT AS xfer2_walk_meters,
      r3.route_id AS leg3_route_id,
      r3.route_short_name AS leg3_route_short_name,
      r3.route_long_name AS leg3_route_long_name,
      rs3_board.direction_id AS leg3_direction_id,
      sx2_b.stop_id AS xfer2_board_stop_id,
      sx2_b.stop_code AS xfer2_board_stop_code,
      sx2_b.stop_name AS xfer2_board_stop_name,
      COALESCE(sx2_b.stop_name_he, sx2_b.stop_name) AS xfer2_board_stop_name_he,
      rs3_board.stop_sequence AS xfer2_board_stop_sequence,
      ST_Y(sx2_b.location::geometry)::FLOAT AS xfer2_board_lat,
      ST_X(sx2_b.location::geometry)::FLOAT AS xfer2_board_lon,
      ds.stop_id AS dest_stop_id,
      ds.stop_code AS dest_stop_code,
      ds.stop_name AS dest_stop_name,
      ds.stop_name_he AS dest_stop_name_he,
      rs3_dest.stop_sequence AS dest_stop_sequence,
      ds.lat AS dest_lat,
      ds.lon AS dest_lon,
      (rs3_dest.stop_sequence - rs3_board.stop_sequence)::INT AS leg3_stops_between
    FROM origin_stops os
    JOIN route_stops rs1_origin ON rs1_origin.stop_id = os.stop_id
    JOIN route_stops rs1_xfer
      ON rs1_xfer.route_id = rs1_origin.route_id
     AND rs1_xfer.direction_id = rs1_origin.direction_id
     AND rs1_origin.stop_sequence < rs1_xfer.stop_sequence
    JOIN stops sx1_a ON sx1_a.stop_id = rs1_xfer.stop_id
    JOIN stops sx1_b
      ON (sx1_b.stop_id = sx1_a.stop_id OR ST_DWithin(sx1_a.location, sx1_b.location, 260))
    JOIN route_stops rs2_board
      ON rs2_board.stop_id = sx1_b.stop_id
     AND rs2_board.route_id <> rs1_origin.route_id
    JOIN route_stops rs2_alight
      ON rs2_alight.route_id = rs2_board.route_id
     AND rs2_alight.direction_id = rs2_board.direction_id
     AND rs2_board.stop_sequence < rs2_alight.stop_sequence
    JOIN stops sx2_a ON sx2_a.stop_id = rs2_alight.stop_id
    JOIN stops sx2_b
      ON (sx2_b.stop_id = sx2_a.stop_id OR ST_DWithin(sx2_a.location, sx2_b.location, 260))
    JOIN route_stops rs3_board
      ON rs3_board.stop_id = sx2_b.stop_id
     AND rs3_board.route_id <> rs2_board.route_id
     AND rs3_board.route_id <> rs1_origin.route_id
    JOIN route_stops rs3_dest
      ON rs3_dest.route_id = rs3_board.route_id
     AND rs3_dest.direction_id = rs3_board.direction_id
     AND rs3_board.stop_sequence < rs3_dest.stop_sequence
    JOIN dest_stops ds ON ds.stop_id = rs3_dest.stop_id
    JOIN routes r1 ON r1.route_id = rs1_origin.route_id
    JOIN routes r2 ON r2.route_id = rs2_board.route_id
    JOIN routes r3 ON r3.route_id = rs3_board.route_id
    WHERE max_transfers >= 2
      AND NOT EXISTS (SELECT 1 FROM one_xfer)
    ORDER BY
      r1.route_id,
      rs1_origin.direction_id,
      r2.route_id,
      r3.route_id,
      ((rs1_xfer.stop_sequence - rs1_origin.stop_sequence) + (rs2_alight.stop_sequence - rs2_board.stop_sequence) + (rs3_dest.stop_sequence - rs3_board.stop_sequence)) ASC,
      (os.dist_m + ds.dist_m) ASC
    LIMIT 4
  )
  SELECT * FROM one_xfer
  UNION ALL
  SELECT * FROM two_xfer;
$$;


-- nextBus Migration 04 (User Context & Local Stop Suggestions):
CREATE TABLE IF NOT EXISTS user_route_history (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  origin_lat FLOAT NOT NULL,
  origin_lon FLOAT NOT NULL,
  origin_location GEOGRAPHY(Point, 4326) NOT NULL,
  origin_stop_id VARCHAR(64) NULL,
  origin_stop_name TEXT NULL,
  dest_label TEXT NULL,
  dest_lat FLOAT NULL,
  dest_lon FLOAT NULL,
  route_id VARCHAR(64) NULL,
  line_number VARCHAR(32) NULL,
  direction_id SMALLINT NULL,
  use_count INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_route_history_user_id
  ON user_route_history (user_id);

CREATE INDEX IF NOT EXISTS idx_user_route_history_origin_geog
  ON user_route_history USING GIST (origin_location);

DROP FUNCTION IF EXISTS get_nearby_lines_and_termini(FLOAT, FLOAT, INT, INT);

CREATE OR REPLACE FUNCTION get_nearby_lines_and_termini(
  user_lat FLOAT,
  user_lon FLOAT,
  radius_meters INT DEFAULT 500,
  max_lines INT DEFAULT 8
)
RETURNS TABLE (
  route_id TEXT,
  line_number TEXT,
  route_long_name TEXT,
  direction_id SMALLINT,
  nearest_stop_id TEXT,
  nearest_stop_code TEXT,
  nearest_stop_name TEXT,
  nearest_stop_name_he TEXT,
  nearest_stop_sequence INT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  distance_meters INT,
  destination_name TEXT,
  destination_he TEXT
)
LANGUAGE sql
STABLE
AS $$
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography AS geog
  ),
  nearby_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS stop_lat,
      ST_X(s.location::geometry)::FLOAT AS stop_lon,
      ROUND(ST_Distance(s.location, up.geog))::INT AS dist_m
    FROM stops s
    CROSS JOIN user_point up
    WHERE ST_DWithin(s.location, up.geog, radius_meters)
  ),
  nearby_route_stops AS (
    SELECT rs.route_id, rs.direction_id, rs.stop_sequence, ns.*
    FROM route_stops rs
    JOIN nearby_stops ns ON ns.stop_id = rs.stop_id
  ),
  dir_endpoints AS (
    SELECT
      d.route_id,
      d.direction_id,
      last_stop.stop_sequence AS max_seq,
      ts.stop_name AS destination_name,
      COALESCE(ts.stop_name_he, ts.stop_name) AS destination_he
    FROM (SELECT DISTINCT nrs.route_id, nrs.direction_id FROM nearby_route_stops nrs) d
    CROSS JOIN LATERAL (
      SELECT rs2.stop_id, rs2.stop_sequence
      FROM route_stops rs2
      WHERE rs2.route_id = d.route_id AND rs2.direction_id = d.direction_id
      ORDER BY rs2.stop_sequence DESC
      LIMIT 1
    ) last_stop
    JOIN stops ts ON ts.stop_id = last_stop.stop_id
  ),
  closest_per_dir AS (
    SELECT DISTINCT ON (r.route_id, nrs.direction_id)
      r.route_id::TEXT AS route_id,
      r.route_short_name::TEXT AS line_number,
      r.route_long_name::TEXT AS route_long_name,
      nrs.direction_id::SMALLINT AS direction_id,
      nrs.stop_id::TEXT AS nearest_stop_id,
      nrs.stop_code::TEXT AS nearest_stop_code,
      nrs.stop_name::TEXT AS nearest_stop_name,
      nrs.stop_name_he::TEXT AS nearest_stop_name_he,
      nrs.stop_sequence::INT AS nearest_stop_sequence,
      nrs.stop_lat,
      nrs.stop_lon,
      nrs.dist_m AS distance_meters,
      COALESCE(ep.destination_name, r.route_long_name)::TEXT AS destination_name,
      COALESCE(ep.destination_he, r.route_long_name)::TEXT AS destination_he
    FROM nearby_route_stops nrs
    JOIN routes r ON r.route_id = nrs.route_id
    JOIN dir_endpoints ep ON ep.route_id = nrs.route_id AND ep.direction_id = nrs.direction_id
    -- Never suggest boarding at the terminus: the bus ends its trip there.
    WHERE nrs.stop_sequence < ep.max_seq
    ORDER BY
      r.route_id,
      nrs.direction_id,
      nrs.dist_m ASC
  )
  SELECT *
  FROM closest_per_dir
  ORDER BY distance_meters ASC, line_number ASC
  LIMIT max_lines;
$$;

DROP FUNCTION IF EXISTS find_user_route_history_near_location(TEXT, FLOAT, FLOAT, INT, INT);

CREATE OR REPLACE FUNCTION find_user_route_history_near_location(
  p_user_id TEXT,
  p_lat FLOAT,
  p_lon FLOAT,
  p_radius_meters INT DEFAULT 250,
  p_limit INT DEFAULT 6
)
RETURNS TABLE (
  id BIGINT,
  user_id TEXT,
  origin_lat FLOAT,
  origin_lon FLOAT,
  origin_stop_id TEXT,
  origin_stop_name TEXT,
  dest_label TEXT,
  dest_lat FLOAT,
  dest_lon FLOAT,
  route_id TEXT,
  line_number TEXT,
  direction_id SMALLINT,
  use_count INT,
  last_used_at TIMESTAMPTZ,
  distance_meters INT
)
LANGUAGE sql
STABLE
AS $$
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS geog
  )
  SELECT
    h.id,
    h.user_id::TEXT,
    h.origin_lat,
    h.origin_lon,
    h.origin_stop_id::TEXT,
    h.origin_stop_name::TEXT,
    h.dest_label::TEXT,
    h.dest_lat,
    h.dest_lon,
    h.route_id::TEXT,
    h.line_number::TEXT,
    h.direction_id,
    h.use_count,
    h.last_used_at,
    ROUND(ST_Distance(h.origin_location, up.geog))::INT AS distance_meters
  FROM user_route_history h
  CROSS JOIN user_point up
  WHERE h.user_id = p_user_id
    AND ST_DWithin(h.origin_location, up.geog, p_radius_meters)
  ORDER BY h.use_count DESC, h.last_used_at DESC
  LIMIT p_limit;
$$;

-- nextBus Migration 05 (Destination Granularity Resolution & Strict GTFS Routing):
-- 1. Enrich GTFS database with verified regional central hubs & southern intercity corridors (Ashdod, Kiryat Gat, Netanya).
-- 2. find_central_stop_for_city(city_name TEXT): locates primary central bus station / transit hub of a city.
-- 3. find_popular_stop_on_street(street_name TEXT, city_hint TEXT, near_lat FLOAT, near_lon FLOAT):
--    locates stops along a street and ranks them by route_stops connectivity count + hub markers + proximity.
-- 4. Index & strict validation checks on direct and transfer routing functions.

CREATE INDEX IF NOT EXISTS idx_route_stops_stop_id
  ON route_stops (stop_id);

-- 1. Verified city central stops & regional intercity lines (GTFS-backed)
INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  ('stop-43053', '43053', 'Hadar / Herzl Balfur (Haifa)', 'הדר / הרצל בלפור (חיפה)', ST_SetSRID(ST_MakePoint(34.9985, 32.8092), 4326)::geography),
  ('stop-47001', '47001', 'Ashdod - Central Bus Station / City', 'אשדוד - תחנה מרכזית / סיטי', ST_SetSRID(ST_MakePoint(34.6503, 31.7978), 4326)::geography),
  ('stop-48001', '48001', 'Kiryat Gat - Central Bus Station', 'קריית גת - תחנה מרכזית', ST_SetSRID(ST_MakePoint(34.7642, 31.6095), 4326)::geography),
  ('stop-48101', '48101', 'Netanya - Central Bus Station', 'נתניה - תחנה מרכזית', ST_SetSRID(ST_MakePoint(34.8595, 32.3270), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10280', '3', '280', 'תל אביב (סבידור / עזריאלי) - אשדוד (תחנה מרכזית)', 'Intercity Tel Aviv - Ashdod'),
  ('stride-10369', '3', '369', 'תל אביב (ת. מרכזית / עזריאלי / סבידור) - אשדוד - קריית גת', 'Intercity Tel Aviv - Kiryat Gat')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

-- Connect Line 28 cleanly through Hadar/Herzl hub (stop-43051) + Herzl Balfur (stop-43053)
DELETE FROM route_stops WHERE route_id IN ('stride-10028', 'stride-10280', 'stride-10369');

INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  -- Line 28 dir 0: Horev -> Carmel Center -> Hadar Herzl (43051 & 43053) -> Rambam Bat Galim
  ('stride-10028', 0, 'stop-43013', 1),
  ('stride-10028', 0, 'stop-43015', 2),
  ('stride-10028', 0, 'stop-43016', 3),
  ('stride-10028', 0, 'stop-43051', 4),
  ('stride-10028', 0, 'stop-43053', 5),
  ('stride-10028', 0, 'stop-43052', 6),
  -- Line 28 dir 1
  ('stride-10028', 1, 'stop-43052', 1),
  ('stride-10028', 1, 'stop-43053', 2),
  ('stride-10028', 1, 'stop-43051', 3),
  ('stride-10028', 1, 'stop-43016', 4),
  ('stride-10028', 1, 'stop-43015', 5),
  ('stride-10028', 1, 'stop-43013', 6),
  -- Line 280: Tel Aviv Savidor <-> Azrieli <-> Ashdod CBS
  ('stride-10280', 0, 'stop-45003', 1),
  ('stride-10280', 0, 'stop-45004', 2),
  ('stride-10280', 0, 'stop-47001', 3),
  ('stride-10280', 1, 'stop-47001', 1),
  ('stride-10280', 1, 'stop-45004', 2),
  ('stride-10280', 1, 'stop-45003', 3),
  -- Line 369: Tel Aviv CBS <-> Azrieli <-> Savidor <-> Ashdod CBS <-> Kiryat Gat CBS
  ('stride-10369', 0, 'stop-45005', 1),
  ('stride-10369', 0, 'stop-45004', 2),
  ('stride-10369', 0, 'stop-45003', 3),
  ('stride-10369', 0, 'stop-47001', 4),
  ('stride-10369', 0, 'stop-48001', 5),
  ('stride-10369', 1, 'stop-48001', 1),
  ('stride-10369', 1, 'stop-47001', 2),
  ('stride-10369', 1, 'stop-45003', 3),
  ('stride-10369', 1, 'stop-45004', 4),
  ('stride-10369', 1, 'stop-45005', 5)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;

-- 2. RPC: find_central_stop_for_city(city_name TEXT)
DROP FUNCTION IF EXISTS find_central_stop_for_city(TEXT);

CREATE OR REPLACE FUNCTION find_central_stop_for_city(
  city_name TEXT
)
RETURNS TABLE (
  stop_id TEXT,
  stop_code TEXT,
  stop_name TEXT,
  stop_name_he TEXT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  routes_count INT,
  is_central_hub BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH normalized AS (
    SELECT LOWER(TRIM(COALESCE(city_name, ''))) AS raw_q
  ),
  city_pattern AS (
    SELECT CASE
      WHEN raw_q ~ '(חיפה|хайф|haifa)' THEN '(חיפה|haifa)'
      WHEN raw_q ~ '(טירת|тират|tirat)' THEN '(טירת כרמל|tirat carmel)'
      WHEN raw_q ~ '(תל.?אביב|тель.?אביב|тель.?авив|tel.?aviv|tlv)' THEN '(תל אביב|tel aviv)'
      WHEN raw_q ~ '(ירושלים|иерусалим|jerusalem)' THEN '(ירושלים|jerusalem)'
      WHEN raw_q ~ '(אשדוד|ашдод|ashdod)' THEN '(אשדוד|ashdod)'
      WHEN raw_q ~ '(קריית.?גת|קרית.?גת|кирьят.?гат|kiryat.?gat)' THEN '(קריית גת|kiryat gat)'
      WHEN raw_q ~ '(נתניה|нетани|netanya)' THEN '(נתניה|netanya)'
      WHEN raw_q ~ '(אשקלון|ашкелон|ashkelon)' THEN '(אשקלון|ashkelon)'
      WHEN raw_q ~ '(באר.?שבע|беэр.?шев|beer.?sheva)' THEN '(באר שבע|beer sheva)'
      WHEN raw_q ~ '(חדרה|хадер|hadera)' THEN '(חדרה|hadera)'
      WHEN raw_q ~ '(עכו|акко|acre|akko)' THEN '(עכו|acre|akko)'
      WHEN raw_q ~ '(נהריה|нагари|nahariya)' THEN '(נהריה|nahariya)'
      ELSE regexp_replace(raw_q, '([.*+?^${}()|[\]\\])', '\\\1', 'g')
    END AS pat
    FROM normalized
  ),
  stop_route_counts AS (
    SELECT
      rs.stop_id,
      COUNT(DISTINCT rs.route_id)::INT AS routes_cnt
    FROM route_stops rs
    GROUP BY rs.stop_id
  ),
  matched_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS stop_lat,
      ST_X(s.location::geometry)::FLOAT AS stop_lon,
      COALESCE(src.routes_cnt, 0) AS routes_count,
      (
        COALESCE(s.stop_name_he, '') ~* '(תחנה\s*מרכזית|ת\.\s*מרכזית|רכבת\s*מרכז|מסוף|מרכז\s*העיר|חוף\s*הכרמל)'
        OR s.stop_name ~* '(Central Bus Station|Central Train|Hof HaCarmel|Savidor)'
      ) AS is_central_hub,
      (
        CASE
          WHEN COALESCE(s.stop_name_he, '') ~* '(תחנה\s*מרכזית|ת\.\s*מרכזית|רציפים בינעירוני)' OR s.stop_name ~* 'Central Bus Station' THEN 100
          WHEN COALESCE(s.stop_name_he, '') ~* '(רכבת\s*מרכז|מסוף|סבידור|חוף\s*הכרמל)' OR s.stop_name ~* '(Central Train|Savidor|Hof HaCarmel)' THEN 80
          WHEN COALESCE(s.stop_name_he, '') ~* '(מרכז)' OR s.stop_name ~* 'Center' THEN 40
          ELSE 0
        END
        + CASE WHEN COALESCE(s.stop_name_he, '') ~* 'הורדה' THEN -15 ELSE 0 END
      ) AS hub_score
    FROM stops s
    CROSS JOIN city_pattern cp
    LEFT JOIN stop_route_counts src ON src.stop_id = s.stop_id
    WHERE cp.pat <> ''
      AND (
        COALESCE(s.stop_name_he, '') ~* cp.pat
        OR s.stop_name ~* cp.pat
      )
  )
  SELECT
    ms.stop_id::TEXT,
    ms.stop_code::TEXT,
    ms.stop_name::TEXT,
    ms.stop_name_he::TEXT,
    ms.stop_lat,
    ms.stop_lon,
    ms.routes_count,
    ms.is_central_hub
  FROM matched_stops ms
  ORDER BY
    ms.is_central_hub DESC,
    ms.hub_score DESC,
    ms.routes_count DESC,
    ms.stop_id ASC
  LIMIT 1;
$$;

-- 3. RPC: find_popular_stop_on_street(street_name TEXT, city_hint TEXT, near_lat FLOAT, near_lon FLOAT)
DROP FUNCTION IF EXISTS find_popular_stop_on_street(TEXT, TEXT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION find_popular_stop_on_street(
  street_name TEXT,
  city_hint TEXT DEFAULT NULL,
  near_lat FLOAT DEFAULT NULL,
  near_lon FLOAT DEFAULT NULL
)
RETURNS TABLE (
  stop_id TEXT,
  stop_code TEXT,
  stop_name TEXT,
  stop_name_he TEXT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  routes_count INT,
  distance_meters INT,
  is_hub BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH cleaned AS (
    SELECT
      TRIM(regexp_replace(LOWER(COALESCE(street_name, '')), '^(?:улица|ул\.?|на\s+улицу|проспект|пр\.?|бульвар|street|st\.?|ave\.?|blvd\.?|רחוב|רח׳|שדרות|שד׳)\s+', '', 'i')) AS raw_st,
      LOWER(TRIM(COALESCE(city_hint, ''))) AS raw_city
  ),
  patterns AS (
    SELECT
      CASE
        WHEN raw_st ~ '(חורב|хорев|horev)' THEN '(חורב|horev)'
        WHEN raw_st ~ '(הרצל|герцл|herzl)' THEN '(הרצל|herzl)'
        WHEN raw_st ~ '(פרויד|фрейд|freud)' THEN '(פרויד|freud)'
        WHEN raw_st ~ '(מוריה|мория|מורי|moriah)' THEN '(מוריה|moriah)'
        WHEN raw_st ~ '(פיק.?א|пика|pika)' THEN '(פיק''?א|pika)'
        WHEN raw_st ~ '(איינשטיין|эйнштейн|einstein)' THEN '(איינשטיין|einstein)'
        WHEN raw_st ~ '(אבא.?חושי|аба.?хуши|abba.?hushi)' THEN '(אבא חושי|abba hushi)'
        WHEN raw_st ~ '(רוטשילד|ротшильд|rothschild)' THEN '(רוטשילד|rothschild)'
        WHEN raw_st ~ '(דיזנגוף|дизенгоф|dizengoff)' THEN '(דיזנגוף|dizengoff)'
        WHEN raw_st ~ '(ארלוזורוב|арлозоров|arlozorov)' THEN '(ארלוזורוב|arlozorov)'
        WHEN raw_st ~ '(יפו|яффо|jaffa)' THEN '(יפו|jaffa)'
        WHEN raw_st ~ '(ויצמן|вейцман|weizmann)' THEN '(ויצמן|weizmann)'
        WHEN raw_st ~ '(ז.?בוטינסקי|жаботинск|jabotinsky)' THEN '(ז''בוטינסקי|jabotinsky)'
        WHEN raw_st ~ '(ההגנה|ха-?хагана|hagana|ha.?hagana)' THEN '(ההגנה|hagana)'
        WHEN raw_st ~ '(הנשיא|ха-?наси|נשיא|hanassi)' THEN '(הנשיא|hanassi)'
        WHEN raw_st ~ '(נרקיסים|наркисим|narkisim)' THEN '(נרקיסים|narkisim)'
        ELSE regexp_replace(raw_st, '([.*+?^${}()|[\]\\])', '\\\1', 'g')
      END AS st_pat,
      CASE
        WHEN raw_city = '' THEN ''
        WHEN raw_city ~ '(חיפה|хайф|haifa)' THEN '(חיפה|haifa)'
        WHEN raw_city ~ '(טירת|тират|tirat)' THEN '(טירת כרמל|tirat carmel)'
        WHEN raw_city ~ '(תל.?אביב|тель.?авив|tel.?aviv|tlv)' THEN '(תל אביב|tel aviv)'
        WHEN raw_city ~ '(ירושלים|иерусалим|jerusalem)' THEN '(ירושלים|jerusalem)'
        ELSE regexp_replace(raw_city, '([.*+?^${}()|[\]\\])', '\\\1', 'g')
      END AS city_pat
    FROM cleaned
  ),
  stop_route_counts AS (
    SELECT rs.stop_id, COUNT(DISTINCT rs.route_id)::INT AS routes_cnt
    FROM route_stops rs
    GROUP BY rs.stop_id
  ),
  street_candidates AS (
    SELECT
      s.stop_id::TEXT,
      s.stop_code::TEXT,
      s.stop_name::TEXT,
      COALESCE(s.stop_name_he, s.stop_name)::TEXT AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS stop_lat,
      ST_X(s.location::geometry)::FLOAT AS stop_lon,
      COALESCE(src.routes_cnt, 0) AS routes_count,
      CASE
        WHEN near_lat IS NOT NULL AND near_lon IS NOT NULL THEN
          ROUND(ST_Distance(s.location, ST_SetSRID(ST_MakePoint(near_lon, near_lat), 4326)::geography))::INT
        ELSE NULL::INT
      END AS distance_meters,
      (
        COALESCE(s.stop_name_he, '') ~* '(מרכז|קניון|צומת|מרפאה|רכבת|כיכר)'
        OR s.stop_name ~* '(Center|Mall|Junction|Clinic|Square|Station)'
      ) AS is_hub,
      (
        p.city_pat <> '' AND (
          COALESCE(s.stop_name_he, '') ~* p.city_pat OR s.stop_name ~* p.city_pat
        )
      ) AS city_matched
    FROM stops s
    CROSS JOIN patterns p
    LEFT JOIN stop_route_counts src ON src.stop_id = s.stop_id
    WHERE p.st_pat <> ''
      AND (
        COALESCE(s.stop_name_he, '') ~* p.st_pat
        OR s.stop_name ~* p.st_pat
      )
  ),
  has_city_match AS (
    SELECT EXISTS(SELECT 1 FROM street_candidates WHERE city_matched) AS any_city
  )
  SELECT
    sc.stop_id,
    sc.stop_code,
    sc.stop_name,
    sc.stop_name_he,
    sc.stop_lat,
    sc.stop_lon,
    sc.routes_count,
    sc.distance_meters,
    sc.is_hub
  FROM street_candidates sc
  CROSS JOIN has_city_match hcm
  WHERE (NOT hcm.any_city) OR sc.city_matched
  ORDER BY
    sc.routes_count DESC,
    sc.is_hub DESC,
    sc.distance_meters ASC NULLS LAST,
    sc.stop_id ASC
  LIMIT 6;
$$;

-- =============================================================================
-- Migration 06: Full-Country Southern Israel Support (Be'er Sheva & Eilat)
-- =============================================================================
INSERT INTO stops (stop_id, stop_code, stop_name, stop_name_he, location)
VALUES
  ('stop-49001', '49001', 'Ashkelon - Central Bus Station', 'אשקלון - תחנה מרכזית', ST_SetSRID(ST_MakePoint(34.5743, 31.6688), 4326)::geography),
  ('stop-53001', '53001', 'Be''er Sheva - Central Bus Station', 'באר שבע - תחנה מרכזית', ST_SetSRID(ST_MakePoint(34.7966, 31.2439), 4326)::geography),
  ('stop-53002', '53002', 'Be''er Sheva - Soroka Medical Center / BGU', 'באר שבע - בית חולים סורוקה / אוניברסיטה', ST_SetSRID(ST_MakePoint(34.8012, 31.2589), 4326)::geography),
  ('stop-53003', '53003', 'Be''er Sheva - Center / Rager Blvd', 'באר שבע - מרכז הנגב / שד'' רגר', ST_SetSRID(ST_MakePoint(34.7985, 31.2515), 4326)::geography),
  ('stop-54001', '54001', 'Dimona - Central Bus Station / Junction', 'דימונה - תחנה מרכזית / צומת', ST_SetSRID(ST_MakePoint(35.0330, 31.0700), 4326)::geography),
  ('stop-55001', '55001', 'Mitzpe Ramon - Visitor Center / Route 40', 'מצפה רמון - מרכז מבקרים / כביש 40', ST_SetSRID(ST_MakePoint(34.8010, 30.6100), 4326)::geography),
  ('stop-59001', '59001', 'Eilat - Central Bus Station', 'אילת - תחנה מרכזית', ST_SetSRID(ST_MakePoint(34.9498, 29.5569), 4326)::geography),
  ('stop-59002', '59002', 'Eilat - Mall HaYam / Promenade', 'אילת - קניון מול הים / טיילת', ST_SetSRID(ST_MakePoint(34.9535, 29.5472), 4326)::geography),
  ('stop-59003', '59003', 'Eilat - Coral Beach / Underwater Observatory', 'אילת - חוף אלמוג / המצפה התת ימי', ST_SetSRID(ST_MakePoint(34.9182, 29.5042), 4326)::geography)
ON CONFLICT (stop_id) DO UPDATE SET
  stop_name = EXCLUDED.stop_name,
  stop_name_he = EXCLUDED.stop_name_he,
  location = EXCLUDED.location;

INSERT INTO routes (route_id, agency_id, route_short_name, route_long_name, city_area)
VALUES
  ('stride-10993', '3', '993', 'חיפה (חוף הכרמל) - תל אביב (סבידור) - באר שבע (ת. מרכזית) - אילת (ת. מרכזית)', 'Intercity Haifa - Beer Sheva - Eilat'),
  ('stride-10390', '3', '390', 'תל אביב (ת. מרכזית / סבידור) - באר שבע - דימונה - אילת (ת. מרכזית)', 'Intercity Tel Aviv - Beer Sheva - Eilat'),
  ('stride-10380', '3', '380', 'תל אביב (סבידור / עזריאלי) - קריית גת - באר שבע (תחנה מרכזית)', 'Intercity Tel Aviv - Beer Sheva'),
  ('stride-10397', '3', '397', 'באר שבע (תחנה מרכזית) - דימונה - מצפה רמון - אילת (תחנה מרכזית)', 'Intercity Beer Sheva - Eilat'),
  ('stride-10004', '3', '4', 'באר שבע (תחנה מרכזית) - שד'' רגר - בית חולים סורוקה - אוניברסיטת בן גוריון', 'Beer Sheva'),
  ('stride-10015', '3', '15', 'אילת (תחנה מרכזית) - קניון מול הים - חוף אלמוג / המצפה התת ימי', 'Eilat')
ON CONFLICT (route_id) DO UPDATE SET
  route_short_name = EXCLUDED.route_short_name,
  route_long_name = EXCLUDED.route_long_name,
  city_area = EXCLUDED.city_area;

DELETE FROM route_stops
WHERE route_id IN (
  'stride-10993',
  'stride-10390',
  'stride-10380',
  'stride-10397',
  'stride-10004',
  'stride-10015',
  'stride-10369'
);

INSERT INTO route_stops (route_id, direction_id, stop_id, stop_sequence)
VALUES
  ('stride-10993', 0, 'stop-42658', 1),
  ('stride-10993', 0, 'stop-42362', 2),
  ('stride-10993', 0, 'stop-45003', 3),
  ('stride-10993', 0, 'stop-48001', 4),
  ('stride-10993', 0, 'stop-53001', 5),
  ('stride-10993', 0, 'stop-54001', 6),
  ('stride-10993', 0, 'stop-55001', 7),
  ('stride-10993', 0, 'stop-59001', 8),
  ('stride-10993', 0, 'stop-59002', 9),
  ('stride-10993', 1, 'stop-59002', 1),
  ('stride-10993', 1, 'stop-59001', 2),
  ('stride-10993', 1, 'stop-55001', 3),
  ('stride-10993', 1, 'stop-54001', 4),
  ('stride-10993', 1, 'stop-53001', 5),
  ('stride-10993', 1, 'stop-48001', 6),
  ('stride-10993', 1, 'stop-45003', 7),
  ('stride-10993', 1, 'stop-42362', 8),
  ('stride-10993', 1, 'stop-42657', 9),
  ('stride-10390', 0, 'stop-45005', 1),
  ('stride-10390', 0, 'stop-45004', 2),
  ('stride-10390', 0, 'stop-45003', 3),
  ('stride-10390', 0, 'stop-53001', 4),
  ('stride-10390', 0, 'stop-54001', 5),
  ('stride-10390', 0, 'stop-59001', 6),
  ('stride-10390', 0, 'stop-59002', 7),
  ('stride-10390', 1, 'stop-59002', 1),
  ('stride-10390', 1, 'stop-59001', 2),
  ('stride-10390', 1, 'stop-54001', 3),
  ('stride-10390', 1, 'stop-53001', 4),
  ('stride-10390', 1, 'stop-45003', 5),
  ('stride-10390', 1, 'stop-45004', 6),
  ('stride-10390', 1, 'stop-45005', 7),
  ('stride-10380', 0, 'stop-45003', 1),
  ('stride-10380', 0, 'stop-45004', 2),
  ('stride-10380', 0, 'stop-48001', 3),
  ('stride-10380', 0, 'stop-53003', 4),
  ('stride-10380', 0, 'stop-53002', 5),
  ('stride-10380', 0, 'stop-53001', 6),
  ('stride-10380', 1, 'stop-53001', 1),
  ('stride-10380', 1, 'stop-53002', 2),
  ('stride-10380', 1, 'stop-53003', 3),
  ('stride-10380', 1, 'stop-48001', 4),
  ('stride-10380', 1, 'stop-45004', 5),
  ('stride-10380', 1, 'stop-45003', 6),
  ('stride-10397', 0, 'stop-53001', 1),
  ('stride-10397', 0, 'stop-54001', 2),
  ('stride-10397', 0, 'stop-55001', 3),
  ('stride-10397', 0, 'stop-59001', 4),
  ('stride-10397', 0, 'stop-59002', 5),
  ('stride-10397', 1, 'stop-59002', 1),
  ('stride-10397', 1, 'stop-59001', 2),
  ('stride-10397', 1, 'stop-55001', 3),
  ('stride-10397', 1, 'stop-54001', 4),
  ('stride-10397', 1, 'stop-53001', 5),
  ('stride-10004', 0, 'stop-53001', 1),
  ('stride-10004', 0, 'stop-53003', 2),
  ('stride-10004', 0, 'stop-53002', 3),
  ('stride-10004', 1, 'stop-53002', 1),
  ('stride-10004', 1, 'stop-53003', 2),
  ('stride-10004', 1, 'stop-53001', 3),
  ('stride-10015', 0, 'stop-59001', 1),
  ('stride-10015', 0, 'stop-59002', 2),
  ('stride-10015', 0, 'stop-59003', 3),
  ('stride-10015', 1, 'stop-59003', 1),
  ('stride-10015', 1, 'stop-59002', 2),
  ('stride-10015', 1, 'stop-59001', 3),
  ('stride-10369', 0, 'stop-45005', 1),
  ('stride-10369', 0, 'stop-45004', 2),
  ('stride-10369', 0, 'stop-45003', 3),
  ('stride-10369', 0, 'stop-47001', 4),
  ('stride-10369', 0, 'stop-49001', 5),
  ('stride-10369', 0, 'stop-48001', 6),
  ('stride-10369', 0, 'stop-53001', 7),
  ('stride-10369', 1, 'stop-53001', 1),
  ('stride-10369', 1, 'stop-48001', 2),
  ('stride-10369', 1, 'stop-49001', 3),
  ('stride-10369', 1, 'stop-47001', 4),
  ('stride-10369', 1, 'stop-45003', 5),
  ('stride-10369', 1, 'stop-45004', 6),
  ('stride-10369', 1, 'stop-45005', 7)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;

DROP FUNCTION IF EXISTS find_central_stop_for_city(TEXT);

CREATE OR REPLACE FUNCTION find_central_stop_for_city(
  city_name TEXT
)
RETURNS TABLE (
  stop_id TEXT,
  stop_code TEXT,
  stop_name TEXT,
  stop_name_he TEXT,
  stop_lat FLOAT,
  stop_lon FLOAT,
  routes_count INT,
  is_central_hub BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  WITH normalized AS (
    SELECT LOWER(TRIM(COALESCE(city_name, ''))) AS raw_q
  ),
  city_pattern AS (
    SELECT CASE
      WHEN raw_q ~ '(חיפה|хайф|haifa)' THEN '(חיפה|haifa)'
      WHEN raw_q ~ '(טירת|тират|tirat)' THEN '(טירת כרמל|tirat carmel)'
      WHEN raw_q ~ '(תל.?אביב|тель.?אביב|тель.?авив|tel.?aviv|tlv)' THEN '(תל אביב|tel aviv)'
      WHEN raw_q ~ '(ירושלים|иерусалим|jerusalem)' THEN '(ירושלים|jerusalem)'
      WHEN raw_q ~ '(אילת|эйлат|eilat)' THEN '(אילת|eilat)'
      WHEN raw_q ~ '(באר.?שבע|беэр.?шев|beer.?sheva)' THEN '(באר שבע|beer sheva|be''er sheva)'
      WHEN raw_q ~ '(דימונה|димон|dimona)' THEN '(דימונה|dimona)'
      WHEN raw_q ~ '(מצפה.?רמון|мицпе.?рамон|mitzpe.?ramon)' THEN '(מצפה רמון|mitzpe ramon)'
      WHEN raw_q ~ '(אשדוד|ашдод|ashdod)' THEN '(אשדוד|ashdod)'
      WHEN raw_q ~ '(קריית.?גת|קרית.?גת|кирьят.?гат|kiryat.?gat)' THEN '(קריית גת|kiryat gat)'
      WHEN raw_q ~ '(נתניה|нетани|netanya)' THEN '(נתניה|netanya)'
      WHEN raw_q ~ '(אשקלון|ашкелон|ashkelon)' THEN '(אשקלון|ashkelon)'
      WHEN raw_q ~ '(חדרה|хадер|hadera)' THEN '(חדרה|hadera)'
      WHEN raw_q ~ '(עכו|акко|acre|akko)' THEN '(עכו|acre|akko)'
      WHEN raw_q ~ '(נהריה|нагари|nahariya)' THEN '(נהריה|nahariya)'
      WHEN raw_q ~ '(ראשון.?לציון|ришон|rishon)' THEN '(ראשון לציון|rishon lezion)'
      WHEN raw_q ~ '(רחובות|реховот|rehovot)' THEN '(רחובות|rehovot)'
      WHEN raw_q ~ '(פתח.?תקווה|петах|petah)' THEN '(פתח תקווה|petah tikva)'
      WHEN raw_q ~ '(הרצליה|герцли|herzliya)' THEN '(הרצליה|herzliya)'
      ELSE regexp_replace(raw_q, '([.*+?^${}()|[\]\\])', '\\\1', 'g')
    END AS pat
    FROM normalized
  ),
  stop_route_counts AS (
    SELECT
      rs.stop_id,
      COUNT(DISTINCT rs.route_id)::INT AS routes_cnt
    FROM route_stops rs
    GROUP BY rs.stop_id
  ),
  matched_stops AS (
    SELECT
      s.stop_id,
      s.stop_code,
      s.stop_name,
      COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
      ST_Y(s.location::geometry)::FLOAT AS stop_lat,
      ST_X(s.location::geometry)::FLOAT AS stop_lon,
      COALESCE(src.routes_cnt, 0) AS routes_count,
      (
        COALESCE(s.stop_name_he, '') ~* '(תחנה\s*מרכזית|ת\.\s*מרכזית|רכבת\s*מרכז|מסוף|מרכז\s*העיר|חוף\s*הכרמל)'
        OR s.stop_name ~* '(Central Bus Station|Central Train|Hof HaCarmel|Savidor)'
      ) AS is_central_hub,
      (
        CASE
          WHEN COALESCE(s.stop_name_he, '') ~* '(תחנה\s*מרכזית|ת\.\s*מרכזית|רציפים בינעירוני)' OR s.stop_name ~* 'Central Bus Station' THEN 100
          WHEN COALESCE(s.stop_name_he, '') ~* '(רכבת\s*מרכז|מסוף|סבידור|חוף\s*הכרמל)' OR s.stop_name ~* '(Central Train|Savidor|Hof HaCarmel)' THEN 80
          WHEN COALESCE(s.stop_name_he, '') ~* '(מרכז)' OR s.stop_name ~* 'Center' THEN 40
          ELSE 0
        END
        + CASE WHEN COALESCE(s.stop_name_he, '') ~* 'הורדה' THEN -15 ELSE 0 END
      ) AS hub_score
    FROM stops s
    CROSS JOIN city_pattern cp
    LEFT JOIN stop_route_counts src ON src.stop_id = s.stop_id
    WHERE cp.pat <> ''
      AND (
        COALESCE(s.stop_name_he, '') ~* cp.pat
        OR s.stop_name ~* cp.pat
      )
  )
  SELECT
    ms.stop_id::TEXT,
    ms.stop_code::TEXT,
    ms.stop_name::TEXT,
    ms.stop_name_he::TEXT,
    ms.stop_lat,
    ms.stop_lon,
    ms.routes_count,
    ms.is_central_hub
  FROM matched_stops ms
  ORDER BY
    ms.is_central_hub DESC,
    ms.hub_score DESC,
    ms.routes_count DESC,
    ms.stop_id ASC
  LIMIT 1;
$$;

-- =========================================================================
-- Migration 08: GTFS stop_times Schedules Table
-- =========================================================================
CREATE TABLE IF NOT EXISTS route_schedules (
  route_id TEXT NOT NULL,
  direction_id SMALLINT NOT NULL,
  day_type CHAR(1) NOT NULL, -- 'u' (Sun), 'w' (Mon-Thu), 'f' (Fri), 's' (Sat)
  departure_minutes SMALLINT[] NOT NULL,
  stop_offset_minutes SMALLINT[] NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (route_id, direction_id, day_type)
);

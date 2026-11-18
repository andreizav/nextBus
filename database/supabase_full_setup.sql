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

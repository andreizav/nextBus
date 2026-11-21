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
  dir_endpoints AS (
    SELECT DISTINCT ON (rs.route_id, rs.direction_id)
      rs.route_id,
      rs.direction_id,
      MAX(rs.stop_sequence) OVER (
        PARTITION BY rs.route_id, rs.direction_id
      )::INT AS max_seq,
      FIRST_VALUE(s.stop_name) OVER (
        PARTITION BY rs.route_id, rs.direction_id ORDER BY rs.stop_sequence DESC
      ) AS destination_name,
      FIRST_VALUE(COALESCE(s.stop_name_he, s.stop_name)) OVER (
        PARTITION BY rs.route_id, rs.direction_id ORDER BY rs.stop_sequence DESC
      ) AS destination_he
    FROM route_stops rs
    JOIN stops s ON s.stop_id = rs.stop_id
  ),
  closest_per_dir AS (
    SELECT DISTINCT ON (r.route_id, rs.direction_id)
      r.route_id::TEXT AS route_id,
      r.route_short_name::TEXT AS line_number,
      r.route_long_name::TEXT AS route_long_name,
      rs.direction_id::SMALLINT AS direction_id,
      ns.stop_id::TEXT AS nearest_stop_id,
      ns.stop_code::TEXT AS nearest_stop_code,
      ns.stop_name::TEXT AS nearest_stop_name,
      ns.stop_name_he::TEXT AS nearest_stop_name_he,
      rs.stop_sequence::INT AS nearest_stop_sequence,
      ns.stop_lat,
      ns.stop_lon,
      ns.dist_m AS distance_meters,
      COALESCE(ep.destination_name, r.route_long_name)::TEXT AS destination_name,
      COALESCE(ep.destination_he, r.route_long_name)::TEXT AS destination_he
    FROM route_stops rs
    JOIN nearby_stops ns ON ns.stop_id = rs.stop_id
    JOIN routes r ON r.route_id = rs.route_id
    JOIN dir_endpoints ep ON ep.route_id = rs.route_id AND ep.direction_id = rs.direction_id
    WHERE rs.stop_sequence < ep.max_seq
    ORDER BY
      r.route_id,
      rs.direction_id,
      ns.dist_m ASC
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

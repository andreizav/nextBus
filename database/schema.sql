-- nextBus Supabase / PostgreSQL + PostGIS Schema
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

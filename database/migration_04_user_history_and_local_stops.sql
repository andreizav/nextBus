-- nextBus Migration 04 (User Context & Local Stop Suggestions):
-- 1. user_route_history table storing anonymous per-user past searches/trips by origin location.
-- 2. get_nearby_lines_and_termini: PostGIS ST_DWithin lookup returning nearby bus lines, boarding stops & termini.
-- 3. find_user_route_history_near_location: PostGIS ST_DWithin returning user's recent routes near (user_lat, user_lon).

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

-- RPC: get_nearby_lines_and_termini
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

-- RPC: find_user_route_history_near_location
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

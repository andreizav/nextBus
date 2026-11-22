-- Migration 07: fast get_nearby_lines_and_termini
--
-- The previous version computed MAX()/FIRST_VALUE() window functions over the ENTIRE
-- nationwide route_stops table on every call (1.5-4 s on Supabase), only to look up the
-- terminus of the handful of routes that pass the user's nearby stops.
-- This version first finds the (route, direction) pairs serving stops within the radius and
-- resolves each terminus with an index-only "last stop_sequence" lookup
-- (idx_route_stops_lookup: route_id, direction_id, stop_sequence).
--
-- Same signature and result columns: safe drop-in replacement.

CREATE INDEX IF NOT EXISTS idx_route_stops_stop_id
  ON route_stops (stop_id);

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

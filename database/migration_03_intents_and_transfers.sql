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

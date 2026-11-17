-- nextBus Migration 03: 1-Transfer Multi-Leg Route Matching RPC & Connecting Routes

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

-- Seed connecting Haifa feeder lines (Lines 37, 28, 17) so University of Haifa, Hadar and Rambam Hospital
-- are reachable via smooth 1-transfer hubs at Horev Center and Hof HaCarmel.
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
  -- Line 37 dir 0: Carmel Center -> Horev -> Denia -> University of Haifa
  ('stride-10037', 0, 'stop-43016', 1),
  ('stride-10037', 0, 'stop-43015', 2),
  ('stride-10037', 0, 'stop-43013', 3),
  ('stride-10037', 0, 'stop-43041', 4),
  ('stride-10037', 0, 'stop-43042', 5),
  -- Line 37 dir 1: University of Haifa -> Horev -> Carmel Center
  ('stride-10037', 1, 'stop-43042', 1),
  ('stride-10037', 1, 'stop-43041', 2),
  ('stride-10037', 1, 'stop-43013', 3),
  ('stride-10037', 1, 'stop-43015', 4),
  ('stride-10037', 1, 'stop-43016', 5),
  -- Line 28 dir 0: Horev -> Carmel Center -> Hadar -> Rambam Hospital
  ('stride-10028', 0, 'stop-43013', 1),
  ('stride-10028', 0, 'stop-43015', 2),
  ('stride-10028', 0, 'stop-43016', 3),
  ('stride-10028', 0, 'stop-43051', 4),
  ('stride-10028', 0, 'stop-43052', 5),
  -- Line 28 dir 1: Rambam Hospital -> Hadar -> Horev
  ('stride-10028', 1, 'stop-43052', 1),
  ('stride-10028', 1, 'stop-43051', 2),
  ('stride-10028', 1, 'stop-43016', 3),
  ('stride-10028', 1, 'stop-43015', 4),
  ('stride-10028', 1, 'stop-43013', 5),
  -- Line 17 dir 0: Hof HaCarmel -> Kiryat Eliezer -> German Colony -> Rambam Hospital
  ('stride-10017', 0, 'stop-42658', 1),
  ('stride-10017', 0, 'stop-43062', 2),
  ('stride-10017', 0, 'stop-43061', 3),
  ('stride-10017', 0, 'stop-43052', 4),
  -- Line 17 dir 1: Rambam Hospital -> German Colony -> Hof HaCarmel
  ('stride-10017', 1, 'stop-43052', 1),
  ('stride-10017', 1, 'stop-43061', 2),
  ('stride-10017', 1, 'stop-43062', 3),
  ('stride-10017', 1, 'stop-42657', 4)
ON CONFLICT (route_id, direction_id, stop_sequence) DO UPDATE SET
  stop_id = EXCLUDED.stop_id;

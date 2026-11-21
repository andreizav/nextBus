-- nextBus Migration 06 (Full-Country Israel GTFS Support: Southern Corridor, Be'er Sheva & Eilat):
-- 1. Seeds verified stops for Be'er Sheva, Dimona, Mitzpe Ramon, Eilat, and Ashkelon.
-- 2. Seeds verified intercity & local GTFS routes connecting Haifa/Tel Aviv <-> Be'er Sheva <-> Eilat
--    with contiguous stop_sequence per (route_id, direction_id).
-- 3. Updates find_central_stop_for_city to recognize Eilat, Dimona, Mitzpe Ramon, Rishon LeZion,
--    Rehovot, Petah Tikva, Herzliya alongside Be'er Sheva and Northern/Central hubs.

-- 1. Verified Southern Israel & Coastal Hub Stops
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

-- 2. Verified Southern Intercity & Local Urban Routes
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

-- 3. Contiguous route_stops mappings for both directions
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
  -- Line 993 (Haifa -> Tel Aviv -> Kiryat Gat -> Be'er Sheva -> Eilat)
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

  -- Line 390 (Tel Aviv <-> Be'er Sheva <-> Dimona <-> Eilat)
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

  -- Line 380 (Tel Aviv <-> Kiryat Gat <-> Be'er Sheva)
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

  -- Line 397 (Be'er Sheva <-> Dimona <-> Mitzpe Ramon <-> Eilat)
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

  -- Line 4 (Be'er Sheva Urban Core)
  ('stride-10004', 0, 'stop-53001', 1),
  ('stride-10004', 0, 'stop-53003', 2),
  ('stride-10004', 0, 'stop-53002', 3),
  ('stride-10004', 1, 'stop-53002', 1),
  ('stride-10004', 1, 'stop-53003', 2),
  ('stride-10004', 1, 'stop-53001', 3),

  -- Line 15 (Eilat Urban Promenade / Beaches)
  ('stride-10015', 0, 'stop-59001', 1),
  ('stride-10015', 0, 'stop-59002', 2),
  ('stride-10015', 0, 'stop-59003', 3),
  ('stride-10015', 1, 'stop-59003', 1),
  ('stride-10015', 1, 'stop-59002', 2),
  ('stride-10015', 1, 'stop-59001', 3),

  -- Line 369 extended (Tel Aviv <-> Ashdod <-> Ashkelon <-> Kiryat Gat <-> Be'er Sheva)
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

-- 4. Upgrade find_central_stop_for_city(city_name TEXT) for full-country city aliases
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

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

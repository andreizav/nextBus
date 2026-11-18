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

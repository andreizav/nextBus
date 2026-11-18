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

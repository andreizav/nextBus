# nextBus — Technical Specification (`docs/spec.md`)

## 1. Overview
**nextBus** is a Cloud-Native real-time Israeli public transit tracking service integrated with **Google Connected Apps** (Google Search & Gemini) via the **Model Context Protocol (MCP)** as well as direct standalone web/mobile usage.

```mermaid
flowchart LR
    User["Google Search / Gemini or Standalone Web"] -->|MCP POST /mcp or POST /api/search-routes| Backend["Node.js + Express + Intent Router"]
    Widget["Angular 20 Widget"] -->|GET /api/live-status (15s)| Backend
    Backend -->|1. Geo RPC| Supabase["Supabase (PostgreSQL + PostGIS)"]
    Backend -->|2. Read State 1-2ms| Redis["Redis (bus:state & bus:active_routes)"]
    Worker["Polling Worker (15s)"] -->|3. Active Routes ZSET| Redis
    Worker -->|4. Batch Telemetry| Stride["Open Bus Stride API (SIRI)"]
    Worker -->|5. Update Cache TTL 60s| Redis
```

---

## 2. Database Schema (Supabase PostgreSQL + PostGIS)

### Extensions
- `postgis`

### Tables
1. **`routes`**:
   - `route_id TEXT PRIMARY KEY`
   - `agency_id TEXT NOT NULL`
   - `route_short_name TEXT NOT NULL` (Indexed: `idx_routes_short_name`)
   - `route_long_name TEXT NOT NULL`
   - `city_area TEXT`
2. **`stops`**:
   - `stop_id TEXT PRIMARY KEY`
   - `stop_code TEXT NOT NULL` (Indexed: `idx_stops_code`)
   - `stop_name TEXT NOT NULL`
   - `stop_name_he TEXT`
   - `location GEOGRAPHY(Point, 4326) NOT NULL` (GIST Indexed: `idx_stops_location_gist`)
3. **`route_stops`**:
   - `id SERIAL PRIMARY KEY`
   - `route_id TEXT NOT NULL REFERENCES routes(route_id) ON DELETE CASCADE`
   - `direction_id SMALLINT NOT NULL`
   - `stop_id TEXT NOT NULL REFERENCES stops(stop_id) ON DELETE CASCADE`
   - `stop_sequence INT NOT NULL`

### RPC Functions
1. `find_nearest_stop_for_line(line_num TEXT, user_lat FLOAT, user_lon FLOAT, preferred_dir SMALLINT DEFAULT NULL)`
   Returns the nearest stop for the specified bus line using PostGIS KNN `<->` distance ordering on `GEOGRAPHY(Point, 4326)`.
2. `find_nearby_lines_by_number(line_num TEXT, user_lat FLOAT, user_lon FLOAT, radius_meters INT DEFAULT 600)`
   Filters stops within `radius_meters` using `ST_DWithin`, matches routes with `route_short_name` matching or prefixed by `line_num` (e.g. `49` and `49א`), excludes unrelated cities, and returns candidate routes/directions with `origin_he`, `destination_he`, nearest stop info, and distance.
3. `find_direct_trips(origin_lat FLOAT, origin_lon FLOAT, dest_lat FLOAT, dest_lon FLOAT, radius_meters INT DEFAULT 500)`
   Uses `ST_DWithin` to find boarding stops (Set A) within `radius_meters` of origin and alighting stops (Set B) within `radius_meters` of destination, joins `route_stops` enforcing strict travel direction (`rs_origin.stop_sequence < rs_dest.stop_sequence`), and returns one optimal `(origin_stop, dest_stop)` pair per route and direction with `stops_between`.
4. `find_transfer_trips(origin_lat FLOAT, origin_lon FLOAT, dest_lat FLOAT, dest_lon FLOAT, radius_meters INT DEFAULT 500, max_transfers INT DEFAULT 2)`
   Finds connecting transfer journeys (1 or 2 transfers) via shared hubs or nearby stops (`ST_DWithin`), enforcing `seq_board < seq_alight` on every leg.
5. `find_central_stop_for_city(city_name TEXT)`
   Resolves a city-only query (e.g., `"Кирьят-Гат"`, `"Хайфа"`, `"Ashdod"`) to its primary central bus station or highest-connectivity transit hub (`מרכזית`, `רכבת מרכז`, `מסוף`) in GTFS/PostGIS.
6. `find_popular_stop_on_street(street_name TEXT, city_hint TEXT DEFAULT NULL, near_lat FLOAT DEFAULT NULL, near_lon FLOAT DEFAULT NULL)`
   Resolves street-only queries (without a house number or POI) to stops along the matching street corridor, ordered by route count (`COUNT(DISTINCT route_id)` in `route_stops`) and proximity, returning the main popular hub stop first plus alternatives.

---

## 3. Redis Data Contracts

| Key Pattern | Type | TTL | Description |
| :--- | :--- | :--- | :--- |
| `bus:state:{route_id}:{direction_id}` | String (JSON) | `60s` | Cached SIRI telemetry array (`vehicles[]`, `updated_at`, `source`) for a route & direction. |
| `bus:active_routes` | Sorted Set (ZSET) | Sliding `15m` score | Members formatted as `"{route_id}:{direction_id}"`; score is `Date.now() + 15 * 60 * 1000`. |
| `geo:cache:{query_hash}` | String (JSON) | `86400s` (24h) | Cached Google Places / Geocoding result (`lat`, `lon`, `formatted_address`, `place_name`). |

---

## 4. Unified Intent Routing & Widget Response Contracts

All backend responses (`/mcp`, `POST /api/search-routes`, `GET /api/live-status`) share the unified `LiveBusStatusResponse` structure with additive intent-driven fields:

### 4.1 `entry_context` & `intent_type`
- `entry_context`: `"mcp" | "standalone"`
  - `"mcp"`: Invoked from Gemini / Google Search. Search input & microphone are strictly hidden in the UI.
  - `"standalone"`: Direct web / mobile access. Search input + Web Speech API voice input are visible.
- `intent_type`: `"LINE_LOOKUP" | "LINE_DISAMBIGUATION" | "TRIP_PLANNER" | "LOCATION_MISMATCH"`

### 4.2 `LINE_DISAMBIGUATION` (`candidates[]`)
Returned when a user searches by bus line number (e.g., `"49"`, `"Сорок девятый автобус"`) and multiple nearby lines or directions match within the user's geographic radius:
```json
{
  "intent_type": "LINE_DISAMBIGUATION",
  "candidates": [
    {
      "route_id": "stride-10049",
      "line_number": "49",
      "direction_id": 0,
      "origin_he": "טירת כרמל",
      "destination_he": "חוף הכרמל חיפה",
      "nearest_stop_name": "הרצל/מוצקין (טירת כרמל)",
      "nearest_stop_name_he": "הרצל/מוצקין (טירת כרמל)",
      "nearest_stop_code": "42653",
      "distance_meters": 180,
      "eta_minutes": 4
    },
    {
      "route_id": "stride-10049a",
      "line_number": "49א",
      "direction_id": 0,
      "origin_he": "טירת כרמל",
      "destination_he": "מרכז חורב (חיפה)",
      "nearest_stop_name": "הרצל/מוצקין (טירת כרמל)",
      "nearest_stop_name_he": "הרצל/מוצקין (טירת כרמל)",
      "nearest_stop_code": "42653",
      "distance_meters": 180,
      "eta_minutes": 7
    }
  ]
}
```

### 4.3 `TRIP_PLANNER` (`trip_options[]` with ordered `legs[]`)
Returned for A-to-B destination queries (up to 3 options, supporting 0, 1, or 2 transfers):
```json
{
  "intent_type": "TRIP_PLANNER",
  "trip_options": [
    {
      "rank": 1,
      "total_duration_min": 29,
      "estimated_arrival_time": "13:19",
      "transfers_count": 1,
      "legs": [
        {
          "leg_type": "BOARD_AND_RIDE",
          "line_number": "49",
          "route_id": "stride-10049",
          "direction_id": 0,
          "board_stop": {
            "stop_id": "stop-42655",
            "stop_code": "42655",
            "stop_name": "הרצל/העצמאות (טירת כרמל)",
            "stop_name_he": "הרצל/העצמאות (טירת כרמל)",
            "eta_minutes": 4,
            "scheduled_time": "12:54"
          },
          "alight_stop": {
            "stop_id": "stop-42656",
            "stop_code": "42656",
            "stop_name": "מת''מ (חיפה)",
            "stop_name_he": "מת''מ (חיפה)",
            "stops_count": 6
          },
          "ride_duration_min": 9
        },
        {
          "leg_type": "TRANSFER",
          "line_number": "17",
          "route_id": "stride-10017",
          "direction_id": 0,
          "board_stop": {
            "stop_id": "stop-42658",
            "stop_code": "42658",
            "stop_name": "ת. מרכזית חוף הכרמל",
            "stop_name_he": "ת. מרכזית חוף הכרמל",
            "eta_minutes": 18,
            "scheduled_time": "13:08"
          },
          "alight_stop": {
            "stop_id": "stop-43052",
            "stop_code": "43052",
            "stop_name": "Rambam Hospital / Bat Galim (Haifa)",
            "stop_name_he": "בית חולים רמב\"ם / בת גלים (חיפה)",
            "stops_count": 3
          },
          "transfer_wait_min": 5,
          "transfer_walk_meters": 95,
          "ride_duration_min": 11
        }
      ]
    }
  ]
}
```

### 4.4 Compact Stop Timeline (`timeline_window`)
Enforces the "3-second rule" on mobile screens by slicing full route stop lists into a compact window around the approaching bus and the user's boarding stop (2–3 stops before and 2–3 stops ahead):
```json
{
  "timeline_window": {
    "past_stops": [],
    "current_bus_stop": null,
    "user_stop": null,
    "upcoming_stops": [],
    "compact_stops": [],
    "hidden_past_count": 12,
    "hidden_upcoming_count": 15,
    "total_stops_count": 33
  }
}
```

### 4.5 Destination Granularity Classification (`destination_granularity`)
Every resolved destination carries `destination_granularity: "city" | "address" | "street" | "poi"` and selects the target stop as follows:
- **`"city"`** (city name only, no street, house number, or POI — e.g., *"в Хайфу"*, *"в Кирьят-Гат"*): Resolves via `find_central_stop_for_city(city_name)` to the central bus station / main transit hub (`resolved_stop`).
- **`"address"` / `"poi"`** (specific street + house number or specific landmark/facility — e.g., *"Хорев 12, Хайфа"*, *"больница Рамбам"*): Geocodes exact coordinates and uses PostGIS `ST_DWithin` (~400–500 m, expanding if needed) to snap `resolved_stop` to the nearest physical bus stop.
- **`"street"`** (street name only without house number or POI — e.g., *"на улицу Хорев"*): Resolves via `find_popular_stop_on_street(...)`, selecting the highest-connectivity hub/junction stop on that corridor as `resolved_stop` and returning up to 6 `alternative_street_stops[]` so the rider can switch to another stop on the same street.

### 4.6 Location Mismatch Confirmation (`location_mismatch`)
When the user explicitly provides a starting stop/origin (e.g., *"Я стою на остановке X и еду в Y по маршруту Z"*) or requests a specific bus line that does not pass near their current GPS position (> 600–800 m away), the backend avoids silent substitution or hard errors and instead returns `intent_type: "LOCATION_MISMATCH"`:
```json
{
  "intent_type": "LOCATION_MISMATCH",
  "requires_confirmation": true,
  "confirmation_type": "location_mismatch",
  "proposed_origin": {
    "label": "ת. מרכזית תל אביב",
    "lat": 32.0558,
    "lon": 34.7788,
    "stop_id": "stop-45005",
    "line_number": "480",
    "destination_query": "Иерусалим"
  },
  "current_location_summary": {
    "lat": 32.7895,
    "lon": 34.964,
    "label": "Т. מרכזית חוף הכרמל",
    "nearest_stop_name": "Hof HaCarmel (Haifa)",
    "nearest_stop_name_he": "חוף הכרמל (חיפה)",
    "distance_to_proposed_meters": 82400
  }
}
```
Upon user confirmation ("Yes, search from the specified point"), the client retries `POST /api/search-routes` (or MCP tool call) with `ignore_user_location: true` and `explicit_origin` matching `proposed_origin`.

### 4.7 Strict GTFS / PostGIS Route & Transfer Validation
- All direct routes and 1- or 2-transfer connections MUST originate from confirmed `routes`, `stops`, and `route_stops` records in PostgreSQL/PostGIS with strict ordering (`origin_stop_sequence < dest_stop_sequence` on every leg) and verified transfer stop adjacency (`ST_DWithin`).
- Fabricating unverified intercity buses or synthetic highway waypoints is strictly prohibited.
- When no confirmed bus route or transfer chain exists in the database for a query, the API returns `no_verified_route: true` and `routing_notice` containing localized explanation messages and `nearest_confirmed_hub`.

---

## 5. MCP Tool Contracts

### 5.1 `get_live_bus_status`
- **Tool Name:** `get_live_bus_status`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`
- **Input Schema (Zod):** `line_number`, `user_location { lat, lon }`, `user_id?`, `destination_hint?`, `include_nearby_places?`, `ignore_user_location?`, `explicit_origin?`

### 5.2 `find_best_buses_to_destination`
- **Tool Name:** `find_best_buses_to_destination`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`
- **Input Schema (Zod):** `user_location { lat, lon }`, `destination_location { lat, lon, label }`, `user_id?`, `ignore_user_location?`, `explicit_origin?`

---

## 6. HTTP Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/mcp` | MCP JSON-RPC / Streamable HTTP endpoint (`entry_context: "mcp"`) |
| `POST` | `/api/search-routes` | Standalone Intent Router (`entry_context: "standalone"`): handles line lookup, disambiguation, A->B transfers, destination granularity, and `location_mismatch` / `ignore_user_location` confirmation |
| `GET` | `/api/live-status` | 15s widget polling endpoint; reads Redis cache and returns `timeline_window`, `candidates`, and `trip_options` |
| `GET` | `/.well-known/google-connected-apps` | Google Connected Console domain verification JSON |
| `GET` | `/privacy` | Static Privacy Policy HTML page |
| `GET` | `/terms` | Static Terms of Service HTML page |
| `GET` | `*` | Angular 20 production widget SPA fallback |

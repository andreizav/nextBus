# nextBus — Technical Specification (`docs/spec.md`)

## 1. Overview
**nextBus** is a Cloud-Native real-time Israeli public transit tracking service integrated with **Google Connected Apps** (Google Search & Gemini) via the **Model Context Protocol (MCP)**.

```mermaid
flowchart LR
    User["Google Search / Gemini"] -->|MCP POST /mcp| Backend["Node.js + Express + MCP Server"]
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
2. `find_direct_routes_between_points(origin_lat FLOAT, origin_lon FLOAT, dest_lat FLOAT, dest_lon FLOAT, radius_meters INT DEFAULT 500)`
   Uses `ST_DWithin` to find boarding stops (Set A) within `radius_meters` of origin and alighting stops (Set B) within `radius_meters` of destination, joins `route_stops` enforcing strict travel direction (`rs_origin.stop_sequence < rs_dest.stop_sequence`), and returns one optimal `(origin_stop, dest_stop)` pair per route and direction with `stops_between`.

---

## 3. Redis Data Contracts

| Key Pattern | Type | TTL | Description |
| :--- | :--- | :--- | :--- |
| `bus:state:{route_id}:{direction_id}` | String (JSON) | `60s` | Cached SIRI telemetry array (`vehicles[]`, `updated_at`, `source`) for a route & direction. |
| `bus:active_routes` | Sorted Set (ZSET) | Sliding `15m` score | Members formatted as `"{route_id}:{direction_id}"`; score is `Date.now() + 15 * 60 * 1000`. |
| `geo:cache:{query_hash}` | String (JSON) | `86400s` (24h) | Cached Google Places / Geocoding result (`lat`, `lon`, `formatted_address`, `place_name`). |

---

## 4. MCP Tool Contracts

### 4.1 `get_live_bus_status`
- **Tool Name:** `get_live_bus_status`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`
- **Input Schema (Zod):**
  ```json
  {
    "line_number": "49",
    "user_location": { "lat": 32.7802, "lon": 34.9658 },
    "destination_hint": "Hof HaCarmel",
    "include_nearby_places": false
  }
  ```

### 4.2 `find_best_buses_to_destination`
- **Tool Name:** `find_best_buses_to_destination`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`
- **Input Schema (Zod):**
  ```json
  {
    "user_location": { "lat": 32.7895, "lon": 34.9640 },
    "destination_location": { "lat": 32.7832, "lon": 34.9859, "label": "Поликлиника на Хорев, Хайфа" }
  }
  ```
- **Output JSON Contract (Extended with `entry_context`, `destination`, `recommended_options`):**
  ```json
  {
    "entry_context": "mcp",
    "render_mode": "interactive",
    "updated_at": "2026-11-17T16:10:00.000Z",
    "cache_hit": true,
    "destination": {
      "lat": 32.7832,
      "lon": 34.9859,
      "place_name": "Поликлиника на Хорев",
      "formatted_address": "Horev St, Haifa, Israel"
    },
    "recommended_options": [
      {
        "rank": 1,
        "route": { "route_id": "stride-10024", "short_name": "24", "long_name": "...", "direction_id": 0, "direction_label": "..." },
        "origin_stop": { "stop_id": "...", "stop_code": "42656", "stop_name": "...", "stop_name_he": "...", "stop_sequence": 3, "lat": 32.790385, "lon": 34.96134 },
        "dest_stop": { "stop_id": "...", "stop_code": "43101", "stop_name": "...", "stop_name_he": "...", "stop_sequence": 10, "lat": 32.7832, "lon": 34.9859 },
        "bus": { "vehicle_id": "egged-24-101", "lat": 32.7870, "lon": 34.9590, "bearing": 90, "recorded_at_time": "...", "current_stop_sequence": 1, "stops_away": 2, "eta_minutes": 4 },
        "eta_to_boarding_min": 4,
        "stops_between": 7,
        "ride_duration_min": 13,
        "total_arrival_min": 17,
        "estimated_arrival_time": "19:45",
        "timeline_stops": []
      }
    ],
    "route": { "route_id": "stride-10024", "short_name": "24", "long_name": "...", "direction_id": 0, "direction_label": "...", "available_directions": [] },
    "user_stop": { "stop_id": "...", "stop_code": "42656", "stop_name": "...", "stop_name_he": "...", "stop_sequence": 3, "lat": 32.790385, "lon": 34.96134 },
    "nearest_bus": { "vehicle_id": "egged-24-101", "lat": 32.7870, "lon": 34.9590, "bearing": 90, "recorded_at_time": "...", "current_stop_sequence": 1, "stops_away": 2, "eta_minutes": 4 },
    "timeline_stops": [],
    "lite_map": { "static_image_url": "...", "bbox": { "minLat": 32.755, "maxLat": 32.805, "minLon": 34.950, "maxLon": 34.990 }, "bus_projection": { "xPercent": 57.5, "yPercent": 79.0 }, "user_projection": { "xPercent": 54.5, "yPercent": 67.6 } },
    "nearby_offers": []
  }
  ```

---

## 5. HTTP Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/mcp` | MCP JSON-RPC / Streamable HTTP endpoint exposing `get_live_bus_status` and `find_best_buses_to_destination` |
| `POST` | `/api/search-routes` | Standalone A -> B search: geocodes `query` via Google Places/Geocoding + Redis `geo:cache` and returns Top-3 buses (`entry_context: "standalone"`) |
| `GET` | `/api/live-status` | 15s widget polling endpoint; supports single `line_number` or multi-route `route_ids` with destination coords for Top-3 live refresh from Redis |
| `GET` | `/.well-known/google-connected-apps` | Google Connected Console domain verification JSON |
| `GET` | `/privacy` | Static Privacy Policy HTML page |
| `GET` | `/terms` | Static Terms of Service HTML page |
| `GET` | `*` | Angular 20 production widget SPA fallback |

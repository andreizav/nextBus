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

### RPC Function
- `find_nearest_stop_for_line(line_num TEXT, user_lat FLOAT, user_lon FLOAT)`
  Returns the nearest stop for the specified bus line using PostGIS KNN `<->` distance ordering on `GEOGRAPHY(Point, 4326)`.

---

## 3. Redis Data Contracts

| Key Pattern | Type | TTL | Description |
| :--- | :--- | :--- | :--- |
| `bus:state:{route_id}:{direction_id}` | String (JSON) | `60s` | Cached SIRI telemetry array (`vehicles[]`, `updated_at`, `source`) for a route & direction. |
| `bus:active_routes` | Sorted Set (ZSET) | Sliding `15m` score | Members formatted as `"{route_id}:{direction_id}"`; score is `Date.now() + 15 * 60 * 1000`. |

---

## 4. MCP Tool Contract (`get_live_bus_status`)

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
- **Output JSON Contract:**
  ```json
  {
    "render_mode": "lite",
    "updated_at": "2026-11-17T16:10:00.000Z",
    "cache_hit": true,
    "route": {
      "route_id": "route-49-haifa",
      "short_name": "49",
      "long_name": "Tirat Carmel - Haifa Hof HaCarmel",
      "direction_id": 0,
      "direction_label": "Tirat Carmel -> Hof HaCarmel",
      "available_directions": [
        { "direction_id": 0, "label": "Tirat Carmel -> Hof HaCarmel" },
        { "direction_id": 1, "label": "Hof HaCarmel -> Tirat Carmel" }
      ]
    },
    "user_stop": {
      "stop_id": "stop-41004",
      "stop_code": "41004",
      "stop_name": "HaHagana / Tirat Carmel",
      "stop_name_he": "ההגנה / טירת כרמל",
      "stop_sequence": 5,
      "lat": 32.7712,
      "lon": 34.9718
    },
    "nearest_bus": {
      "vehicle_id": "egged-49-101",
      "lat": 32.7655,
      "lon": 34.9730,
      "bearing": 12,
      "recorded_at_time": "2026-11-17T16:09:50.000Z",
      "current_stop_sequence": 3,
      "stops_away": 2,
      "eta_minutes": 4
    },
    "timeline_stops": [],
    "lite_map": {
      "static_image_url": "/assets/haifa-route-49-static.svg",
      "bbox": {
        "minLat": 32.755,
        "maxLat": 32.805,
        "minLon": 34.950,
        "maxLon": 34.990
      },
      "bus_projection": { "xPercent": 57.5, "yPercent": 79.0 },
      "user_projection": { "xPercent": 54.5, "yPercent": 67.6 }
    },
    "nearby_offers": []
  }
  ```

---

## 5. HTTP Endpoints

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `POST` | `/mcp` | MCP JSON-RPC / Streamable HTTP endpoint exposing `get_live_bus_status` |
| `GET` | `/api/live-status` | 15s widget polling endpoint (reads strictly from Redis cache + refreshes `bus:active_routes`) |
| `GET` | `/.well-known/google-connected-apps` | Google Connected Console domain verification JSON |
| `GET` | `/privacy` | Static Privacy Policy HTML page |
| `GET` | `/terms` | Static Terms of Service HTML page |
| `GET` | `*` | Angular 20 production widget SPA fallback |

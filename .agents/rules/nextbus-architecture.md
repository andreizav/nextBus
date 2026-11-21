# nextBus Architecture Rules & Constraints

These rules are mandatory for all code, configuration, and deployments in the `nextBus` monorepo.

## 1. Zero Direct Government API Calls from Client Requests
- Client requests originating from Google Search / Gemini Connected Apps (`POST /mcp`) or from the Angular UI widget (`GET /api/live-status`) **MUST NEVER** directly poll Open Bus Stride API or SIRI on regular live-status polling requests.
- Client widget polling (`GET /api/live-status`) reads exclusively from Upstash Redis cache (`bus:state:{route_id}:{direction_id}`) within 1–2 ms.
- Only on a cold-cache miss during an initial MCP tool invocation (`get_live_bus_status`) or search bootstrap may the backend perform a single bootstrap fetch from Stride API to warm the cache and register the route in `bus:active_routes`.

## 2. Active Route Tracking Pattern
- The background worker (`src/workers/polling.worker.ts`) polls Open Bus Stride API once every 15 seconds **ONLY** for routes present in the Redis Sorted Set `bus:active_routes`.
- Active routes are tracked via `ZADD bus:active_routes <score> "<route_id>:<direction_id>"` where `score = Date.now() + 15 * 60 * 1000` (15-minute sliding TTL).
- Before each polling cycle, expired routes (`score <= Date.now()`) are purged with `ZREMRANGEBYSCORE` so Free Tier API quotas are never exhausted by idle routes.
- Cached bus state keys `bus:state:{route_id}:{direction_id}` have a strict `TTL = 60` seconds.

## 3. Visual Lightness & the "3-Second Rule"
- On mobile screens and inside AI chat cards, the main widget view **MUST NOT** dump dozens of stops or distracting clutter all at once.
- Stop timelines are constrained by default to a fixed compact window (`timeline_window`) around the current bus position and the user's boarding stop (up to 2–3 stops before and 2–3 stops ahead), with explicit counts of hidden stops and an optional expandable "Show all stops" control.
- User's current location and boarding stop ("You are here" / station pin) must be visibly anchored so the travel direction and proximity are legible within 3 seconds.

## 4. Step-by-Step Transfers (Max 1–2 Transfers, Up to 3 Best Options)
- For A-to-B destination queries (`TRIP_PLANNER`), never merge stops of multiple bus routes into a flat indistinguishable list.
- Break multi-leg journeys into clear sequential legs (`legs[]`): Board -> Ride -> Exit & Transfer (with transfer bus number, walking distance, and wait/scheduled time) -> Arrive, displaying at most 1–2 transfers and up to 3 top options sorted by total travel time.

## 5. Hybrid Rendering & Dual Entry Context
- The backend computes `render_mode: "lite" | "interactive"` and separates entry contexts via `entry_context: "mcp" | "standalone"`:
  - **`"mcp"` (Google Search / Gemini Connected Apps):** The LLM resolves user intent and coordinates and invokes MCP tools (`get_live_bus_status` or `find_best_buses_to_destination`). The search bar and voice microphone button are **strictly hidden from the DOM** (`@if (entryContext() === 'standalone')`).
  - **`"standalone"` (Direct Web / Mobile WebView):** Displays the clean search bar with Web Speech API voice input (`ru-RU`, `he-IL`, `en-US`) calling `POST /api/search-routes` (routed through the Intent Dispatcher), defaulting to the uncluttered mobile card view with a toggle to `@defer` interactive map mode.

## 6. Modern Angular 20 Standards
- All UI components use Angular **Standalone Components** exclusively.
- All component and reactive state uses **Angular Signals** (`signal`, `computed`, `effect`), `@if` / `@for`, and `@defer` for lazy-loading heavy mapping modules.
- Full RTL (`dir="rtl"`) support for Hebrew stop names (`stop_name_he`) alongside Russian (`ru`) and English (`en`) localization.

## 7. Security & Secret Management
- **NEVER** hardcode API keys, database credentials, Redis URLs, or verification tokens in source files.
- All secrets (`PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`, `GOOGLE_VERIFICATION_TOKEN`, `GOOGLE_MAPS_API_KEY`) must be injected strictly via `.env` / environment variables (`process.env`).
- Geocoding results from Google Places / Geocoding API are cached in Redis under `geo:cache:{query_hash}` with a 24-hour TTL (`86400s`) to protect API quotas.

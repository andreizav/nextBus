# nextBus Architecture Rules & Constraints

These rules are mandatory for all code, configuration, and deployments in the `nextBus` monorepo.

## 1. Zero Direct Government API Calls from Client Requests
- Client requests originating from Google Search / Gemini Connected Apps (`POST /mcp`) or from the Angular UI widget (`GET /api/live-status`) **MUST NEVER** directly poll Open Bus Stride API or SIRI on regular live-status polling requests.
- Client widget polling (`GET /api/live-status`) reads exclusively from Redis cache (`bus:state:{route_id}:{direction_id}`) within 1–2 ms.
- Only on a cold-cache miss during an initial MCP tool invocation (`get_live_bus_status`) may the backend perform a single bootstrap fetch from Stride API to warm the cache and register the route in `bus:active_routes`.

## 2. Active Route Tracking Pattern
- The background worker (`src/workers/polling.worker.ts`) polls Open Bus Stride API once every 15 seconds **ONLY** for routes present in the Redis Sorted Set `bus:active_routes`.
- Active routes are tracked via `ZADD bus:active_routes <score> "<route_id>:<direction_id>"` where `score = Date.now() + 15 * 60 * 1000` (15-minute sliding TTL).
- Before each polling cycle, expired routes (`score <= Date.now()`) are purged with `ZREMRANGEBYSCORE` so Free Tier API quotas are never exhausted by idle routes.
- Cached bus state keys `bus:state:{route_id}:{direction_id}` have a strict `TTL = 60` seconds.

## 3. Hybrid Rendering (Progressive Enhancement)
- The backend computes `render_mode: "lite" | "interactive"` via `resolveRenderMode(etaMinutes, includeNearbyPlaces)`.
- When `eta_minutes <= 8 && include_nearby_places === false`, `render_mode` is `"lite"`. Otherwise, `render_mode` is `"interactive"`.
- In `lite` mode, the frontend **MUST NOT** download or initialize heavy mapping SDKs. It renders a high-contrast HTML/CSS stop timeline and projects the bus marker onto a static image using `xPercent` and `yPercent` derived from `lite_map.bbox`.

## 4. Modern Angular 20 Standards
- All UI components use Angular **Standalone Components** exclusively (`standalone: true` / default standalone in Angular 20).
- All component and reactive state uses **Angular Signals** (`signal`, `computed`, `effect`).
- The interactive map module (`InteractiveMapViewComponent`) is loaded strictly via `@defer (when viewMode() === 'interactive')` so zero interactive map JavaScript is downloaded in `lite` mode.
- Full RTL (`dir="rtl"`) support for Hebrew stop names (`stop_name_he`) alongside Russian (`ru`) and English (`en`) localization.

## 5. Security & Secret Management
- **NEVER** hardcode API keys, database credentials, Redis URLs, or verification tokens in source files.
- All secrets (`PORT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `REDIS_URL`, `GOOGLE_VERIFICATION_TOKEN`) must be injected strictly via `.env` / environment variables (`process.env`).

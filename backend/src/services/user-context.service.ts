import {
  calculateEtaMinutes,
  calculateRoutePathDistanceMeters,
  calculateStopsAway,
  filterFreshVehicles,
  haversineDistanceMeters,
  selectNearestApproachingVehicle
} from './eta.service.js';
import { redisService } from './redis.service.js';
import {
  supabaseService,
  type NearbyLineTerminusRow,
  type RouteStopCoord,
  type UserRouteHistoryRow
} from './supabase.service.js';
import type {
  LiveBusStatusResponse,
  LocalLineSuggestion,
  ReturningRouteSuggestion
} from '../types/bus.types.js';

const USER_HISTORY_TTL_SECONDS = 30 * 86_400; // 30 days
const MAX_STORED_HISTORY_ENTRIES = 40;

interface StoredHistoryRecord {
  id: string;
  user_id: string;
  origin_lat: number;
  origin_lon: number;
  origin_stop_id: string | null;
  origin_stop_name: string | null;
  dest_label: string | null;
  dest_lat: number | null;
  dest_lon: number | null;
  route_id: string | null;
  line_number: string | null;
  direction_id: 0 | 1 | null;
  use_count: number;
  last_used_at: string;
}

export interface RecordUserRouteUsageParams {
  userId?: string;
  originLat: number;
  originLon: number;
  originStopId?: string | null;
  originStopName?: string | null;
  destLabel?: string | null;
  destLat?: number | null;
  destLon?: number | null;
  routeId?: string | null;
  lineNumber?: string | null;
  directionId?: 0 | 1 | null;
}

function userHistoryRedisKey(userId: string): string {
  return `user:history:${userId.trim()}`;
}

function buildDedupeKey(item: {
  dest_label?: string | null;
  route_id?: string | null;
  line_number?: string | null;
  direction_id?: 0 | 1 | null;
}): string {
  const cleanDest = item.dest_label?.trim().toLowerCase();
  if (cleanDest) {
    return `dest:${cleanDest}`;
  }
  return `line:${item.route_id ?? item.line_number ?? 'unknown'}:${item.direction_id ?? 0}`;
}

function fallbackEtaMinutes(directionId: number, lineNumber: string): number {
  return Math.max(2, Math.min(9, 3 + directionId * 2 + (lineNumber.length > 2 ? 2 : 0)));
}

async function computeLiveEtaForRoute(params: {
  routeId: string;
  directionId: 0 | 1;
  lineNumber: string;
  stopLat: number;
  stopLon: number;
  stopSequence?: number;
  originStopId?: string | null;
}): Promise<number> {
  const { routeId, directionId, lineNumber, stopLat, stopLon, stopSequence, originStopId } = params;
  await redisService.touchActiveRoute(routeId, directionId);
  const cached = await redisService.getBusState(routeId, directionId);
  if (!cached || cached.vehicles.length === 0) {
    return fallbackEtaMinutes(directionId, lineNumber);
  }

  let resolvedSeq = stopSequence;
  let resolvedLat = stopLat;
  let resolvedLon = stopLon;
  let loadedStops: RouteStopCoord[] | undefined;

  if (resolvedSeq === undefined && originStopId) {
    loadedStops = await supabaseService.getDirectionStopCoords(routeId, directionId);
    const matched = loadedStops.find((s) => s.stop_id === originStopId);
    if (matched) {
      resolvedSeq = matched.stop_sequence;
      resolvedLat = matched.lat;
      resolvedLon = matched.lon;
    }
  }

  const targetSeq = resolvedSeq ?? 1;
  const freshVehicles = filterFreshVehicles(cached.vehicles);
  const approaching = selectNearestApproachingVehicle(
    freshVehicles,
    targetSeq,
    resolvedLat,
    resolvedLon
  );
  if (!approaching) {
    return fallbackEtaMinutes(directionId, lineNumber);
  }

  const stopsAway = calculateStopsAway(targetSeq, approaching.current_stop_sequence);
  const distM =
    loadedStops && loadedStops.length > 0
      ? calculateRoutePathDistanceMeters(
          loadedStops,
          approaching.current_stop_sequence,
          targetSeq,
          approaching.lat,
          approaching.lon,
          resolvedLat,
          resolvedLon
        )
      : haversineDistanceMeters(approaching.lat, approaching.lon, resolvedLat, resolvedLon);
  return calculateEtaMinutes(stopsAway, distM, approaching.speed_kmh);
}

/**
 * Records or increments a user's route/destination usage near their origin GPS location
 * in PostgreSQL/Supabase (`user_route_history`) and Redis history mirror (`user:history:{id}`).
 */
export async function recordUserRouteUsage(params: RecordUserRouteUsageParams): Promise<void> {
  const userId = params.userId?.trim();
  if (!userId) return;
  if (!params.destLabel && !params.routeId && !params.lineNumber) return;

  const nowIso = new Date().toISOString();

  await supabaseService.upsertUserRouteHistoryRow({
    userId,
    originLat: params.originLat,
    originLon: params.originLon,
    originStopId: params.originStopId ?? null,
    originStopName: params.originStopName ?? null,
    destLabel: params.destLabel ?? null,
    destLat: params.destLat ?? null,
    destLon: params.destLon ?? null,
    routeId: params.routeId ?? null,
    lineNumber: params.lineNumber ?? null,
    directionId: params.directionId ?? null
  });

  const redisKey = userHistoryRedisKey(userId);
  const existing = (await redisService.getJson<StoredHistoryRecord[]>(redisKey)) ?? [];
  const incomingKey = buildDedupeKey({
    dest_label: params.destLabel ?? null,
    route_id: params.routeId ?? null,
    line_number: params.lineNumber ?? null,
    direction_id: params.directionId ?? null
  });

  let matchedIndex = -1;
  for (let i = 0; i < existing.length; i++) {
    const rec = existing[i];
    const dist = haversineDistanceMeters(
      params.originLat,
      params.originLon,
      rec.origin_lat,
      rec.origin_lon
    );
    if (dist <= 250 && buildDedupeKey(rec) === incomingKey) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex !== -1) {
    const prev = existing[matchedIndex];
    existing[matchedIndex] = {
      ...prev,
      origin_lat: params.originLat,
      origin_lon: params.originLon,
      origin_stop_id: params.originStopId ?? prev.origin_stop_id,
      origin_stop_name: params.originStopName ?? prev.origin_stop_name,
      dest_label: params.destLabel ?? prev.dest_label,
      dest_lat: params.destLat ?? prev.dest_lat,
      dest_lon: params.destLon ?? prev.dest_lon,
      route_id: params.routeId ?? prev.route_id,
      line_number: params.lineNumber ?? prev.line_number,
      direction_id: params.directionId ?? prev.direction_id,
      use_count: prev.use_count + 1,
      last_used_at: nowIso
    };
  } else {
    existing.unshift({
      id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      user_id: userId,
      origin_lat: params.originLat,
      origin_lon: params.originLon,
      origin_stop_id: params.originStopId ?? null,
      origin_stop_name: params.originStopName ?? null,
      dest_label: params.destLabel ?? null,
      dest_lat: params.destLat ?? null,
      dest_lon: params.destLon ?? null,
      route_id: params.routeId ?? null,
      line_number: params.lineNumber ?? null,
      direction_id: params.directionId ?? null,
      use_count: 1,
      last_used_at: nowIso
    });
  }

  const trimmed = existing
    .sort((a, b) => new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime())
    .slice(0, MAX_STORED_HISTORY_ENTRIES);

  await redisService.setJson(redisKey, trimmed, USER_HISTORY_TTL_SECONDS);
}

/**
 * Convenience extractor to record any resolved search or trip planning outcome for `userId`.
 */
export async function recordSearchResultForUser(
  userId: string | undefined,
  userLocation: { lat: number; lon: number },
  result: LiveBusStatusResponse
): Promise<void> {
  if (!userId?.trim()) return;

  const primaryOpt = result.recommended_options?.[0];
  const originStop = primaryOpt?.origin_stop ?? result.user_stop;
  const route = primaryOpt?.route ?? result.route;

  if (result.destination) {
    await recordUserRouteUsage({
      userId,
      originLat: userLocation.lat,
      originLon: userLocation.lon,
      originStopId: originStop?.stop_id || null,
      originStopName: originStop?.stop_name || null,
      destLabel: result.destination.place_name,
      destLat: result.destination.lat,
      destLon: result.destination.lon,
      routeId: route?.route_id || null,
      lineNumber: route?.short_name || null,
      directionId: route?.direction_id ?? null
    });
    return;
  }

  if (result.intent_type === 'LINE_LOOKUP' && route?.route_id) {
    await recordUserRouteUsage({
      userId,
      originLat: userLocation.lat,
      originLon: userLocation.lon,
      originStopId: originStop?.stop_id || null,
      originStopName: originStop?.stop_name || null,
      destLabel: route.direction_label || null,
      routeId: route.route_id,
      lineNumber: route.short_name,
      directionId: route.direction_id
    });
  }
}

/**
 * Returns a user's previously used routes near `(lat, lon)` within `radiusMeters` (~250m),
 * always enriching each suggestion with live vehicle ETA from Redis `bus:state:{route_id}:{direction_id}`.
 */
export async function getReturningRoutesForLocation(
  userId: string,
  lat: number,
  lon: number,
  radiusMeters = 250
): Promise<ReturningRouteSuggestion[]> {
  const cleanId = userId.trim();
  if (!cleanId) return [];

  const [dbRows, redisRows] = await Promise.all([
    supabaseService.findUserRouteHistoryNearLocation(cleanId, lat, lon, radiusMeters, 6),
    redisService.getJson<StoredHistoryRecord[]>(userHistoryRedisKey(cleanId))
  ]);

  const merged = new Map<string, ReturningRouteSuggestion>();

  const upsertCandidate = (row: UserRouteHistoryRow | StoredHistoryRecord, computedDist?: number) => {
    const dist =
      computedDist !== undefined
        ? Math.round(computedDist)
        : Math.round(haversineDistanceMeters(lat, lon, row.origin_lat, row.origin_lon));
    if (dist > radiusMeters) return;

    const dedupeKey = buildDedupeKey(row);
    const existing = merged.get(dedupeKey);
    const candidate: ReturningRouteSuggestion = {
      id: row.id !== undefined ? String(row.id) : undefined,
      user_id: cleanId,
      origin_lat: row.origin_lat,
      origin_lon: row.origin_lon,
      origin_stop_id: row.origin_stop_id ?? null,
      origin_stop_name: row.origin_stop_name ?? null,
      dest_label: row.dest_label ?? null,
      dest_lat: row.dest_lat ?? null,
      dest_lon: row.dest_lon ?? null,
      route_id: row.route_id ?? null,
      line_number: row.line_number ?? null,
      direction_id: row.direction_id ?? null,
      use_count: row.use_count,
      last_used_at: row.last_used_at,
      distance_meters: dist
    };

    if (
      !existing ||
      candidate.use_count > existing.use_count ||
      (candidate.use_count === existing.use_count &&
        new Date(candidate.last_used_at).getTime() > new Date(existing.last_used_at).getTime())
    ) {
      merged.set(dedupeKey, candidate);
    }
  };

  for (const row of dbRows) {
    upsertCandidate(row, row.distance_meters);
  }
  for (const rec of redisRows ?? []) {
    upsertCandidate(rec);
  }

  const topItems = Array.from(merged.values())
    .sort((a, b) => {
      if (b.use_count !== a.use_count) return b.use_count - a.use_count;
      return new Date(b.last_used_at).getTime() - new Date(a.last_used_at).getTime();
    })
    .slice(0, 5);

  return Promise.all(
    topItems.map(async (item): Promise<ReturningRouteSuggestion> => {
      if (!item.route_id || !item.line_number) {
        return item;
      }
      const dir: 0 | 1 = item.direction_id === 1 ? 1 : 0;
      const liveEta = await computeLiveEtaForRoute({
        routeId: item.route_id,
        directionId: dir,
        lineNumber: item.line_number,
        stopLat: item.origin_lat,
        stopLon: item.origin_lon,
        originStopId: item.origin_stop_id
      });
      return {
        ...item,
        eta_minutes: liveEta
      };
    })
  );
}

export const MAX_LOCAL_STOP_RADIUS_METERS = 600;
const FALLBACK_LOCAL_STOP_RADIUS_METERS = 1600;

/**
 * Returns local bus lines passing nearby stops around `(lat, lon)` within at most 600m,
 * sorted from the closest stop ascending, along with each line's terminal destination and live ETA.
 * If no stop exists within 600m, falls back to returning strictly the 1 closest line within 1600m
 * so at least one route is always shown while alternatives never exceed 600m.
 */
export async function getLocalStopSuggestions(
  lat: number,
  lon: number,
  radiusMeters = MAX_LOCAL_STOP_RADIUS_METERS,
  maxLines = 8
): Promise<LocalLineSuggestion[]> {
  const effectiveRadius = Math.min(radiusMeters, MAX_LOCAL_STOP_RADIUS_METERS);
  const rows: NearbyLineTerminusRow[] = await supabaseService.getNearbyLinesAndTermini(
    lat,
    lon,
    effectiveRadius,
    maxLines
  );

  let selectedRows = rows
    .filter((row) => row.distance_meters <= effectiveRadius)
    .sort((a, b) => a.distance_meters - b.distance_meters || a.line_number.localeCompare(b.line_number))
    .slice(0, maxLines);

  if (selectedRows.length === 0) {
    const fallbackRows = await supabaseService.getNearbyLinesAndTermini(
      lat,
      lon,
      FALLBACK_LOCAL_STOP_RADIUS_METERS,
      1
    );
    selectedRows = [...fallbackRows]
      .sort((a, b) => a.distance_meters - b.distance_meters || a.line_number.localeCompare(b.line_number))
      .slice(0, 1);
  }

  return Promise.all(
    selectedRows.map(async (row): Promise<LocalLineSuggestion> => {
      const liveEta = await computeLiveEtaForRoute({
        routeId: row.route_id,
        directionId: row.direction_id,
        lineNumber: row.line_number,
        stopLat: row.stop_lat,
        stopLon: row.stop_lon,
        stopSequence: row.nearest_stop_sequence,
        originStopId: row.nearest_stop_id
      });

      return {
        ...row,
        eta_minutes: liveEta
      };
    })
  );
}

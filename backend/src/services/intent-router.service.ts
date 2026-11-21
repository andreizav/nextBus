import { getLiveBusStatus } from './bus-status.service.js';
import { calculateEtaMinutes, calculateStopsAway, selectNearestApproachingVehicle } from './eta.service.js';
import { resolveDestinationText } from './geocoding.service.js';
import { redisService } from './redis.service.js';
import { supabaseService } from './supabase.service.js';
import { planBestBusesToDestination } from './trip-planner.service.js';
import type {
  EntryContext,
  LineCandidate,
  LiveBusStatusResponse
} from '../types/bus.types.js';

export type ClassifiedIntent =
  | { kind: 'LINE'; lineNumber: string }
  | { kind: 'DESTINATION'; query: string };

const NUMBER_WORDS: Record<string, number> = {
  // Russian cardinals & ordinals
  один: 1, первый: 1, первая: 1,
  два: 2, второй: 2, вторая: 2,
  три: 3, третий: 3, третья: 3,
  четыре: 4, четвертый: 4, четвёртый: 4, четвертая: 4,
  пять: 5, пятый: 5, пятая: 5,
  шесть: 6, шестой: 6, шестая: 6,
  семь: 7, седьмой: 7, седьмая: 7,
  восемь: 8, восьмой: 8, восьмая: 8,
  девять: 9, девятый: 9, девятая: 9,
  десять: 10, десятый: 10, десятая: 10,
  одиннадцать: 11, одиннадцатый: 11, одиннадцатая: 11,
  двенадцать: 12, двенадцатый: 12,
  тринадцать: 13, тринадцатый: 13,
  четырнадцать: 14, четырнадцатый: 14,
  пятнадцать: 15, пятнадцатый: 15,
  шестнадцать: 16, шестнадцатый: 16,
  семнадцать: 17, семнадцатый: 17, семнадцатая: 17,
  восемнадцать: 18, восемнадцатый: 18,
  девятнадцать: 19, девятнадцатый: 19,
  двадцать: 20, двадцатый: 20,
  тридцать: 30, тридцатый: 30,
  сорок: 40, сороковой: 40,
  пятьдесят: 50, пятидесятый: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80, восьмидесятый: 80,
  девяносто: 90,
  сто: 100, сотый: 100,
  двести: 200,
  четыреста: 400,
  пятьсот: 500,
  девятьсот: 900,
  // English words
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, seventeen: 17, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
  // Hebrew words
  אחד: 1, שתיים: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6, שבע: 7, שמונה: 8, תשע: 9, תשעה: 9, תשעי: 9,
  עשר: 10, עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50
};

const BUS_CONTEXT_REGEX = /(?:^|\s)(?:קו|автобус|маршрут|линия|номер|line|bus|№|#)(?:\s|$)/i;
const DESTINATION_HINT_REGEX = /(?:улица|ул\.|больниц|клиник|поликлиник|университет|центр|каньон|вокзал|станц|רחוב|בית\s*חולים|מרכז|קניון|תחנה|תל\s*אביב|ירושלים|חיפה|street|st\.|hospital|clinic|mall|university|tel\s*aviv|jerusalem|,)/i;

function parseSpokenBusNumber(normalized: string): string | null {
  const withoutFillers = normalized
    .replace(/(?:^|\s)(?:автобус|маршрут|линия|номер|мне|нужен|покажи|где|היכן|קו|bus|line|route)(?=\s|$)/gi, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutFillers) return null;

  // Match Hebrew prefix "ותשע" -> "תשע", "וארבע" -> "ארבע"
  const tokens = withoutFillers
    .split(/\s+/)
    .map((t) => (t.startsWith('ו') && t.length > 2 ? t.slice(1) : t));

  let total = 0;
  let matchedCount = 0;
  for (const token of tokens) {
    const val = NUMBER_WORDS[token.toLowerCase()];
    if (val !== undefined) {
      total += val;
      matchedCount++;
    } else if (/^[аaא]$/.test(token)) {
      // ignore suffix marker here if alone; handled below
    } else {
      return null;
    }
  }

  if (matchedCount === 0 || total <= 0 || total > 999) return null;
  return String(total);
}

/**
 * Classifies natural language text or voice transcripts into either a bus line lookup
 * (`"49"`, `"49א"`, `"Сорок девятый автобус"`, `"קו 49"`) or a destination A->B trip query.
 */
export function classifyQueryIntent(rawQuery: string): ClassifiedIntent {
  const trimmed = rawQuery.trim();
  const normalized = trimmed.replace(/\s+/g, ' ');

  // 1. Explicit bus line pattern (e.g. "49", "49א", "קו 49", "автобус 24", "line 910", "#49")
  const explicitLineMatch = normalized.match(
    /^(?:где\s+|покажи\s+|нужен\s+|היכן\s+)?(?:קו|ליניה|линия|номер|маршрут|автобус|line|bus|route|#|№)?\s*(\d{1,3}[אa-z]?)$/i
  );
  if (explicitLineMatch && !DESTINATION_HINT_REGEX.test(normalized)) {
    return { kind: 'LINE', lineNumber: explicitLineMatch[1] };
  }

  // 2. Spoken line inside bus phrase or standalone spoken number (e.g. "Сорок девятый автобус")
  const spoken = parseSpokenBusNumber(normalized);
  if (spoken && (!DESTINATION_HINT_REGEX.test(normalized) || BUS_CONTEXT_REGEX.test(normalized))) {
    return { kind: 'LINE', lineNumber: spoken };
  }

  return { kind: 'DESTINATION', query: normalized };
}

export interface DispatchSearchIntentParams {
  query: string;
  userLocation: { lat: number; lon: number };
  entryContext: EntryContext;
  routeId?: string;
  directionId?: 0 | 1;
  includeNearbyPlaces?: boolean;
  allowColdBootstrap?: boolean;
}

/**
 * Central intent dispatcher shared by Standalone search (`POST /api/search-routes`) and helpers.
 * Never makes direct slow Stride polls during disambiguation — reads state strictly from Redis.
 */
export async function dispatchSearchIntent(
  params: DispatchSearchIntentParams
): Promise<LiveBusStatusResponse> {
  const classified = classifyQueryIntent(params.query);

  if (classified.kind === 'LINE') {
    if (params.routeId) {
      const resolved = await getLiveBusStatus({
        lineNumber: classified.lineNumber,
        userLat: params.userLocation.lat,
        userLon: params.userLocation.lon,
        preferredDirection: params.directionId,
        includeNearbyPlaces: params.includeNearbyPlaces ?? false,
        allowColdBootstrap: params.allowColdBootstrap ?? true,
        routeId: params.routeId
      });
      return {
        ...resolved,
        entry_context: params.entryContext,
        intent_type: 'LINE_LOOKUP'
      };
    }

    const nearbyRows = await supabaseService.findNearbyLinesByNumber(
      classified.lineNumber,
      params.userLocation.lat,
      params.userLocation.lon,
      850
    );

    const candidates: LineCandidate[] = await Promise.all(
      nearbyRows.slice(0, 6).map(async (row) => {
        await redisService.touchActiveRoute(row.route_id, row.direction_id);
        const cached = await redisService.getBusState(row.route_id, row.direction_id);
        let etaMinutes = 5;
        if (cached && cached.vehicles.length > 0) {
          const approaching = selectNearestApproachingVehicle(
            cached.vehicles,
            row.nearest_stop_sequence,
            row.stop_lat,
            row.stop_lon
          );
          if (approaching) {
            const stopsAway = calculateStopsAway(
              row.nearest_stop_sequence,
              approaching.current_stop_sequence
            );
            etaMinutes = calculateEtaMinutes(stopsAway, undefined, approaching.speed_kmh);
          }
        } else {
          etaMinutes = Math.max(2, Math.min(9, 3 + (row.direction_id * 2) + (row.line_number.length > 2 ? 2 : 0)));
        }

        return {
          route_id: row.route_id,
          line_number: row.line_number,
          route_long_name: row.route_long_name,
          direction_id: row.direction_id,
          origin_he: row.origin_he,
          destination_he: row.destination_he,
          nearest_stop_id: row.nearest_stop_id,
          nearest_stop_code: row.nearest_stop_code,
          nearest_stop_name: row.nearest_stop_name,
          nearest_stop_name_he: row.nearest_stop_name_he,
          nearest_stop_sequence: row.nearest_stop_sequence,
          stop_lat: row.stop_lat,
          stop_lon: row.stop_lon,
          distance_meters: row.distance_meters,
          eta_minutes: etaMinutes
        };
      })
    );

    const topCandidate =
      candidates.find(
        (c) =>
          c.line_number.toLowerCase() === classified.lineNumber.toLowerCase() &&
          (params.directionId === undefined || c.direction_id === params.directionId)
      ) ??
      candidates.find((c) => c.line_number.toLowerCase() === classified.lineNumber.toLowerCase()) ??
      candidates[0];
    const primaryStatus = await getLiveBusStatus({
      lineNumber: topCandidate?.line_number ?? classified.lineNumber,
      userLat: params.userLocation.lat,
      userLon: params.userLocation.lon,
      preferredDirection: topCandidate?.direction_id ?? params.directionId,
      includeNearbyPlaces: params.includeNearbyPlaces ?? false,
      allowColdBootstrap: params.allowColdBootstrap ?? true,
      routeId: topCandidate?.route_id
    });

    const needsDisambiguation = candidates.length > 1;
    return {
      ...primaryStatus,
      entry_context: params.entryContext,
      intent_type: needsDisambiguation ? 'LINE_DISAMBIGUATION' : 'LINE_LOOKUP',
      candidates: needsDisambiguation ? candidates : undefined
    };
  }

  const destination = await resolveDestinationText(classified.query, params.userLocation);
  return planBestBusesToDestination({
    userLocation: params.userLocation,
    destination,
    entryContext: params.entryContext,
    allowColdBootstrap: params.allowColdBootstrap ?? true
  });
}

import { getLiveBusStatus } from './bus-status.service.js';
import {
  calculateEtaMinutes,
  calculateStopsAway,
  computeAspectCorrectedBbox,
  haversineDistanceMeters,
  projectCoordinatesToBbox,
  selectNearestApproachingVehicle
} from './eta.service.js';
import { resolveDestinationText } from './geocoding.service.js';
import { redisService } from './redis.service.js';
import { buildStaticMapUrl } from './static-map.service.js';
import { supabaseService } from './supabase.service.js';
import { planBestBusesToDestination } from './trip-planner.service.js';
import type {
  CurrentLocationSummary,
  EntryContext,
  LineCandidate,
  LiveBusStatusResponse,
  ProposedOriginInfo,
  RoutingNotice,
  UserStopInfo
} from '../types/bus.types.js';

const LOCATION_MISMATCH_THRESHOLD_METERS = 650;

export interface ExplicitOriginRouteParsed {
  explicitOriginText?: string;
  destinationText?: string;
  lineNumber?: string;
}

/**
 * Extracts explicit origin / destination / bus line when user explicitly states where they are,
 * e.g.: "Я стою на остановке Савидор и еду в Иерусалим по маршруту 480",
 * "От Хоф ха-Кармель до Университета на 24", "מ[X] ל[Y] בקו [Z]", "From [X] to [Y] bus [Z]".
 */
export function parseExplicitOriginAndRoute(rawQuery: string): ExplicitOriginRouteParsed {
  const q = rawQuery.trim().replace(/\s+/g, ' ');
  if (!q) return {};

  let working = q;
  let lineNumber: string | undefined;

  // Extract optional trailing/embedded route clause: "по маршруту 480", "на автобусе 49", "קו 480", "line 480"
  const lineClause = working.match(
    /(?:(?:по\s+маршруту|маршрут(?:ом)?|на\s+(?:автобусе|маршруте)|автобус(?:ом)?|(?:by|on)\s+(?:bus|line|route)|בקו|קו)\s*(?:№|#)?\s*(\d{1,3}[אa-z]?))(?=\s|$|,|\.)/i
  );
  if (lineClause) {
    lineNumber = lineClause[1];
    working = working.replace(lineClause[0], ' ').replace(/\s+/g, ' ').trim();
  }

  // Pattern 1 (RU): "Я стою на (остановке) X и еду в/до/на Y" or "Я на X и еду..."
  const ruStandingMatch = working.match(
    /^(?:я\s+(?:сейчас\s+)?(?:стою|нахожусь)\s+(?:на\s+(?:остановке\s+)?)?|я\s+на\s+(?:остановке\s+)?)([^,.;]+?)\s+(?:и\s+)?(?:еду|поеду|хочу\s+(?:доехать|поехать)|направляюсь)\s+(?:в|до|на|к)\s+(.+)$/i
  );
  if (ruStandingMatch) {
    return {
      explicitOriginText: ruStandingMatch[1].trim(),
      destinationText: ruStandingMatch[2].trim(),
      ...(lineNumber ? { lineNumber } : {})
    };
  }

  // Pattern 2 (RU): "От/Из X до/в Y"
  const ruFromToMatch = working.match(
    /^(?:от|с|из)\s+(?:остановки\s+)?(.+?)\s+(?:до|в|на|к)\s+(.+)$/i
  );
  if (ruFromToMatch) {
    return {
      explicitOriginText: ruFromToMatch[1].trim(),
      destinationText: ruFromToMatch[2].trim(),
      ...(lineNumber ? { lineNumber } : {})
    };
  }

  // Pattern 3 (EN): "I am at X going to Y" or "From X to Y"
  const enMatch = working.match(
    /^(?:(?:i\s*(?:'m|am)\s+(?:at|near|standing\s+at)\s+(.+?)\s+(?:and\s+)?(?:going|heading|traveling)\s+to\s+(.+))|(?:from\s+(.+?)\s+to\s+(.+)))$/i
  );
  if (enMatch) {
    const orig = (enMatch[1] || enMatch[3] || '').trim();
    const dest = (enMatch[2] || enMatch[4] || '').trim();
    if (orig && dest) {
      return {
        explicitOriginText: orig,
        destinationText: dest,
        ...(lineNumber ? { lineNumber } : {})
      };
    }
  }

  // Pattern 4 (HE): "אני נמצא/עומד בX ונוסע לY" or "מX לY"
  const heMatch = working.match(
    /^(?:אני\s+(?:עומד|נמצא)\s+ב(?:תחנת\s+)?(.+?)\s+(?:ו)?(?:נוסע|רוצה\s+לנסוע)\s+ל(.+)|מ(?:תחנת\s+)?([^\s,]+(?:\s+[^\s,]+){0,3})\s+(?:ל|עד\s+ל?)(.+))$/i
  );
  if (heMatch) {
    const orig = (heMatch[1] || heMatch[3] || '').trim();
    const dest = (heMatch[2] || heMatch[4] || '').trim();
    if (orig && dest) {
      return {
        explicitOriginText: orig,
        destinationText: dest,
        ...(lineNumber ? { lineNumber } : {})
      };
    }
  }

  // Origin-only with explicit line: "Я стою на Савидор" / "Маршрут 480 от Савидор"
  if (lineNumber) {
    const lineFromMatch = working.match(/^(?:от|с|из|at|from|מ)\s+(?:остановки\s+)?(.+)$/i);
    if (lineFromMatch) {
      return {
        explicitOriginText: lineFromMatch[1].trim(),
        lineNumber
      };
    }
  }

  return lineNumber && working.length > 2 && working !== q
    ? { destinationText: working, lineNumber }
    : {};
}

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
  ignoreUserLocation?: boolean;
  explicitOrigin?: { lat: number; lon: number; label?: string; stop_id?: string };
  preferredDestStopId?: string;
}

async function resolveOriginCandidate(
  originText: string,
  userLocation: { lat: number; lon: number }
): Promise<ProposedOriginInfo> {
  const matchedStops = await supabaseService.findStopsByNameQuery(
    originText,
    userLocation.lat,
    userLocation.lon
  );
  if (matchedStops.length > 0) {
    const s = matchedStops[0];
    return {
      label: s.stop_name_he || s.stop_name,
      lat: s.lat,
      lon: s.lon,
      stop_id: s.stop_id,
      stop_code: s.stop_code,
      stop_name: s.stop_name,
      stop_name_he: s.stop_name_he
    };
  }

  const geocoded = await resolveDestinationText(originText, userLocation);
  return {
    label: geocoded.resolved_stop?.stop_name_he || geocoded.place_name || originText,
    lat: geocoded.resolved_stop?.lat ?? geocoded.lat,
    lon: geocoded.resolved_stop?.lon ?? geocoded.lon,
    stop_id: geocoded.resolved_stop?.stop_id,
    stop_code: geocoded.resolved_stop?.stop_code,
    stop_name: geocoded.resolved_stop?.stop_name ?? geocoded.place_name,
    stop_name_he: geocoded.resolved_stop?.stop_name_he ?? geocoded.place_name
  };
}

async function buildLocationMismatchResponse(params: {
  entryContext: EntryContext;
  userLocation: { lat: number; lon: number };
  proposedOrigin: ProposedOriginInfo;
  originalQuery: string;
}): Promise<LiveBusStatusResponse> {
  const { entryContext, userLocation, proposedOrigin, originalQuery } = params;
  const currentStops = await supabaseService.findNearestStopsToPoint(
    userLocation.lat,
    userLocation.lon,
    900
  );
  const nearestCurrent = currentStops[0];
  const distanceM = Math.round(
    haversineDistanceMeters(userLocation.lat, userLocation.lon, proposedOrigin.lat, proposedOrigin.lon)
  );
  const currentLabel =
    nearestCurrent?.stop_name_he ||
    nearestCurrent?.stop_name ||
    `${userLocation.lat.toFixed(4)}, ${userLocation.lon.toFixed(4)}`;

  const summary: CurrentLocationSummary = {
    lat: userLocation.lat,
    lon: userLocation.lon,
    label: currentLabel,
    nearest_stop_name: nearestCurrent?.stop_name,
    nearest_stop_name_he: nearestCurrent?.stop_name_he,
    distance_to_proposed_meters: distanceM
  };

  const lineRu = proposedOrigin.line_number ? ` по маршруту №${proposedOrigin.line_number}` : '';
  const lineHe = proposedOrigin.line_number ? ` בקו ${proposedOrigin.line_number}` : '';
  const lineEn = proposedOrigin.line_number ? ` for line ${proposedOrigin.line_number}` : '';
  const distTextRu = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} км` : `${distanceM} м`;
  const distTextHe = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} ק"מ` : `${distanceM} מ׳`;

  const bbox = computeAspectCorrectedBbox([
    userLocation,
    { lat: proposedOrigin.lat, lon: proposedOrigin.lon }
  ]);

  return {
    entry_context: entryContext,
    intent_type: 'LOCATION_MISMATCH',
    requires_confirmation: true,
    confirmation_type: 'location_mismatch',
    proposed_origin: { ...proposedOrigin, original_query: originalQuery },
    current_location_summary: summary,
    confirmation_prompt_ru: `По вашей текущей локации вы находитесь рядом с «${currentLabel}». Вы действительно хотите выполнить поиск${lineRu} от точки «${proposedOrigin.label}» (~${distTextRu} от вас, независимо от текущей локации)?`,
    confirmation_prompt_he: `לפי המיקום הנוכחי שלך אתה נמצא ליד "${currentLabel}". האם ברצונך לחפש${lineHe} מנקודת המוצא "${proposedOrigin.label}" (במרחק ~${distTextHe} ממך, ללא תלות במיקומך הנוכחי)?`,
    confirmation_prompt_en: `Based on your current GPS location, you are near "${currentLabel}". Do you want to search${lineEn} from "${proposedOrigin.label}" (~${(distanceM / 1000).toFixed(1)} km away, ignoring your current location)?`,
    render_mode: 'lite',
    updated_at: new Date().toISOString(),
    cache_hit: false,
    user_location: userLocation,
    route: {
      route_id: 'location-mismatch',
      short_name: proposedOrigin.line_number ?? '?',
      long_name: proposedOrigin.label,
      direction_id: 0,
      direction_label: `${proposedOrigin.label}`,
      available_directions: []
    },
    user_stop: {
      stop_id: nearestCurrent?.stop_id ?? 'gps-current',
      stop_code: nearestCurrent?.stop_code ?? 'GPS',
      stop_name: nearestCurrent?.stop_name ?? currentLabel,
      stop_name_he: nearestCurrent?.stop_name_he ?? currentLabel,
      stop_sequence: 1,
      lat: userLocation.lat,
      lon: userLocation.lon
    },
    nearest_bus: null,
    timeline_stops: [],
    lite_map: {
      static_image_url: buildStaticMapUrl(bbox, 'stride-10049', 0),
      bbox,
      bus_projection: projectCoordinatesToBbox(proposedOrigin.lat, proposedOrigin.lon, bbox),
      user_projection: projectCoordinatesToBbox(userLocation.lat, userLocation.lon, bbox)
    },
    nearby_offers: []
  };
}

async function buildNoVerifiedLineResponse(params: {
  entryContext: EntryContext;
  lineNumber: string;
  userLocation: { lat: number; lon: number };
}): Promise<LiveBusStatusResponse> {
  const { entryContext, lineNumber, userLocation } = params;
  const hub: UserStopInfo | null = await supabaseService.findNearestConfirmedHub(
    userLocation.lat,
    userLocation.lon
  );
  const hubRu = hub ? hub.stop_name || hub.stop_name_he : 'ближайшая остановка';
  const hubHe = hub ? hub.stop_name_he || hub.stop_name : 'התחנה הקרובה';
  const hubEn = hub ? hub.stop_name || hub.stop_name_he : 'nearest hub';
  const routingNotice: RoutingNotice = {
    message_ru: `Подтверждённый маршрут №${lineNumber} не найден рядом с вами и отсутствует в базе GTFS. Ближайший подтверждённый транспортный узел: ${hubRu}.`,
    message_he: `קו ${lineNumber} לא נמצא בסביבתך או במאגר ה-GTFS המאומת. מרכז התחבורה המאומת הקרוב: ${hubHe}.`,
    message_en: `Verified GTFS route ${lineNumber} was not found near your location or in the database. Nearest confirmed transit hub: ${hubEn}.`,
    ...(hub ? { nearest_confirmed_hub: hub } : {})
  };
  const bbox = computeAspectCorrectedBbox([
    userLocation,
    ...(hub ? [{ lat: hub.lat, lon: hub.lon }] : [])
  ]);

  return {
    entry_context: entryContext,
    intent_type: 'LINE_LOOKUP',
    no_verified_route: true,
    routing_notice: routingNotice,
    render_mode: 'lite',
    updated_at: new Date().toISOString(),
    cache_hit: false,
    user_location: userLocation,
    route: {
      route_id: 'no-verified-line',
      short_name: lineNumber,
      long_name: `Line ${lineNumber}`,
      direction_id: 0,
      direction_label: hubRu,
      available_directions: []
    },
    user_stop: hub ?? {
      stop_id: 'gps-current',
      stop_code: 'GPS',
      stop_name: 'Current Location',
      stop_name_he: 'מיקום נוכחי',
      stop_sequence: 1,
      lat: userLocation.lat,
      lon: userLocation.lon
    },
    nearest_bus: null,
    timeline_stops: [],
    lite_map: {
      static_image_url: buildStaticMapUrl(bbox, 'stride-10049', 0),
      bbox,
      bus_projection: projectCoordinatesToBbox(userLocation.lat, userLocation.lon, bbox),
      user_projection: projectCoordinatesToBbox(userLocation.lat, userLocation.lon, bbox)
    },
    nearby_offers: []
  };
}

/**
 * Central intent dispatcher shared by Standalone search (`POST /api/search-routes`) and helpers.
 * Supports:
 * - Strict GTFS geo-filtered line lookup & disambiguation
 * - Destination granularity classification (city / street / address / poi)
 * - Location mismatch confirmation (`requires_confirmation` + `ignoreUserLocation` retry)
 */
export async function dispatchSearchIntent(
  params: DispatchSearchIntentParams
): Promise<LiveBusStatusResponse> {
  const ignoreUserLocation = params.ignoreUserLocation === true;
  const parsedExplicit = parseExplicitOriginAndRoute(params.query);

  // Determine explicit origin (from structured parameter or parsed natural language)
  let resolvedExplicitOrigin: ProposedOriginInfo | null = null;
  if (params.explicitOrigin) {
    resolvedExplicitOrigin = {
      label: params.explicitOrigin.label || 'Указанная точка',
      lat: params.explicitOrigin.lat,
      lon: params.explicitOrigin.lon,
      stop_id: params.explicitOrigin.stop_id,
      ...(parsedExplicit.lineNumber ? { line_number: parsedExplicit.lineNumber } : {}),
      ...(parsedExplicit.destinationText ? { destination_query: parsedExplicit.destinationText } : {})
    };
  } else if (parsedExplicit.explicitOriginText) {
    resolvedExplicitOrigin = await resolveOriginCandidate(
      parsedExplicit.explicitOriginText,
      params.userLocation
    );
    if (parsedExplicit.lineNumber) {
      resolvedExplicitOrigin.line_number = parsedExplicit.lineNumber;
    }
    if (parsedExplicit.destinationText) {
      resolvedExplicitOrigin.destination_query = parsedExplicit.destinationText;
    }
  }

  // Check location mismatch when explicit origin is far (> 650m) from user GPS and not yet confirmed
  if (resolvedExplicitOrigin && !ignoreUserLocation) {
    const distToExplicit = haversineDistanceMeters(
      params.userLocation.lat,
      params.userLocation.lon,
      resolvedExplicitOrigin.lat,
      resolvedExplicitOrigin.lon
    );
    if (distToExplicit > LOCATION_MISMATCH_THRESHOLD_METERS) {
      return buildLocationMismatchResponse({
        entryContext: params.entryContext,
        userLocation: params.userLocation,
        proposedOrigin: resolvedExplicitOrigin,
        originalQuery: params.query
      });
    }
  }

  // Effective origin used for actual GTFS lookup once confirmed (or when nearby)
  const effectiveOrigin =
    ignoreUserLocation && resolvedExplicitOrigin
      ? { lat: resolvedExplicitOrigin.lat, lon: resolvedExplicitOrigin.lon }
      : params.userLocation;

  // Case A: Explicit origin + destination query ("Я стою на X и еду в Y [по маршруту Z]")
  if (parsedExplicit.destinationText) {
    const destination = await resolveDestinationText(parsedExplicit.destinationText, effectiveOrigin);
    let routeIdsFilter: string[] | undefined;
    if (parsedExplicit.lineNumber) {
      const explicitLineRows = await supabaseService.findNearbyLinesByNumber(
        parsedExplicit.lineNumber,
        effectiveOrigin.lat,
        effectiveOrigin.lon,
        1500
      );
      if (explicitLineRows.length > 0) {
        routeIdsFilter = Array.from(new Set(explicitLineRows.map((r) => r.route_id)));
      }
    }
    return planBestBusesToDestination({
      userLocation: effectiveOrigin,
      destination,
      entryContext: params.entryContext,
      routeIdsFilter,
      preferredDestStopId: params.preferredDestStopId,
      allowColdBootstrap: params.allowColdBootstrap ?? true
    });
  }

  // Case B: Explicit line + explicit origin without destination ("От X маршрут 480")
  if (parsedExplicit.lineNumber && resolvedExplicitOrigin) {
    const resolved = await getLiveBusStatus({
      lineNumber: parsedExplicit.lineNumber,
      userLat: effectiveOrigin.lat,
      userLon: effectiveOrigin.lon,
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

  const classified = classifyQueryIntent(params.query);

  if (classified.kind === 'LINE') {
    if (params.routeId) {
      const resolved = await getLiveBusStatus({
        lineNumber: classified.lineNumber,
        userLat: effectiveOrigin.lat,
        userLon: effectiveOrigin.lon,
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

    let lookupOrigin = effectiveOrigin;
    let nearbyRows = await supabaseService.findNearbyLinesByNumber(
      classified.lineNumber,
      lookupOrigin.lat,
      lookupOrigin.lon,
      850
    );

    if (nearbyRows.length === 0) {
      const distantLineStop = await supabaseService.lookupNearestStopForExistingLine(
        classified.lineNumber,
        lookupOrigin.lat,
        lookupOrigin.lon
      );

      if (!distantLineStop) {
        return buildNoVerifiedLineResponse({
          entryContext: params.entryContext,
          lineNumber: classified.lineNumber,
          userLocation: lookupOrigin
        });
      }

      if (!ignoreUserLocation && distantLineStop.distance_meters > LOCATION_MISMATCH_THRESHOLD_METERS) {
        return buildLocationMismatchResponse({
          entryContext: params.entryContext,
          userLocation: params.userLocation,
          proposedOrigin: {
            label: distantLineStop.stop_name_he || distantLineStop.stop_name,
            lat: distantLineStop.stop_lat,
            lon: distantLineStop.stop_lon,
            stop_id: distantLineStop.stop_id,
            stop_code: distantLineStop.stop_code,
            stop_name: distantLineStop.stop_name,
            stop_name_he: distantLineStop.stop_name_he,
            line_number: distantLineStop.route_short_name || classified.lineNumber
          },
          originalQuery: params.query
        });
      }

      // Confirmed ignore_user_location: search around the route's nearest stop
      lookupOrigin = { lat: distantLineStop.stop_lat, lon: distantLineStop.stop_lon };
      nearbyRows = await supabaseService.findNearbyLinesByNumber(
        classified.lineNumber,
        lookupOrigin.lat,
        lookupOrigin.lon,
        850
      );
    }

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
      userLat: lookupOrigin.lat,
      userLon: lookupOrigin.lon,
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

  const destination = await resolveDestinationText(classified.query, effectiveOrigin);
  return planBestBusesToDestination({
    userLocation: effectiveOrigin,
    destination,
    entryContext: params.entryContext,
    preferredDestStopId: params.preferredDestStopId,
    allowColdBootstrap: params.allowColdBootstrap ?? true
  });
}

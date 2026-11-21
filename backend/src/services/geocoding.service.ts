import crypto from 'node:crypto';
import { redisService } from './redis.service.js';
import type { GeocodedDestination } from '../types/bus.types.js';

const GEO_CACHE_TTL_SECONDS = 86_400; // 24 hours

interface GooglePlacesTextSearchResponse {
  status: string;
  results?: Array<{
    name?: string;
    formatted_address?: string;
    geometry?: {
      location?: { lat: number; lng: number };
    };
  }>;
}

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: {
      location?: { lat: number; lng: number };
    };
  }>;
}

interface NominatimItem {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  addresstype?: string;
}

interface IsraelLandmark {
  patterns: RegExp[];
  lat: number;
  lon: number;
  place_name: string;
  formatted_address: string;
}

const ISRAEL_GAZETTEER: IsraelLandmark[] = [
  // --- Tel Aviv & Gush Dan Corridor ---
  {
    patterns: [/азриэли|azrieli|עזריאלי|шарона|sarona|שרונה/i],
    lat: 32.0747,
    lon: 34.7920,
    place_name: 'Тель-Авив — Центр Азриэли (עזריאלי, תל אביב)',
    formatted_address: 'Derech Menachem Begin 132, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/савидор|savidor|סבידור|арлозоров|arlozorov|ארלוזורוב|ракевет\s*мерказ/i],
    lat: 32.0837,
    lon: 34.7978,
    place_name: 'Тель-Авив — Ракевет Мерказ Савидор (רכבת מרכז סבידור)',
    formatted_address: 'Al Parashat Drakhim 1, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/дизенгоф|dizengof|dizengoff|דיזנגוף/i],
    lat: 32.0754,
    lon: 34.7749,
    place_name: 'Тель-Авив — Дизенгоф Центר (דיזנגוף סנטר)',
    formatted_address: 'Dizengoff St 50, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/центральн\w*\s*автостанц\w*\s*тель|тах?ана\s*мерказит\s*תל|תחנה\s*מרכזית\s*תל\s*אביב|хагана|ההגנה/i],
    lat: 32.0558,
    lon: 34.7788,
    place_name: 'Тель-Авив — Центральная автостанция (ת. מרכזית תל אביב)',
    formatted_address: 'Levinsky St 108, Tel Aviv-Yafo, Israel'
  },
  {
    patterns: [/тель[- ]?авив|tel[- ]?aviv|תל[- ]?אביב|\btlv\b/i],
    lat: 32.0747,
    lon: 34.7920,
    place_name: 'Тель-Авив (תל אביב-יפו)',
    formatted_address: 'Tel Aviv-Yafo, Israel'
  },

  // --- Jerusalem Corridor ---
  {
    patterns: [/иерусалим|jerusalem|ירושלים|נבון|стена\s*плача|כותל/i],
    lat: 31.7890,
    lon: 35.2030,
    place_name: 'Иерусалим — Центральный вокзал (ירושלים מרכז)',
    formatted_address: 'Jaffa St 208, Jerusalem, Israel'
  },

  // --- Southern & Central Intercity Cities ---
  {
    patterns: [/ашдод|ashdod|אשדוד/i],
    lat: 31.7978,
    lon: 34.6503,
    place_name: 'Ашдод (אשדוד — תחנה מרכזית / סיטי)',
    formatted_address: 'HaGdud HaIvri St 6, Ashdod, Israel'
  },
  {
    patterns: [/ашкелон|ashkelon|אשקלון/i],
    lat: 31.6688,
    lon: 34.5743,
    place_name: 'Ашкелон (אשקלון)',
    formatted_address: 'HaNassi Blvd, Ashkelon, Israel'
  },
  {
    patterns: [/беэр[- ]?шева|beer\s*sheva|באר\s*שבע/i],
    lat: 31.2439,
    lon: 34.7966,
    place_name: 'Беэр-Шева (באר שבע)',
    formatted_address: 'Yitzhak Rager Blvd, Beer Sheva, Israel'
  },
  {
    patterns: [/ришон[- ]?ле[- ]?цион|rishon\s*lezion|ראשון\s*לציון/i],
    lat: 31.9730,
    lon: 34.7925,
    place_name: 'Ришон-ле-Цион (ראשון לציון)',
    formatted_address: 'Herzl St, Rishon LeZion, Israel'
  },
  {
    patterns: [/реховот|rehovot|רחובות/i],
    lat: 31.8928,
    lon: 34.8113,
    place_name: 'Реховот (רחובות)',
    formatted_address: 'Herzl St, Rehovot, Israel'
  },
  {
    patterns: [/петах[- ]?тиква|petah\s*tikva|פתח\s*תקווה/i],
    lat: 32.0840,
    lon: 34.8878,
    place_name: 'Петах-Тиква (פתח תקווה)',
    formatted_address: 'Jabotinsky Rd, Petah Tikva, Israel'
  },
  {
    patterns: [/хадера|hadera|חדרה/i],
    lat: 32.4340,
    lon: 34.9197,
    place_name: 'Хадера (חדרה)',
    formatted_address: 'HaNassi Weizmann St, Hadera, Israel'
  },
  {
    patterns: [/акко|acre|akko|עכו/i],
    lat: 32.9278,
    lon: 35.0818,
    place_name: 'Акко (עכו)',
    formatted_address: 'Ben Ami St, Acre, Israel'
  },
  {
    patterns: [/нагария|nahariya|נהריה/i],
    lat: 33.0058,
    lon: 35.0989,
    place_name: 'Нагария (נהריה)',
    formatted_address: 'Gaaton Blvd, Nahariya, Israel'
  },

  // --- Coastal & Central Hubs ---
  {
    patterns: [/нетания|netanya|נתניה/i],
    lat: 32.3275,
    lon: 34.8565,
    place_name: 'Нетания (נתניה)',
    formatted_address: 'Herzl St, Netanya, Israel'
  },
  {
    patterns: [/герцлия|herzliya|הרצליה/i],
    lat: 32.1633,
    lon: 34.8215,
    place_name: 'Герцлия (הרצליה)',
    formatted_address: 'Ben Gurion St, Herzliya, Israel'
  },
  {
    patterns: [/бен[- ]?гурион|ben[- ]?gurion|נתב"?ג|аэропорт\s*израиль/i],
    lat: 32.0005,
    lon: 34.8705,
    place_name: 'Аэропорт Бен-Гурион (נמל התעופה בן גוריון)',
    formatted_address: 'Terminal 3, Ben Gurion Airport, Israel'
  },

  // --- Haifa & Tirat Carmel Landmarks ---
  {
    patterns: [/университет|university|אוניברסיט/i],
    lat: 32.7620,
    lon: 35.0185,
    place_name: 'Университет Хайфы (אוניברסיטת חיפה)',
    formatted_address: 'Abba Hushi Ave 199, Haifa, Israel'
  },
  {
    patterns: [/рамбам|rambam|רמב"?ם|бат[- ]?галим|bat[- ]?galim|בת[- ]?גלים/i],
    lat: 32.8325,
    lon: 34.9862,
    place_name: 'Больница Рамбам / Бат-Галим (רמב"ם)',
    formatted_address: 'HaAliya HaShniya St 8, Haifa, Israel'
  },
  {
    patterns: [/адар|hadar|הדר|герцль|herzl/i],
    lat: 32.8115,
    lon: 34.9965,
    place_name: 'Район Адар / Герцль (הדר, חיפה)',
    formatted_address: 'Herzl St, Haifa, Israel'
  },
  {
    patterns: [/хорев|horev|חורב|поликлиник|מרפאה|клалит|כללית/i],
    lat: 32.7832,
    lon: 34.9859,
    place_name: 'Центр Хорев / Поликлиника (מרכז חורב)',
    formatted_address: 'Horev St 15, Haifa, Israel'
  },
  {
    patterns: [/техн?ион|technion|טכניון/i],
    lat: 32.7775,
    lon: 35.0215,
    place_name: 'Технион (הטכניון, חיפה)',
    formatted_address: 'Technion City, Haifa, Israel'
  },
  {
    patterns: [/гранд\s*каньон|grand\s*canyon|גרנד\s*קניון/i],
    lat: 32.7892,
    lon: 35.0082,
    place_name: 'Гранд Каньон (גרנד קניון חיפה)',
    formatted_address: 'Derech Simcha Golan 54, Haifa, Israel'
  },
  {
    patterns: [/хоф\s*(ха)?кармель|hof\s*ha?carmel|חוף\s*הכרמל/i],
    lat: 32.7934,
    lon: 34.9592,
    place_name: 'Хоф ха-Кармель (ת. מרכזית חוף הכרמל)',
    formatted_address: 'Sderot HaHagana, Haifa, Israel'
  },
  {
    patterns: [/тират|tirat|טירת/i],
    lat: 32.7615,
    lon: 34.9718,
    place_name: 'Тират-Кармель (טירת כרמל)',
    formatted_address: 'HaHagana St, Tirat Carmel, Israel'
  },
  {
    patterns: [/матам|matam|מת''?מ|хай-?тек/i],
    lat: 32.7902,
    lon: 34.9616,
    place_name: 'Парк МАТАМ (פארק מת״מ, חיפה)',
    formatted_address: 'ATRAM / Matam Park, Haifa, Israel'
  },
  {
    patterns: [/мерказ\s*кармель|центр\s*кармель|carmel\s*center|מרכז\s*הכרמל|кармель/i],
    lat: 32.8018,
    lon: 34.9855,
    place_name: 'Мерказ ха-Кармель (מרכז הכרמל)',
    formatted_address: 'HaNassi Blvd 120, Haifa, Israel'
  }
];

function computeQueryHash(query: string): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5000
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function queryGooglePlacesOrGeocoding(
  query: string,
  userLocation: { lat: number; lon: number },
  apiKey: string
): Promise<GeocodedDestination | null> {
  // 1. Try Google Places API Text Search with locationbias
  const placesUrl =
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}` +
    `&location=${userLocation.lat},${userLocation.lon}&radius=15000&key=${encodeURIComponent(apiKey)}`;

  const placesData = await fetchJsonWithTimeout<GooglePlacesTextSearchResponse>(placesUrl);
  const firstPlace = placesData?.results?.[0];
  if (
    placesData?.status === 'OK' &&
    firstPlace?.geometry?.location &&
    typeof firstPlace.geometry.location.lat === 'number'
  ) {
    return {
      lat: firstPlace.geometry.location.lat,
      lon: firstPlace.geometry.location.lng,
      place_name: firstPlace.name || query,
      formatted_address: firstPlace.formatted_address || firstPlace.name || query,
      source: 'google_places'
    };
  }

  // 2. Fallback to Google Geocoding API biased to Israel/Haifa bounds
  const geocodeUrl =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}` +
    `&bounds=${userLocation.lat - 0.15},${userLocation.lon - 0.15}|${userLocation.lat + 0.15},${userLocation.lon + 0.15}` +
    `&region=il&key=${encodeURIComponent(apiKey)}`;

  const geoData = await fetchJsonWithTimeout<GoogleGeocodeResponse>(geocodeUrl);
  const firstGeo = geoData?.results?.[0];
  if (
    geoData?.status === 'OK' &&
    firstGeo?.geometry?.location &&
    typeof firstGeo.geometry.location.lat === 'number'
  ) {
    return {
      lat: firstGeo.geometry.location.lat,
      lon: firstGeo.geometry.location.lng,
      place_name: query,
      formatted_address: firstGeo.formatted_address || query,
      source: 'google_geocoding'
    };
  }

  return null;
}

async function queryNominatim(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination | null> {
  // 1. Search nationwide across Israel
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=il` +
    `&q=${encodeURIComponent(query)}`;

  const items = await fetchJsonWithTimeout<NominatimItem[]>(url, {
    'User-Agent': 'nextBus-Transit-App/1.0'
  });
  if (!items || items.length === 0) return null;

  // Prioritize city / administrative / mall / station / amenity over obscure residential roads
  const preferred =
    items.find((item) =>
      ['city', 'town', 'suburb', 'administrative', 'mall', 'station', 'bus_station', 'amenity'].includes(
        item.addresstype || item.type || ''
      )
    ) ?? items[0];

  const lat = Number(preferred.lat);
  const lon = Number(preferred.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return {
    lat,
    lon,
    place_name: preferred.name || query,
    formatted_address: preferred.display_name || query,
    source: 'osm_nominatim'
  };
}

/**
 * Strips common conversational travel prefixes in Russian, Hebrew, and English
 * (e.g. "Хочу поехать в больницу Рамбам" -> "больницу Рамбам") for clean geocoding.
 */
export function stripConversationalPrefix(rawQuery: string): string {
  return rawQuery
    .trim()
    .replace(
      /^(?:(?:я\s+хочу\s+поехать\s+(?:в|на|к)|хочу\s+поехать\s+(?:в|на|к)|поехать\s+(?:в|на|к)|как\s+(?:доехать|добраться)\s+(?:в|до|к|на)|доехать\s+(?:до|в|на)|маршрут\s+(?:в|до|на)|мне\s+нужно\s+(?:в|на|до)|take\s+me\s+to|how\s+to\s+get\s+to|i\s+want\s+to\s+go\s+to|go\s+to|directions\s+to)\s+|(?:אני\s+רוצה\s+לנסוע\s+ל|רוצה\s+לנסוע\s+ל|איך\s+מגיעים\s+ל|איך\s+נוסעים\s+ל|לנסוע\s+ל|מסלול\s+ל)\s*)/i,
      ''
    )
    .trim();
}

/**
 * Resolves free-form destination text (Russian / Hebrew / English) into coordinates
 * via Google Places / Geocoding API (when GOOGLE_MAPS_API_KEY is configured),
 * falling back to Israel-wide gazetteer / OpenStreetMap Nominatim, with 24h Redis caching.
 */
export async function resolveDestinationText(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination> {
  const cleaned = stripConversationalPrefix(query);
  const trimmed = cleaned || query.trim();
  if (!trimmed) {
    throw new Error('Destination query cannot be empty');
  }

  const queryHash = computeQueryHash(trimmed);
  const cacheKey = `geo:cache:${queryHash}`;

  const cached = await redisService.getJson<GeocodedDestination>(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  let resolved: GeocodedDestination | null = null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (apiKey && !apiKey.startsWith('your-')) {
    resolved = await queryGooglePlacesOrGeocoding(trimmed, userLocation, apiKey);
  }

  if (!resolved) {
    const landmark = ISRAEL_GAZETTEER.find((item) =>
      item.patterns.some((pattern) => pattern.test(trimmed))
    );
    if (landmark) {
      resolved = {
        lat: landmark.lat,
        lon: landmark.lon,
        place_name: landmark.place_name,
        formatted_address: landmark.formatted_address,
        source: 'gazetteer'
      };
    }
  }

  if (!resolved) {
    resolved = await queryNominatim(trimmed, userLocation);
  }

  if (!resolved) {
    resolved = {
      lat: userLocation.lat,
      lon: userLocation.lon,
      place_name: trimmed,
      formatted_address: `${trimmed}, Israel`,
      source: 'gazetteer'
    };
  }

  await redisService.setJson(cacheKey, resolved, GEO_CACHE_TTL_SECONDS);
  return resolved;
}

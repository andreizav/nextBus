import crypto from 'node:crypto';
import { redisService } from './redis.service.js';
import { supabaseService } from './supabase.service.js';
import type {
  DestinationGranularity,
  GeocodedDestination,
  ResolvedStopOption
} from '../types/bus.types.js';

const GEO_CACHE_TTL_SECONDS = 86_400; // 24 hours

export interface DestinationClassification {
  granularity: DestinationGranularity;
  cleanedQuery: string;
  cityName?: string;
  streetName?: string;
  houseNumber?: string;
}

const KNOWN_CITIES: Array<{ canonical: string; regex: RegExp; cityTokenRegex: RegExp }> = [
  { canonical: 'חיפה', regex: /^(?:חיפה|хайф[аеуы]|haifa)$/i, cityTokenRegex: /(?:חיפה|хайф[аеуы]|haifa)/i },
  { canonical: 'טירת כרמל', regex: /^(?:טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)$/i, cityTokenRegex: /(?:טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/i },
  { canonical: 'תל אביב', regex: /^(?:תל[- ]?אביב(?:\s*יפו)?|тель[- ]?авив[аеу]?|tel[- ]?aviv(?:-yafo)?|tlv)$/i, cityTokenRegex: /(?:תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|\btlv\b)/i },
  { canonical: 'ירושלים', regex: /^(?:ירושלים|иерусалим[аеу]?|jerusalem)$/i, cityTokenRegex: /(?:ירושלים|иерусалим[аеу]?|jerusalem)/i },
  { canonical: 'אשדוד', regex: /^(?:אשדוד|ашдод[аеу]?|ashdod)$/i, cityTokenRegex: /(?:אשדוד|ашдод[аеу]?|ashdod)/i },
  { canonical: 'קריית גת', regex: /^(?:קרי?ית\s*גת|кирьят[- ]?гат[аеу]?|kiryat\s*gat)$/i, cityTokenRegex: /(?:קרי?ית\s*גת|кирьят[- ]?гат[аеу]?|kiryat\s*gat)/i },
  { canonical: 'נתניה', regex: /^(?:נתניה|нетани[яию]|netanya)$/i, cityTokenRegex: /(?:נתניה|нетани[яию]|netanya)/i },
  { canonical: 'באר שבע', regex: /^(?:באר\s*שבע|беэр[- ]?шев[аеу]|beer\s*sheva)$/i, cityTokenRegex: /(?:באר\s*שבע|беэр[- ]?шев[аеу]|beer\s*sheva)/i },
  { canonical: 'אשקלון', regex: /^(?:אשקלון|ашкелон[аеу]?|ashkelon)$/i, cityTokenRegex: /(?:אשקלון|ашкелон[аеу]?|ashkelon)/i },
  { canonical: 'חדרה', regex: /^(?:חדרה|хадер[аеу]|hadera)$/i, cityTokenRegex: /(?:חדרה|хадер[аеу]|hadera)/i },
  { canonical: 'עכו', regex: /^(?:עכו|акко|acre|akko)$/i, cityTokenRegex: /(?:עכו|\bакко\b|\bacre\b|\bakko\b)/i },
  { canonical: 'נהריה', regex: /^(?:נהריה|нагари[яию]|nahariya)$/i, cityTokenRegex: /(?:נהריה|нагари[яию]|nahariya)/i },
  { canonical: 'ראשון לציון', regex: /^(?:ראשון\s*לציון|ришон[- ]?ле[- ]?цион[аеу]?|rishon\s*lezion)$/i, cityTokenRegex: /(?:ראשון\s*לציון|ришон[- ]?ле[- ]?цион[аеу]?|rishon\s*lezion)/i },
  { canonical: 'רחובות', regex: /^(?:רחובות|реховот[аеу]?|rehovot)$/i, cityTokenRegex: /(?:רחובות|реховот[аеу]?|rehovot)/i },
  { canonical: 'פתח תקווה', regex: /^(?:פתח\s*תקווה|петах[- ]?тикв[аеу]|petah\s*tikva)$/i, cityTokenRegex: /(?:פתח\s*תקווה|петах[- ]?тикв[аеу]|petah\s*tikva)/i },
  { canonical: 'הרצליה', regex: /^(?:הרצליה|герцли[яию]|herzliya)$/i, cityTokenRegex: /(?:הרצליה|герцли[яию]|herzliya)/i },
  { canonical: 'אילת', regex: /^(?:אילת|эйлат[аеу]?|eilat)$/i, cityTokenRegex: /(?:אילת|эйлат[аеу]?|eilat)/i },
  { canonical: 'דימונה', regex: /^(?:דימונה|димон[аеу]|dimona)$/i, cityTokenRegex: /(?:דימונה|димон[аеу]|dimona)/i },
  { canonical: 'מצפה רמון', regex: /^(?:מצפה\s*רמון|мицпе[- ]?рамон[аеу]?|mitzpe\s*ramon)$/i, cityTokenRegex: /(?:מצפה\s*רמון|мицпе[- ]?рамон[аеу]?|mitzpe\s*ramon)/i }
];

const KNOWN_STREET_ROOTS =
  /(?:חורב|horev|хорев|הרצל|herzl|герцл|פרויד|freud|фрейд|מוריה|moriah|мория|רוטשילד|rothschild|ротшильд|דיזנגוף|dizengoff|дизенгоф|ארלוזורוב|arlozorov|арлозоров|יפו|jaffa|яффо|פיק["']?א|pika|пика|אלנבי|allenby|алленби|איינשטיין|einstein|эйнштейн|אבא\s*חושי|abba\s*hushi|аба\s*хуши|ז["']?בוטינסקי|jabotinsky|жаботинск|ויצמן|weizmann|вейцман|נרקיסים|narkisim|наркисим|ההגנה|ha?hagana|ха-?хагана|הנשיא|hanassi|ха-?наси)/i;

const STREET_PREFIX_REGEX =
  /(?:^|\s)(?:улиц[аеуы]|ул\.?|на\s+улицу|проспект|пр-?т|бульвар|шоссе|רחוב|רח׳|שדרות|שד׳|דרך|street|st\.?|ave\.?|avenue|blvd\.?|boulevard|rd\.?|road)(?=\s|$)/i;

const POI_KEYWORD_REGEX =
  /(?:больниц|клиник|поликлиник|госпитал|университет|институт|техн?ион|каньон|торгов|центр(?!\s*улиц)|вокзал|автостанц|тах?ана\s*мерказит|аэропорт|бен[- ]?гурион|рамбам|азриэли|савидор|дизенгоф\s*центр|матам|хоф\s*(?:ха)?кармель|гранд\s*каньон|адар|בית\s*חולים|מרפאה|קופת\s*חולים|אוניברסיט|טכניון|קניון|תחנה\s*מרכזית|ת\.\s*מרכזית|רכבת|נמל\s*תעופה|מרכז\s*חורב|מרכז\s*הכרמל|hospital|clinic|university|technion|mall|station|airport|azrieli|rambam|savidor|matam|hof\s*ha?carmel|grand\s*canyon)/i;

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
  // --- Northern & Central Intercity Cities ---
  {
    patterns: [/קי?רי?ית\s*גת|кирьят[- ]?гат|kiryat\s*gat/i],
    lat: 31.6095,
    lon: 34.7642,
    place_name: 'Кирьят-Гат — Центральная автостанция (קריית גת - תחנה מרכזית)',
    formatted_address: 'Kiryat Gat Central Bus Station, Israel'
  },
  {
    patterns: [/^חיפה$|^хайф[аеуы]?$|^haifa$/i],
    lat: 32.7934,
    lon: 34.9590,
    place_name: 'Хайфа — ת. מרכזית חוף הכרמל (Haifa)',
    formatted_address: 'Haifa Hof HaCarmel Central Station, Haifa, Israel'
  },
  {
    patterns: [/эйлат|eilat|אילת/i],
    lat: 29.5569,
    lon: 34.9498,
    place_name: 'Эйлат (אילת — תחנה מרכזית)',
    formatted_address: 'Eilat Central Bus Station, Israel'
  },
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
    patterns: [/димон[аеу]|dimona|דימונה/i],
    lat: 31.0700,
    lon: 35.0330,
    place_name: 'Димона (דימונה — תחנה מרכזית)',
    formatted_address: 'Dimona Central Bus Station, Israel'
  },
  {
    patterns: [/мицпе[- ]?рамон|mitzpe\s*ramon|מצפה\s*רמון/i],
    lat: 30.6100,
    lon: 34.8010,
    place_name: 'Мицпе-Рамон (מצפה רמון)',
    formatted_address: 'Mitzpe Ramon, Israel'
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

function stripLeadingDirectionPreposition(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed
    .replace(/^(?:в|во|до|на|к|по|to)\s+/i, '')
    .trim();
  if (/^ל(?:רחוב|מרכז|חיפה|תל|ירושלים|אשדוד|קריית|נתניה|טירת|באר|אשקלון|חדרה|אילת|דימונה|מצפה)/.test(stripped)) {
    return stripped.slice(1).trim();
  }
  return stripped || trimmed;
}

/**
 * Classifies free-form destination text into:
 * - "city": city-only query -> resolves to central bus station / transit hub
 * - "address": street + house number -> geocodes coordinates + snaps to nearest stop (~450-500m)
 * - "poi": facility/hospital/mall/university -> geocodes coordinates + snaps to nearest stop
 * - "street": street name only (no house number, no POI) -> picks most popular hub stop on street + alternatives
 */
export function classifyDestinationGranularity(rawQuery: string): DestinationClassification {
  const withoutConv = stripConversationalPrefix(rawQuery);
  const cleanedQuery = stripLeadingDirectionPreposition(withoutConv || rawQuery.trim());

  let detectedCity: string | undefined;
  for (const city of KNOWN_CITIES) {
    if (city.cityTokenRegex.test(cleanedQuery)) {
      detectedCity = city.canonical;
      break;
    }
  }

  // Strip country suffix & leading/trailing punctuation when testing pure city query
  const pureCityCandidate = cleanedQuery
    .replace(/(?:,\s*)?(?:израиль|israel|ישראל)$/i, '')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();

  for (const city of KNOWN_CITIES) {
    if (city.regex.test(pureCityCandidate)) {
      return {
        granularity: 'city',
        cleanedQuery: pureCityCandidate,
        cityName: city.canonical
      };
    }
  }

  // Check if explicit house number is present alongside non-numeric text (e.g., "Хорев 12, Хайфа", "Herzl 49")
  const hasStreetOrPlaceWord = /[a-zа-яёא-ת]{2,}/i.test(cleanedQuery);
  const houseMatch = hasStreetOrPlaceWord
    ? cleanedQuery.match(/(?:^|\s)(\d{1,4}[אa-z]?)(?:\s*,|\s+|$)/i)
    : null;
  const houseNumber = houseMatch?.[1];
  const hasExplicitPoi = POI_KEYWORD_REGEX.test(cleanedQuery);

  if (houseNumber) {
    const streetCandidate = cleanedQuery
      .replace(new RegExp(`\\b${houseNumber}\\b`, 'i'), ' ')
      .replace(/,/g, ' ')
      .replace(STREET_PREFIX_REGEX, ' ')
      .replace(/(?:חיפה|хайф[аеуы]|haifa|תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|ירושלים|иерусалим[аеу]?|jerusalem|טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      granularity: 'address',
      cleanedQuery,
      cityName: detectedCity,
      streetName: streetCandidate || undefined,
      houseNumber
    };
  }

  if (hasExplicitPoi) {
    return {
      granularity: 'poi',
      cleanedQuery,
      cityName: detectedCity
    };
  }

  const hasStreetMarker = STREET_PREFIX_REGEX.test(cleanedQuery);
  const hasKnownStreet = KNOWN_STREET_ROOTS.test(cleanedQuery);

  if (hasStreetMarker || hasKnownStreet) {
    const streetPart = cleanedQuery
      .replace(/,/g, ' ')
      .replace(STREET_PREFIX_REGEX, ' ')
      .replace(/(?:^|\s)(?:в\s+городе|города|город|г\.|בחיפה|בתל\s*אביב|בירושלים)\s*/gi, ' ')
      .replace(/(?:חיפה|хайф[аеуы]|haifa|תל[- ]?אביב|тель[- ]?авив[аеу]?|tel[- ]?aviv|ירושלים|иерусалим[аеу]?|jerusalem|טירת\s*כרמל|тират[- ]?кармел[ьяе]?|tirat\s*carmel)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      granularity: 'street',
      cleanedQuery,
      cityName: detectedCity,
      streetName: streetPart || cleanedQuery
    };
  }

  return {
    granularity: 'poi',
    cleanedQuery,
    cityName: detectedCity
  };
}

/**
 * Resolves free-form destination text (Russian / Hebrew / English) into coordinates + GTFS stop metadata:
 * - city -> GTFS central bus station / transit hub (`findCentralStopForCity`)
 * - street -> popular stop on street + alternatives (`findPopularStopOnStreet`)
 * - address / poi -> Google Places/Geocoding -> Gazetteer -> OSM Nominatim + nearest walking-radius GTFS stop
 */
export async function resolveDestinationText(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination> {
  const classification = classifyDestinationGranularity(query);
  const trimmed = classification.cleanedQuery || query.trim();
  if (!trimmed) {
    throw new Error('Destination query cannot be empty');
  }

  const queryHash = computeQueryHash(trimmed);
  const cacheKey = `geo:cache:${queryHash}`;
  const legacyCacheKey = `geo:v2:cache:${queryHash}`;

  const cached =
    (await redisService.getJson<GeocodedDestination>(cacheKey)) ??
    (await redisService.getJson<GeocodedDestination>(legacyCacheKey));
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  let resolved: GeocodedDestination | null = null;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  // Layer 1a: City-only -> Central Bus Station / Hub via GTFS/PostGIS (Supabase first)
  if (classification.granularity === 'city' && classification.cityName) {
    const centralStop = await supabaseService.findCentralStopForCity(classification.cityName);
    if (centralStop) {
      resolved = {
        lat: centralStop.lat,
        lon: centralStop.lon,
        place_name: centralStop.stop_name_he || centralStop.stop_name,
        formatted_address: `${centralStop.stop_name} (${classification.cityName})`,
        source: 'gtfs_db',
        destination_granularity: 'city',
        city_name: classification.cityName,
        resolved_stop: centralStop
      };
    }
  }

  // Layer 1b: Street-only -> Most popular stop on street + alternatives via GTFS/PostGIS
  if (!resolved && classification.granularity === 'street') {
    const streetStops = await supabaseService.findPopularStopOnStreet(
      classification.streetName || trimmed,
      classification.cityName,
      userLocation.lat,
      userLocation.lon
    );
    if (streetStops.length > 0) {
      const topStop = streetStops[0];
      resolved = {
        lat: topStop.lat,
        lon: topStop.lon,
        place_name: topStop.stop_name_he || topStop.stop_name,
        formatted_address: `${topStop.stop_name}${classification.cityName ? `, ${classification.cityName}` : ''}`,
        source: 'gtfs_db',
        destination_granularity: 'street',
        city_name: classification.cityName,
        street_name: classification.streetName,
        resolved_stop: topStop,
        alternative_street_stops: streetStops
      };
    }
  }

  // Layer 1c: Local Israel Gazetteer for known landmarks & cities (skipped for exact numbered addresses)
  if (!resolved && classification.granularity !== 'address') {
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

  // Layer 3 (Fallback Geocoder): Free OpenStreetMap Nominatim first, then optional GOOGLE_MAPS_API_KEY
  if (!resolved) {
    resolved = await queryNominatim(trimmed, userLocation);
  }

  if (!resolved && apiKey && !apiKey.startsWith('your-')) {
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
    resolved = {
      lat: userLocation.lat,
      lon: userLocation.lon,
      place_name: trimmed,
      formatted_address: `${trimmed}, Israel`,
      source: 'gazetteer'
    };
  }

  // Attach granularity & nearest physical stop in walking radius (~450-500m) for address/POI/city
  let nearestStop: ResolvedStopOption | undefined = resolved.resolved_stop;
  if (!nearestStop) {
    const stopsNearby = await supabaseService.findNearestStopsToPoint(resolved.lat, resolved.lon, 480);
    if (stopsNearby.length > 0) {
      nearestStop = stopsNearby[0];
    }
  }

  const enriched: GeocodedDestination = {
    ...resolved,
    destination_granularity: resolved.destination_granularity ?? classification.granularity,
    ...(classification.cityName && !resolved.city_name ? { city_name: classification.cityName } : {}),
    ...(classification.streetName && !resolved.street_name ? { street_name: classification.streetName } : {}),
    ...(nearestStop ? { resolved_stop: nearestStop } : {})
  };

  await redisService.setJson(cacheKey, enriched, GEO_CACHE_TTL_SECONDS);
  return enriched;
}

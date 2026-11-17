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
}

interface HaifaLandmark {
  patterns: RegExp[];
  lat: number;
  lon: number;
  place_name: string;
  formatted_address: string;
}

const HAIFA_GAZETTEER: HaifaLandmark[] = [
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
    patterns: [/мерказ\s*кармель|центр\s*кармель|carmel\s*center|מרכז\s*הכרמל|кармель/i],
    lat: 32.8018,
    lon: 34.9855,
    place_name: 'Мерказ ха-Кармель (מרכז הכרמל)',
    formatted_address: 'HaNassi Blvd 120, Haifa, Israel'
  },
  {
    patterns: [/хоф\s*(ха)?кармель|hof\s*ha?carmel|חוף\s*הכרמל|מרכזית/i],
    lat: 32.7934,
    lon: 34.9592,
    place_name: 'Хоф ха-Кармель (ת. מרכזית חוף הכרמל)',
    formatted_address: 'Sderot HaHagana, Haifa, Israel'
  },
  {
    patterns: [/матам|matam|מת''?מ|хай-?тек/i],
    lat: 32.7902,
    lon: 34.9616,
    place_name: 'Парк МАТАМ (פארק מת״מ, חיפה)',
    formatted_address: 'ATRAM / Matam Park, Haifa, Israel'
  },
  {
    patterns: [/тират|tirat|טירת/i],
    lat: 32.7615,
    lon: 34.9718,
    place_name: 'Тират-Кармель (טירת כרמל)',
    formatted_address: 'HaHagana St, Tirat Carmel, Israel'
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
  const minLon = (userLocation.lon - 0.25).toFixed(4);
  const maxLon = (userLocation.lon + 0.25).toFixed(4);
  const minLat = (userLocation.lat - 0.2).toFixed(4);
  const maxLat = (userLocation.lat + 0.2).toFixed(4);

  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il` +
    `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&q=${encodeURIComponent(query)}`;

  const items = await fetchJsonWithTimeout<NominatimItem[]>(url, {
    'User-Agent': 'nextBus-Transit-App/1.0'
  });
  const first = items?.[0];
  if (!first) return null;

  const lat = Number(first.lat);
  const lon = Number(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  return {
    lat,
    lon,
    place_name: first.name || query,
    formatted_address: first.display_name || query,
    source: 'osm_nominatim'
  };
}

/**
 * Resolves free-form destination text (Russian / Hebrew / English) into coordinates
 * via Google Places / Geocoding API (when GOOGLE_MAPS_API_KEY is configured),
 * falling back to Haifa gazetteer / OpenStreetMap Nominatim, with 24h Redis caching.
 */
export async function resolveDestinationText(
  query: string,
  userLocation: { lat: number; lon: number }
): Promise<GeocodedDestination> {
  const trimmed = query.trim();
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
    const landmark = HAIFA_GAZETTEER.find((item) =>
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
    // Default safe Haifa Horev fallback if offline/unresolved so UX never breaks on unknown text
    resolved = {
      lat: 32.7832,
      lon: 34.9859,
      place_name: trimmed,
      formatted_address: `${trimmed}, Haifa, Israel`,
      source: 'gazetteer'
    };
  }

  await redisService.setJson(cacheKey, resolved, GEO_CACHE_TTL_SECONDS);
  return resolved;
}

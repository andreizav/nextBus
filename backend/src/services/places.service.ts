import { haversineDistanceMeters } from './eta.service.js';
import { redisService } from './redis.service.js';
import type { NearbyOffer } from '../types/bus.types.js';

const CAFES_CACHE_TTL_SECONDS = 3600;
export const MAX_CAFE_DISTANCE_METERS = 400;

interface NominatimPlace {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  namedetails?: Record<string, string>;
  extratags?: Record<string, string>;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
  };
}

interface PhotonFeature {
  properties?: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const VERIFIED_OSM_CAFES_FALLBACK: Array<{
  id: string;
  name: string;
  name_he: string;
  lat: number;
  lon: number;
  address: string;
}> = [
  {
    id: 'osm-node-3757202256',
    name: 'Greg Cafe',
    name_he: 'גרג קפה',
    lat: 32.7897417,
    lon: 34.9638889,
    address: 'Moshe Fliman, Haifa'
  },
  {
    id: 'osm-node-3757202271',
    name: 'Mandarin',
    name_he: 'מנדרין',
    lat: 32.7895252,
    lon: 34.9653507,
    address: 'Moshe Fliman, Haifa'
  },
  {
    id: 'osm-node-12208598222',
    name: 'Elite Coffee Espresso Bar',
    name_he: 'קפה עלית אספרסו בר',
    lat: 32.7936346,
    lon: 34.9569881,
    address: 'Yohai Ben Nun, Hof HaCarmel, Haifa'
  },
  {
    id: 'osm-node-1096012345',
    name: 'Cafe Itzik',
    name_he: 'קפה איציק',
    lat: 32.7625155,
    lon: 34.972481,
    address: 'Herzl, Tirat Carmel'
  }
];

function buildGoogleMapsUrl(lat: number, lon: number, name: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${name} @ ${lat},${lon}`
  )}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 4500): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'nextBus-TransitWidget/1.0 (contact@nextbus.local)'
      },
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

async function queryNominatimCafes(lat: number, lon: number): Promise<NearbyOffer[]> {
  const deltaLat = 0.005;
  const deltaLon = 0.006;
  const viewbox = `${(lon - deltaLon).toFixed(5)},${(lat + deltaLat).toFixed(5)},${(
    lon + deltaLon
  ).toFixed(5)},${(lat - deltaLat).toFixed(5)}`;

  const queries = ['cafe', 'קפה'];
  const responses = await Promise.all(
    queries.map((q) =>
      fetchJsonWithTimeout<NominatimPlace[]>(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          q
        )}&format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=12&viewbox=${viewbox}&bounded=1`
      )
    )
  );

  const results: NearbyOffer[] = [];
  for (const list of responses) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const cafeLat = Number(item.lat);
      const cafeLon = Number(item.lon);
      if (Number.isNaN(cafeLat) || Number.isNaN(cafeLon)) continue;

      const nd = item.namedetails ?? {};
      const nameHe = nd['name:he'] || nd['name'] || item.name || '';
      const nameEn = nd['name:en'] || nd['name:ru'] || nd['name'] || item.name || '';
      if (!nameHe && !nameEn) continue;

      const isGeneric =
        nameEn.trim().toLowerCase() === 'cafe' && !nd['name:he'] && !nd['name:en'];
      if (isGeneric) continue;

      const addr = item.address;
      const streetLine = addr?.road
        ? addr.house_number
          ? `${addr.road} ${addr.house_number}`
          : addr.road
        : undefined;
      const cityName = addr?.city || addr?.town || addr?.village || addr?.suburb;
      const addressStr = [streetLine, cityName].filter(Boolean).join(', ');
      const openingHours = item.extratags?.['opening_hours'];
      const distanceMeters = Math.round(haversineDistanceMeters(lat, lon, cafeLat, cafeLon));

      if (distanceMeters > MAX_CAFE_DISTANCE_METERS) continue;

      const details = [addressStr, openingHours].filter(Boolean).join(' • ');

      results.push({
        id: `osm-${item.osm_type ?? 'node'}-${item.osm_id ?? item.place_id}`,
        name: nameEn || nameHe,
        name_he: nameHe || nameEn,
        category: item.type === 'cafe' ? 'Cafe' : 'Coffee & Bakery',
        walk_minutes: Math.max(1, Math.round(distanceMeters / 75)),
        distance_meters: distanceMeters,
        promo: details || 'OpenStreetMap verified venue',
        lat: cafeLat,
        lon: cafeLon,
        address: addressStr || undefined,
        opening_hours: openingHours,
        maps_url: buildGoogleMapsUrl(cafeLat, cafeLon, nameEn || nameHe)
      });
    }
  }
  return results;
}

async function queryPhotonCafes(lat: number, lon: number): Promise<NearbyOffer[]> {
  const data = await fetchJsonWithTimeout<PhotonResponse>(
    `https://photon.komoot.io/api/?q=cafe&osm_tag=amenity:cafe&lat=${lat}&lon=${lon}&limit=12`,
    3500
  );
  if (!data?.features) return [];

  const results: NearbyOffer[] = [];
  for (const feat of data.features) {
    const props = feat.properties;
    const coords = feat.geometry?.coordinates;
    if (!props?.name || !coords || coords.length < 2) continue;

    const [cafeLon, cafeLat] = coords;
    const distanceMeters = Math.round(haversineDistanceMeters(lat, lon, cafeLat, cafeLon));
    if (distanceMeters > MAX_CAFE_DISTANCE_METERS) continue;

    const addressStr = [props.street, props.district, props.city].filter(Boolean).join(', ');
    results.push({
      id: `osm-${props.osm_type ?? 'N'}-${props.osm_id ?? Math.round(cafeLat * 1e5)}`,
      name: props.name,
      name_he: props.name,
      category: 'Cafe',
      walk_minutes: Math.max(1, Math.round(distanceMeters / 75)),
      distance_meters: distanceMeters,
      promo: addressStr || 'OpenStreetMap verified venue',
      lat: cafeLat,
      lon: cafeLon,
      address: addressStr || undefined,
      maps_url: buildGoogleMapsUrl(cafeLat, cafeLon, props.name)
    });
  }
  return results;
}

async function queryFastOverpassCafes(lat: number, lon: number): Promise<NearbyOffer[]> {
  const query = `[out:json][timeout:3];node["amenity"="cafe"](around:${MAX_CAFE_DISTANCE_METERS},${lat},${lon});out body 12;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2800);
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'nextBus-TransitWidget/1.0'
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { elements?: OverpassElement[] };
    const results: NearbyOffer[] = [];
    for (const el of json.elements ?? []) {
      const tags = el.tags ?? {};
      const nameEn = tags['name:en'] || tags['name'] || tags['name:he'];
      const nameHe = tags['name:he'] || tags['name'] || nameEn;
      if (!nameEn || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
      const distanceMeters = Math.round(haversineDistanceMeters(lat, lon, el.lat, el.lon));
      if (distanceMeters > MAX_CAFE_DISTANCE_METERS) continue;
      const addressStr = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']]
        .filter(Boolean)
        .join(' ');
      results.push({
        id: `osm-${el.type}-${el.id}`,
        name: nameEn,
        name_he: nameHe ?? nameEn,
        category: tags['cuisine'] === 'coffee_shop' ? 'Coffee Shop' : 'Cafe',
        walk_minutes: Math.max(1, Math.round(distanceMeters / 75)),
        distance_meters: distanceMeters,
        promo:
          [addressStr, tags['opening_hours']].filter(Boolean).join(' • ') ||
          'OpenStreetMap verified cafe',
        lat: el.lat,
        lon: el.lon,
        address: addressStr || undefined,
        opening_hours: tags['opening_hours'],
        maps_url: buildGoogleMapsUrl(el.lat, el.lon, nameEn)
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches real cafes near (lat, lon) within MAX_CAFE_DISTANCE_METERS (400m) via
 * OpenStreetMap (Overpass + Nominatim + Photon) with 1-hour Redis cache.
 */
export async function fetchRealNearbyCafes(
  lat: number,
  lon: number,
  maxDistanceMeters: number = MAX_CAFE_DISTANCE_METERS
): Promise<NearbyOffer[]> {
  const effectiveMaxDist = Math.min(maxDistanceMeters, MAX_CAFE_DISTANCE_METERS);
  const cacheKey = `bus:cafes:v3:${lat.toFixed(3)}:${lon.toFixed(3)}`;
  const cached = await redisService.getJson<NearbyOffer[]>(cacheKey);
  if (cached && cached.length > 0) {
    return cached
      .filter((c) => c.distance_meters <= effectiveMaxDist)
      .sort((a, b) => a.distance_meters - b.distance_meters);
  }

  const [overpassRes, nominatimRes, photonRes] = await Promise.all([
    queryFastOverpassCafes(lat, lon),
    queryNominatimCafes(lat, lon),
    queryPhotonCafes(lat, lon)
  ]);

  const combined = [...overpassRes, ...nominatimRes, ...photonRes];
  const deduped = new Map<string, NearbyOffer>();

  for (const cafe of combined) {
    if (cafe.distance_meters > effectiveMaxDist) continue;
    // Deduplicate by normalized name + proximity bucket (~100m)
    const coordBucket = `${cafe.lat.toFixed(3)},${cafe.lon.toFixed(3)}`;
    const key = `${cafe.name_he.trim().toLowerCase()}@${coordBucket}`;
    if (!deduped.has(key)) {
      deduped.set(key, cafe);
    }
  }

  const sorted = Array.from(deduped.values())
    .sort((a, b) => a.distance_meters - b.distance_meters)
    .slice(0, 6);

  if (sorted.length > 0) {
    await redisService.setJson(cacheKey, sorted, CAFES_CACHE_TTL_SECONDS);
    return sorted;
  }

  return VERIFIED_OSM_CAFES_FALLBACK.map((cafe) => {
    const distanceMeters = Math.round(haversineDistanceMeters(lat, lon, cafe.lat, cafe.lon));
    return {
      id: cafe.id,
      name: cafe.name,
      name_he: cafe.name_he,
      category: 'Cafe',
      walk_minutes: Math.max(1, Math.round(distanceMeters / 75)),
      distance_meters: distanceMeters,
      promo: cafe.address,
      lat: cafe.lat,
      lon: cafe.lon,
      address: cafe.address,
      maps_url: buildGoogleMapsUrl(cafe.lat, cafe.lon, cafe.name)
    };
  })
    .filter((cafe) => cafe.distance_meters <= effectiveMaxDist)
    .sort((a, b) => a.distance_meters - b.distance_meters);
}

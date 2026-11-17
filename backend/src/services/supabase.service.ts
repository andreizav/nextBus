import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { haversineDistanceMeters } from './eta.service.js';
import type { NearbyOffer, StopTimelineItem } from '../types/bus.types.js';

export interface NearestStopRpcRow {
  route_id: string;
  direction_id: 0 | 1;
  stop_id: string;
  stop_sequence: number;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  stop_lat: number;
  stop_lon: number;
  route_short_name: string;
  route_long_name: string;
  distance_meters: number;
}

interface FallbackStopDef {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  lat: number;
  lon: number;
}

const LINE_49_STOPS_DIR_0: FallbackStopDef[] = [
  {
    stop_id: 'stop-41001',
    stop_code: '41001',
    stop_name: 'Tirat Carmel / HaAtzmaut',
    stop_name_he: 'העצמאות / טירת כרמל',
    lat: 32.7585,
    lon: 34.9721
  },
  {
    stop_id: 'stop-41002',
    stop_code: '41002',
    stop_name: 'Herzl / Tirat Carmel Mall',
    stop_name_he: 'הרצל / קניון טירת כרמל',
    lat: 32.7618,
    lon: 34.9726
  },
  {
    stop_id: 'stop-41003',
    stop_code: '41003',
    stop_name: 'Rambam / HaGalil',
    stop_name_he: 'רמב״ם / הגליל',
    lat: 32.7659,
    lon: 34.9730
  },
  {
    stop_id: 'stop-41004',
    stop_code: '41004',
    stop_name: 'HaHagana / Kfar Galim',
    stop_name_he: 'ההגנה / כפר גלים',
    lat: 32.7712,
    lon: 34.9718
  },
  {
    stop_id: 'stop-41005',
    stop_code: '41005',
    stop_name: 'MATAM High-Tech Park',
    stop_name_he: 'פארק מת״ם / מבוא כרמל',
    lat: 32.7804,
    lon: 34.9658
  },
  {
    stop_id: 'stop-41006',
    stop_code: '41006',
    stop_name: 'Haifa Mall / Fliman',
    stop_name_he: 'קניון חיפה / פלימן',
    lat: 32.7876,
    lon: 34.9622
  },
  {
    stop_id: 'stop-41007',
    stop_code: '41007',
    stop_name: 'Hof HaCarmel Central Station',
    stop_name_he: 'מרכזית חוף הכרמל',
    lat: 32.7938,
    lon: 34.9591
  }
];

const NEARBY_COFFEE_OFFERS: NearbyOffer[] = [
  {
    id: 'offer-cafe-greg-matam',
    name: 'Cafe Greg MATAM',
    name_he: 'קפה גרג מת״ם',
    category: 'Coffee & Pastries',
    walk_minutes: 2,
    distance_meters: 140,
    promo: '10% off espresso while waiting for Bus 49',
    lat: 32.7811,
    lon: 34.9665
  },
  {
    id: 'offer-aroma-haifa-mall',
    name: 'Aroma Espresso Bar — Haifa Mall',
    name_he: 'ארומה אספרסו בר — קניון חיפה',
    category: 'Coffee',
    walk_minutes: 3,
    distance_meters: 240,
    promo: 'Free pastry upgrade with iced coffee',
    lat: 32.7872,
    lon: 34.9631
  },
  {
    id: 'offer-roladin-hof-hacarmel',
    name: 'Roladin Hof HaCarmel',
    name_he: 'רולדין חוף הכרמל',
    category: 'Bakery & Coffee',
    walk_minutes: 4,
    distance_meters: 310,
    promo: 'Morning combo 24 ILS',
    lat: 32.7932,
    lon: 34.9599
  }
];

class SupabaseService {
  private client: SupabaseClient | null = null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (url && key && url.startsWith('http')) {
      this.client = createClient(url, key);
    }
  }

  async findNearestStopForLine(
    lineNum: string,
    userLat: number,
    userLon: number,
    preferredDirection?: 0 | 1,
    destinationHint?: string
  ): Promise<NearestStopRpcRow> {
    if (this.client && preferredDirection === undefined) {
      try {
        const { data, error } = await this.client.rpc('find_nearest_stop_for_line', {
          line_num: lineNum,
          user_lat: userLat,
          user_lon: userLon
        });

        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row && typeof row.stop_id === 'string') {
          return {
            route_id: String(row.route_id),
            direction_id: Number(row.direction_id) === 1 ? 1 : 0,
            stop_id: String(row.stop_id),
            stop_sequence: Number(row.stop_sequence),
            stop_code: String(row.stop_code ?? row.stop_id),
            stop_name: String(row.stop_name),
            stop_name_he: String(row.stop_name_he ?? row.stop_name),
            stop_lat: Number(row.stop_lat),
            stop_lon: Number(row.stop_lon),
            route_short_name: String(row.route_short_name ?? lineNum),
            route_long_name: String(row.route_long_name ?? `Line ${lineNum}`),
            distance_meters: Number(row.distance_meters ?? 0)
          };
        }
      } catch (err) {
        console.warn('[Supabase] RPC fallback triggered:', (err as Error).message);
      }
    }

    const inferredDir: 0 | 1 =
      preferredDirection !== undefined
        ? preferredDirection
        : destinationHint && /tirat|טירת/i.test(destinationHint)
          ? 1
          : 0;

    const orderedStops =
      inferredDir === 0 ? LINE_49_STOPS_DIR_0 : [...LINE_49_STOPS_DIR_0].reverse();

    let bestStop = orderedStops[0];
    let bestSequence = 1;
    let minDist = Infinity;

    orderedStops.forEach((stop, idx) => {
      const dist = haversineDistanceMeters(userLat, userLon, stop.lat, stop.lon);
      if (dist < minDist) {
        minDist = dist;
        bestStop = stop;
        bestSequence = idx + 1;
      }
    });

    return {
      route_id: `route-${lineNum}-haifa`,
      direction_id: inferredDir,
      stop_id: bestStop.stop_id,
      stop_sequence: bestSequence,
      stop_code: bestStop.stop_code,
      stop_name: bestStop.stop_name,
      stop_name_he: bestStop.stop_name_he,
      stop_lat: bestStop.lat,
      stop_lon: bestStop.lon,
      route_short_name: lineNum,
      route_long_name:
        inferredDir === 0
          ? 'Tirat Carmel -> Haifa Hof HaCarmel'
          : 'Haifa Hof HaCarmel -> Tirat Carmel',
      distance_meters: Math.round(minDist)
    };
  }

  getRouteStopsTimeline(
    directionId: 0 | 1,
    userStopSequence: number,
    busStopSequence: number
  ): StopTimelineItem[] {
    const orderedStops =
      directionId === 0 ? LINE_49_STOPS_DIR_0 : [...LINE_49_STOPS_DIR_0].reverse();

    return orderedStops.map((stop, index) => {
      const seq = index + 1;
      let status: StopTimelineItem['status'] = 'upcoming';
      if (seq < busStopSequence) {
        status = 'passed';
      } else if (seq === userStopSequence) {
        status = 'user_stop';
      } else if (seq >= busStopSequence && seq < userStopSequence) {
        status = 'approaching';
      }

      return {
        stop_id: stop.stop_id,
        stop_code: stop.stop_code,
        stop_name: stop.stop_name,
        stop_name_he: stop.stop_name_he,
        stop_sequence: seq,
        lat: stop.lat,
        lon: stop.lon,
        status
      };
    });
  }

  getNearbyOffers(userLat: number, userLon: number): NearbyOffer[] {
    return NEARBY_COFFEE_OFFERS.map((offer) => {
      const distanceMeters = Math.round(
        haversineDistanceMeters(userLat, userLon, offer.lat, offer.lon)
      );
      return {
        ...offer,
        distance_meters: distanceMeters,
        walk_minutes: Math.max(1, Math.round(distanceMeters / 75))
      };
    }).sort((a, b) => a.distance_meters - b.distance_meters);
  }
}

export const supabaseService = new SupabaseService();

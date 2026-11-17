import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { haversineDistanceMeters } from './eta.service.js';
import type { StopTimelineItem } from '../types/bus.types.js';

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

export interface RouteStopCoord {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  stop_sequence: number;
  lat: number;
  lon: number;
}

const LINE_49_FALLBACK_STOPS: RouteStopCoord[] = [
  {
    stop_id: 'stop-41949',
    stop_code: '41949',
    stop_name: 'מרכז לבריאות הנפש טירת כרמל (טירת כרמל)',
    stop_name_he: 'מרכז לבריאות הנפש טירת כרמל (טירת כרמל)',
    stop_sequence: 1,
    lat: 32.750932,
    lon: 34.974635
  },
  {
    stop_id: 'stop-42656',
    stop_code: '42656',
    stop_name: "מת''מ (חיפה)",
    stop_name_he: "מת''מ (חיפה)",
    stop_sequence: 34,
    lat: 32.790385,
    lon: 34.96134
  },
  {
    stop_id: 'stop-42600',
    stop_code: '42600',
    stop_name: 'ת. מרכזית חוף הכרמל/הורדה (חיפה)',
    stop_name_he: 'ת. מרכזית חוף הכרמל/הורדה (חיפה)',
    stop_sequence: 36,
    lat: 32.7938,
    lon: 34.9591
  }
];

class SupabaseService {
  private client: SupabaseClient | null = null;
  private pgPool: pg.Pool | null = null;
  private initialized = false;

  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (url && key && url.startsWith('http')) {
      this.client = createClient(url, key);
    }
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      this.pgPool = new pg.Pool({ connectionString: dbUrl });
    }
  }

  async findNearestStopForLine(
    lineNum: string,
    userLat: number,
    userLon: number,
    preferredDirection?: 0 | 1,
    destinationHint?: string
  ): Promise<NearestStopRpcRow> {
    this.ensureInit();

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
            distance_meters: Math.round(Number(row.distance_meters ?? 0))
          };
        }
      } catch (err) {
        console.warn('[Supabase] RPC fallback triggered:', (err as Error).message);
      }
    }

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT * FROM find_nearest_stop_for_line($1, $2, $3, $4)`,
          [lineNum, userLat, userLon, preferredDirection ?? null]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
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
            distance_meters: Math.round(Number(row.distance_meters ?? 0))
          };
        }
      } catch (err) {
        console.warn('[PostgreSQL] Direct RPC query error:', (err as Error).message);
      }
    }

    const inferredDir: 0 | 1 =
      preferredDirection !== undefined
        ? preferredDirection
        : destinationHint && /tirat|טירת/i.test(destinationHint)
          ? 1
          : 0;

    let bestStop = LINE_49_FALLBACK_STOPS[0];
    let minDist = Infinity;
    for (const stop of LINE_49_FALLBACK_STOPS) {
      const dist = haversineDistanceMeters(userLat, userLon, stop.lat, stop.lon);
      if (dist < minDist) {
        minDist = dist;
        bestStop = stop;
      }
    }

    return {
      route_id: 'stride-10049',
      direction_id: inferredDir,
      stop_id: bestStop.stop_id,
      stop_sequence: bestStop.stop_sequence,
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

  async getDirectionStopCoords(routeId: string, directionId: 0 | 1): Promise<RouteStopCoord[]> {
    this.ensureInit();
    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT
            s.stop_id,
            s.stop_code,
            s.stop_name,
            COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
            rs.stop_sequence,
            ST_Y(s.location::geometry)::FLOAT AS lat,
            ST_X(s.location::geometry)::FLOAT AS lon
          FROM route_stops rs
          JOIN stops s ON s.stop_id = rs.stop_id
          WHERE rs.route_id = $1 AND rs.direction_id = $2
          ORDER BY rs.stop_sequence ASC`,
          [routeId, directionId]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r) => ({
            stop_id: String(r.stop_id),
            stop_code: String(r.stop_code),
            stop_name: String(r.stop_name),
            stop_name_he: String(r.stop_name_he),
            stop_sequence: Number(r.stop_sequence),
            lat: Number(r.lat),
            lon: Number(r.lon)
          }));
        }
      } catch (err) {
        console.warn('[PostgreSQL] Stop list query error:', (err as Error).message);
      }
    }

    return LINE_49_FALLBACK_STOPS;
  }

  async getRouteStopsTimeline(
    routeId: string,
    directionId: 0 | 1,
    userStopSequence: number,
    busStopSequence: number
  ): Promise<StopTimelineItem[]> {
    const allStops = await this.getDirectionStopCoords(routeId, directionId);

    // Return focused window around bus & user stop (plus endpoints) if route has > 12 stops
    let selected = allStops;
    if (allStops.length > 14) {
      const startSeq = Math.max(1, Math.min(busStopSequence, userStopSequence) - 3);
      const endSeq = Math.min(allStops.length, Math.max(busStopSequence, userStopSequence) + 4);
      selected = allStops.filter(
        (s) => s.stop_sequence === 1 || (s.stop_sequence >= startSeq && s.stop_sequence <= endSeq)
      );
    }

    return selected.map((stop) => {
      let status: StopTimelineItem['status'] = 'upcoming';
      if (stop.stop_sequence < busStopSequence) {
        status = 'passed';
      } else if (stop.stop_sequence === userStopSequence) {
        status = 'user_stop';
      } else if (stop.stop_sequence >= busStopSequence && stop.stop_sequence < userStopSequence) {
        status = 'approaching';
      }

      return {
        stop_id: stop.stop_id,
        stop_code: stop.stop_code,
        stop_name: stop.stop_name,
        stop_name_he: stop.stop_name_he,
        stop_sequence: stop.stop_sequence,
        lat: stop.lat,
        lon: stop.lon,
        status
      };
    });
  }
}

export const supabaseService = new SupabaseService();

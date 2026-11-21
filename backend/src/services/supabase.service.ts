import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { haversineDistanceMeters } from './eta.service.js';
import type {
  DirectRouteMatch,
  ResolvedStopOption,
  StopTimelineItem,
  TransferRouteMatch,
  UserStopInfo
} from '../types/bus.types.js';

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

export interface NearbyLineRpcRow {
  route_id: string;
  line_number: string;
  route_long_name: string;
  direction_id: 0 | 1;
  origin_he: string;
  destination_he: string;
  nearest_stop_id: string;
  nearest_stop_code: string;
  nearest_stop_name: string;
  nearest_stop_name_he: string;
  nearest_stop_sequence: number;
  stop_lat: number;
  stop_lon: number;
  distance_meters: number;
}

export interface NearbyLineTerminusRow {
  route_id: string;
  line_number: string;
  route_long_name: string;
  direction_id: 0 | 1;
  nearest_stop_id: string;
  nearest_stop_code: string;
  nearest_stop_name: string;
  nearest_stop_name_he: string;
  nearest_stop_sequence: number;
  stop_lat: number;
  stop_lon: number;
  distance_meters: number;
  destination_name: string;
  destination_he: string;
}

export interface UserRouteHistoryRow {
  id?: string;
  user_id: string;
  origin_lat: number;
  origin_lon: number;
  origin_stop_id?: string | null;
  origin_stop_name?: string | null;
  dest_label?: string | null;
  dest_lat?: number | null;
  dest_lon?: number | null;
  route_id?: string | null;
  line_number?: string | null;
  direction_id?: 0 | 1 | null;
  use_count: number;
  last_used_at: string;
  distance_meters: number;
}

export interface UpsertUserHistoryInput {
  userId: string;
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

export interface TwoTransferTripMatch {
  transfers_count: 1 | 2;
  leg1_route_id: string;
  leg1_route_short_name: string;
  leg1_route_long_name: string;
  leg1_direction_id: 0 | 1;
  origin_stop_id: string;
  origin_stop_code: string;
  origin_stop_name: string;
  origin_stop_name_he: string;
  origin_stop_sequence: number;
  origin_lat: number;
  origin_lon: number;
  xfer1_alight_stop_id: string;
  xfer1_alight_stop_code: string;
  xfer1_alight_stop_name: string;
  xfer1_alight_stop_name_he: string;
  xfer1_alight_stop_sequence: number;
  xfer1_alight_lat: number;
  xfer1_alight_lon: number;
  leg1_stops_between: number;
  xfer1_walk_meters: number;
  leg2_route_id: string;
  leg2_route_short_name: string;
  leg2_route_long_name: string;
  leg2_direction_id: 0 | 1;
  xfer1_board_stop_id: string;
  xfer1_board_stop_code: string;
  xfer1_board_stop_name: string;
  xfer1_board_stop_name_he: string;
  xfer1_board_stop_sequence: number;
  xfer1_board_lat: number;
  xfer1_board_lon: number;
  xfer2_alight_stop_id?: string | null;
  xfer2_alight_stop_code?: string | null;
  xfer2_alight_stop_name?: string | null;
  xfer2_alight_stop_name_he?: string | null;
  xfer2_alight_stop_sequence?: number | null;
  xfer2_alight_lat?: number | null;
  xfer2_alight_lon?: number | null;
  leg2_stops_between: number;
  xfer2_walk_meters: number;
  leg3_route_id?: string | null;
  leg3_route_short_name?: string | null;
  leg3_route_long_name?: string | null;
  leg3_direction_id?: 0 | 1 | null;
  xfer2_board_stop_id?: string | null;
  xfer2_board_stop_code?: string | null;
  xfer2_board_stop_name?: string | null;
  xfer2_board_stop_name_he?: string | null;
  xfer2_board_stop_sequence?: number | null;
  xfer2_board_lat?: number | null;
  xfer2_board_lon?: number | null;
  dest_stop_id: string;
  dest_stop_code: string;
  dest_stop_name: string;
  dest_stop_name_he: string;
  dest_stop_sequence: number;
  dest_lat: number;
  dest_lon: number;
  leg3_stops_between: number;
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

  private cleanSupabaseUrl(raw?: string): string | undefined {
    if (!raw) return undefined;
    return raw.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  }

  private ensureInit(): void {
    if (this.initialized) return;
    this.initialized = true;
    const url = this.cleanSupabaseUrl(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    if (url && key && url.startsWith('http')) {
      this.client = createClient(url, key);
    }
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
      this.pgPool = new pg.Pool({ connectionString: dbUrl });
    }
  }

  async verifyConnection(): Promise<boolean> {
    this.ensureInit();
    const url = this.cleanSupabaseUrl(process.env.SUPABASE_URL);
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
    let supabaseOk = false;

    if (url && key && url.startsWith('http')) {
      try {
        const response = await fetch(`${url}/rest/v1/`, {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`
          },
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok) {
          supabaseOk = true;
          const schemaCheck = this.client
            ? await this.client.from('routes').select('route_id').limit(1)
            : null;
          if (schemaCheck?.error && schemaCheck.error.code === 'PGRST205') {
            console.log(
              `[Supabase] Connected and authenticated successfully to ${url} (schema not applied yet; apply database/supabase_full_setup.sql in Supabase SQL Editor)`
            );
          } else {
            console.log(`[Supabase] Connected and authenticated successfully to ${url}`);
          }
        } else {
          console.error(
            `[Supabase] Authentication failed for ${url} (HTTP ${response.status})`
          );
        }
      } catch (err) {
        console.warn('[Supabase] Connectivity check failed:', (err as Error).message);
      }
    } else {
      console.warn('[Supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY not configured');
    }

    if (this.pgPool) {
      try {
        await this.pgPool.query('SELECT 1');
        console.log('[PostgreSQL] Local PostGIS pool connected successfully');
        return supabaseOk || true;
      } catch (err) {
        console.warn('[PostgreSQL] Local PostGIS pool check failed:', (err as Error).message);
      }
    }

    return supabaseOk;
  }

  async findNearestStopForLine(
    lineNum: string,
    userLat: number,
    userLon: number,
    preferredDirection?: 0 | 1,
    destinationHint?: string,
    routeId?: string
  ): Promise<NearestStopRpcRow> {
    this.ensureInit();

    if (routeId) {
      const dirId: 0 | 1 = preferredDirection ?? 0;
      const dirStops = await this.getDirectionStopCoords(routeId, dirId);
      if (dirStops.length > 0) {
        let best = dirStops[0];
        let minDist = Infinity;
        for (const s of dirStops) {
          const d = haversineDistanceMeters(userLat, userLon, s.lat, s.lon);
          if (d < minDist) {
            minDist = d;
            best = s;
          }
        }
        let routeShort = lineNum;
        let routeLong = `Line ${lineNum}`;
        if (this.client) {
          const { data: rMeta } = await this.client
            .from('routes')
            .select('route_short_name, route_long_name')
            .eq('route_id', routeId)
            .maybeSingle();
          if (rMeta) {
            routeShort = String(rMeta.route_short_name ?? routeShort);
            routeLong = String(rMeta.route_long_name ?? routeLong);
          }
        } else if (this.pgPool) {
          const rRes = await this.pgPool.query(
            `SELECT route_short_name, route_long_name FROM routes WHERE route_id = $1 LIMIT 1`,
            [routeId]
          );
          if (rRes.rows[0]) {
            routeShort = String(rRes.rows[0].route_short_name ?? routeShort);
            routeLong = String(rRes.rows[0].route_long_name ?? routeLong);
          }
        }
        return {
          route_id: routeId,
          direction_id: dirId,
          stop_id: best.stop_id,
          stop_sequence: best.stop_sequence,
          stop_code: best.stop_code,
          stop_name: best.stop_name,
          stop_name_he: best.stop_name_he,
          stop_lat: best.lat,
          stop_lon: best.lon,
          route_short_name: routeShort,
          route_long_name: routeLong,
          distance_meters: Math.round(minDist)
        };
      }
    }

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

    if (this.client) {
      try {
        const { data, error } = await this.client.rpc('get_direction_stop_coords', {
          p_route_id: routeId,
          p_direction_id: directionId
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((r: Record<string, unknown>) => ({
            stop_id: String(r.stop_id),
            stop_code: String(r.stop_code),
            stop_name: String(r.stop_name),
            stop_name_he: String(r.stop_name_he ?? r.stop_name),
            stop_sequence: Number(r.stop_sequence),
            lat: Number(r.lat),
            lon: Number(r.lon)
          }));
        }
      } catch (err) {
        console.warn('[Supabase] get_direction_stop_coords RPC fallback:', (err as Error).message);
      }
    }

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

    return allStops.map((stop) => {
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

  private mapDirectRouteRow(row: Record<string, unknown>): DirectRouteMatch {
    return {
      route_id: String(row.route_id),
      route_short_name: String(row.route_short_name),
      route_long_name: String(row.route_long_name ?? `Line ${row.route_short_name}`),
      direction_id: Number(row.direction_id) === 1 ? 1 : 0,
      origin_stop_id: String(row.origin_stop_id),
      origin_stop_code: String(row.origin_stop_code ?? row.origin_stop_id),
      origin_stop_name: String(row.origin_stop_name),
      origin_stop_name_he: String(row.origin_stop_name_he ?? row.origin_stop_name),
      origin_stop_sequence: Number(row.origin_stop_sequence),
      origin_lat: Number(row.origin_lat),
      origin_lon: Number(row.origin_lon),
      dest_stop_id: String(row.dest_stop_id),
      dest_stop_code: String(row.dest_stop_code ?? row.dest_stop_id),
      dest_stop_name: String(row.dest_stop_name),
      dest_stop_name_he: String(row.dest_stop_name_he ?? row.dest_stop_name),
      dest_stop_sequence: Number(row.dest_stop_sequence),
      dest_lat: Number(row.dest_lat),
      dest_lon: Number(row.dest_lon),
      stops_between: Number(row.stops_between)
    };
  }

  async findDirectRoutesBetweenPoints(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
    radiusMeters = 600
  ): Promise<DirectRouteMatch[]> {
    this.ensureInit();

    const radiiToTry = Array.from(new Set([radiusMeters, Math.max(1100, radiusMeters)]));
    const collected = new Map<string, DirectRouteMatch>();
    let dbSucceeded = false;

    for (const radius of radiiToTry) {
      let batch: DirectRouteMatch[] = [];

      if (this.client) {
        try {
          const { data, error } = await this.client.rpc('find_direct_routes_between_points', {
            origin_lat: originLat,
            origin_lon: originLon,
            dest_lat: destLat,
            dest_lon: destLon,
            radius_meters: radius
          });
          if (!error && Array.isArray(data)) {
            dbSucceeded = true;
            batch = data.map((row) => this.mapDirectRouteRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[Supabase] find_direct_routes RPC fallback:', (err as Error).message);
        }
      }

      if (batch.length === 0 && this.pgPool) {
        try {
          const res = await this.pgPool.query(
            `SELECT * FROM find_direct_routes_between_points($1, $2, $3, $4, $5)`,
            [originLat, originLon, destLat, destLon, radius]
          );
          dbSucceeded = true;
          batch = res.rows.map((row) => this.mapDirectRouteRow(row as Record<string, unknown>));
        } catch (err) {
          console.warn('[PostgreSQL] find_direct_routes query error:', (err as Error).message);
        }
      }

      for (const item of batch) {
        const key = `${item.route_id}:${item.direction_id}`;
        if (!collected.has(key)) {
          collected.set(key, item);
        }
      }

      if (collected.size >= 3) {
        break;
      }
    }

    if (collected.size > 0) {
      return Array.from(collected.values());
    }

    // If database queried cleanly and found 0 direct routes, do not fabricate direct matches;
    // let the transfer router compute 1-transfer connections.
    if (dbSucceeded) {
      return [];
    }

    return [];
  }

  private mapTransferRouteRow(row: Record<string, unknown>): TransferRouteMatch {
    return {
      leg1_route_id: String(row.leg1_route_id),
      leg1_route_short_name: String(row.leg1_route_short_name),
      leg1_route_long_name: String(row.leg1_route_long_name ?? ''),
      leg1_direction_id: Number(row.leg1_direction_id) === 1 ? 1 : 0,
      origin_stop_id: String(row.origin_stop_id),
      origin_stop_code: String(row.origin_stop_code ?? row.origin_stop_id),
      origin_stop_name: String(row.origin_stop_name),
      origin_stop_name_he: String(row.origin_stop_name_he ?? row.origin_stop_name),
      origin_stop_sequence: Number(row.origin_stop_sequence),
      origin_lat: Number(row.origin_lat),
      origin_lon: Number(row.origin_lon),
      xfer_alight_stop_id: String(row.xfer_alight_stop_id),
      xfer_alight_stop_code: String(row.xfer_alight_stop_code ?? row.xfer_alight_stop_id),
      xfer_alight_stop_name: String(row.xfer_alight_stop_name),
      xfer_alight_stop_name_he: String(row.xfer_alight_stop_name_he ?? row.xfer_alight_stop_name),
      xfer_alight_stop_sequence: Number(row.xfer_alight_stop_sequence),
      xfer_alight_lat: Number(row.xfer_alight_lat),
      xfer_alight_lon: Number(row.xfer_alight_lon),
      leg1_stops_between: Number(row.leg1_stops_between),
      transfer_walk_meters_actual: Number(row.transfer_walk_meters_actual ?? 0),
      leg2_route_id: String(row.leg2_route_id),
      leg2_route_short_name: String(row.leg2_route_short_name),
      leg2_route_long_name: String(row.leg2_route_long_name ?? ''),
      leg2_direction_id: Number(row.leg2_direction_id) === 1 ? 1 : 0,
      xfer_board_stop_id: String(row.xfer_board_stop_id),
      xfer_board_stop_code: String(row.xfer_board_stop_code ?? row.xfer_board_stop_id),
      xfer_board_stop_name: String(row.xfer_board_stop_name),
      xfer_board_stop_name_he: String(row.xfer_board_stop_name_he ?? row.xfer_board_stop_name),
      xfer_board_stop_sequence: Number(row.xfer_board_stop_sequence),
      xfer_board_lat: Number(row.xfer_board_lat),
      xfer_board_lon: Number(row.xfer_board_lon),
      dest_stop_id: String(row.dest_stop_id),
      dest_stop_code: String(row.dest_stop_code ?? row.dest_stop_id),
      dest_stop_name: String(row.dest_stop_name),
      dest_stop_name_he: String(row.dest_stop_name_he ?? row.dest_stop_name),
      dest_stop_sequence: Number(row.dest_stop_sequence),
      dest_lat: Number(row.dest_lat),
      dest_lon: Number(row.dest_lon),
      leg2_stops_between: Number(row.leg2_stops_between)
    };
  }

  async findTransferRoutesBetweenPoints(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
    radiusMeters = 650,
    transferWalkMeters = 260
  ): Promise<TransferRouteMatch[]> {
    this.ensureInit();

    const radiiToTry = Array.from(new Set([radiusMeters, Math.max(1100, radiusMeters)]));
    const collected = new Map<string, TransferRouteMatch>();
    const distinctLeg1Routes = new Set<string>();

    for (const radius of radiiToTry) {
      let batch: TransferRouteMatch[] = [];

      if (this.client) {
        try {
          const { data, error } = await this.client.rpc('find_transfer_routes_between_points', {
            origin_lat: originLat,
            origin_lon: originLon,
            dest_lat: destLat,
            dest_lon: destLon,
            radius_meters: radius,
            transfer_walk_meters: transferWalkMeters
          });
          if (!error && Array.isArray(data) && data.length > 0) {
            batch = data.map((row) => this.mapTransferRouteRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[Supabase] find_transfer_routes RPC fallback:', (err as Error).message);
        }
      }

      if (batch.length === 0 && this.pgPool) {
        try {
          const res = await this.pgPool.query(
            `SELECT * FROM find_transfer_routes_between_points($1, $2, $3, $4, $5, $6)`,
            [originLat, originLon, destLat, destLon, radius, transferWalkMeters]
          );
          if (res.rows.length > 0) {
            batch = res.rows.map((row) => this.mapTransferRouteRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[PostgreSQL] find_transfer_routes query error:', (err as Error).message);
        }
      }

      for (const item of batch) {
        const key = `${item.leg1_route_id}:${item.leg1_direction_id}:${item.leg2_route_id}:${item.leg2_direction_id}`;
        if (!collected.has(key)) {
          collected.set(key, item);
          distinctLeg1Routes.add(item.leg1_route_id);
        }
      }

      if (distinctLeg1Routes.size >= 3) {
        break;
      }
    }

    return Array.from(collected.values());
  }

  private mapNearbyLineRow(row: Record<string, unknown>): NearbyLineRpcRow {
    return {
      route_id: String(row.route_id),
      line_number: String(row.line_number ?? row.route_short_name ?? ''),
      route_long_name: String(row.route_long_name ?? ''),
      direction_id: Number(row.direction_id) === 1 ? 1 : 0,
      origin_he: String(row.origin_he ?? ''),
      destination_he: String(row.destination_he ?? row.route_long_name ?? ''),
      nearest_stop_id: String(row.nearest_stop_id),
      nearest_stop_code: String(row.nearest_stop_code ?? row.nearest_stop_id),
      nearest_stop_name: String(row.nearest_stop_name),
      nearest_stop_name_he: String(row.nearest_stop_name_he ?? row.nearest_stop_name),
      nearest_stop_sequence: Number(row.nearest_stop_sequence),
      stop_lat: Number(row.stop_lat),
      stop_lon: Number(row.stop_lon),
      distance_meters: Math.round(Number(row.distance_meters ?? 0))
    };
  }

  /**
   * Geo-filtered bus line lookup around `(userLat, userLon)` using PostGIS `find_nearby_lines_by_number`
   * with progressive radius fallback and PostgREST/table-scan resilience.
   */
  async findNearbyLinesByNumber(
    lineNum: string,
    userLat: number,
    userLon: number,
    radiusMeters = 600
  ): Promise<NearbyLineRpcRow[]> {
    this.ensureInit();
    const cleanedLine = lineNum.trim();
    if (!cleanedLine) return [];

    const radiiToTry = [radiusMeters, Math.max(1500, radiusMeters * 2), 3500];

    for (const radius of radiiToTry) {
      if (this.client) {
        try {
          const { data, error } = await this.client.rpc('find_nearby_lines_by_number', {
            line_num: cleanedLine,
            user_lat: userLat,
            user_lon: userLon,
            radius_meters: radius
          });
          if (!error && Array.isArray(data) && data.length > 0) {
            return data.map((row) => this.mapNearbyLineRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[Supabase] find_nearby_lines RPC fallback:', (err as Error).message);
        }
      }

      if (this.pgPool) {
        try {
          const res = await this.pgPool.query(
            `SELECT * FROM find_nearby_lines_by_number($1, $2, $3, $4)`,
            [cleanedLine, userLat, userLon, radius]
          );
          if (res.rows.length > 0) {
            return res.rows.map((row) => this.mapNearbyLineRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[PostgreSQL] find_nearby_lines query error:', (err as Error).message);
        }
      }
    }

    // PostgREST table fallback when RPC function isn't loaded in remote Supabase schema yet
    if (this.client) {
      try {
        const escaped = cleanedLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const linePattern = new RegExp(`^${escaped}([^0-9]|$)`, 'i');
        const { data: routesData } = await this.client
          .from('routes')
          .select('route_id, route_short_name, route_long_name')
          .ilike('route_short_name', `${cleanedLine}%`)
          .limit(20);

        const matched = (routesData ?? []).filter((r) =>
          linePattern.test(String(r.route_short_name ?? '').trim())
        );

        const candidates: NearbyLineRpcRow[] = [];
        for (const r of matched) {
          for (const dir of [0, 1] as const) {
            const stops = await this.getDirectionStopCoords(String(r.route_id), dir);
            if (stops.length === 0) continue;
            let bestStop = stops[0];
            let minDist = Infinity;
            for (const s of stops) {
              const d = haversineDistanceMeters(userLat, userLon, s.lat, s.lon);
              if (d < minDist) {
                minDist = d;
                bestStop = s;
              }
            }
            if (minDist <= 3500) {
              candidates.push({
                route_id: String(r.route_id),
                line_number: String(r.route_short_name),
                route_long_name: String(r.route_long_name ?? ''),
                direction_id: dir,
                origin_he: stops[0].stop_name_he,
                destination_he: stops[stops.length - 1].stop_name_he,
                nearest_stop_id: bestStop.stop_id,
                nearest_stop_code: bestStop.stop_code,
                nearest_stop_name: bestStop.stop_name,
                nearest_stop_name_he: bestStop.stop_name_he,
                nearest_stop_sequence: bestStop.stop_sequence,
                stop_lat: bestStop.lat,
                stop_lon: bestStop.lon,
                distance_meters: Math.round(minDist)
              });
            }
          }
        }

        if (candidates.length > 0) {
          return candidates.sort((a, b) => a.distance_meters - b.distance_meters);
        }
        return [];
      } catch (err) {
        console.warn('[Supabase] Table scan fallback error:', (err as Error).message);
      }
    }

    if (this.pgPool || this.client) {
      return [];
    }

    const fallbackStop = await this.findNearestStopForLine(cleanedLine, userLat, userLon);
    return fallbackStop.distance_meters <= 3500
      ? [
          {
            route_id: fallbackStop.route_id,
            line_number: fallbackStop.route_short_name,
            route_long_name: fallbackStop.route_long_name,
            direction_id: fallbackStop.direction_id,
            origin_he: fallbackStop.direction_id === 0 ? 'טירת כרמל' : 'חוף הכרמל חיפה',
            destination_he: fallbackStop.direction_id === 0 ? 'חוף הכרמל חיפה' : 'טירת כרמל',
            nearest_stop_id: fallbackStop.stop_id,
            nearest_stop_code: fallbackStop.stop_code,
            nearest_stop_name: fallbackStop.stop_name,
            nearest_stop_name_he: fallbackStop.stop_name_he,
            nearest_stop_sequence: fallbackStop.stop_sequence,
            stop_lat: fallbackStop.stop_lat,
            stop_lon: fallbackStop.stop_lon,
            distance_meters: fallbackStop.distance_meters
          }
        ]
      : [];
  }

  async findDirectTrips(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
    radiusMeters = 500
  ): Promise<DirectRouteMatch[]> {
    return this.findDirectRoutesBetweenPoints(originLat, originLon, destLat, destLon, radiusMeters);
  }

  async findTransferTrips(
    originLat: number,
    originLon: number,
    destLat: number,
    destLon: number,
    radiusMeters = 500,
    maxTransfers = 2
  ): Promise<TwoTransferTripMatch[]> {
    this.ensureInit();
    const radiiToTry = Array.from(new Set([radiusMeters, Math.max(1100, radiusMeters)]));
    const collected = new Map<string, TwoTransferTripMatch>();
    const distinctLeg1Routes = new Set<string>();

    for (const radius of radiiToTry) {
      let batch: TwoTransferTripMatch[] = [];

      if (this.client) {
        try {
          const { data, error } = await this.client.rpc('find_transfer_trips', {
            origin_lat: originLat,
            origin_lon: originLon,
            dest_lat: destLat,
            dest_lon: destLon,
            radius_meters: radius,
            max_transfers: maxTransfers
          });
          if (!error && Array.isArray(data) && data.length > 0) {
            batch = data as TwoTransferTripMatch[];
          }
        } catch (err) {
          console.warn('[Supabase] find_transfer_trips RPC fallback:', (err as Error).message);
        }
      }

      if (batch.length === 0 && this.pgPool) {
        try {
          const res = await this.pgPool.query(
            `SELECT * FROM find_transfer_trips($1, $2, $3, $4, $5, $6)`,
            [originLat, originLon, destLat, destLon, radius, maxTransfers]
          );
          if (res.rows.length > 0) {
            batch = res.rows as TwoTransferTripMatch[];
          }
        } catch (err) {
          console.warn('[PostgreSQL] find_transfer_trips error:', (err as Error).message);
        }
      }

      for (const item of batch) {
        const key = `${item.leg1_route_id}:${item.leg1_direction_id}:${item.leg2_route_id}:${item.leg2_direction_id}:${item.leg3_route_id ?? ''}`;
        if (!collected.has(key)) {
          collected.set(key, item);
          distinctLeg1Routes.add(item.leg1_route_id);
        }
      }

      if (distinctLeg1Routes.size >= 3) {
        break;
      }
    }

    if (collected.size > 0) {
      return Array.from(collected.values());
    }

    // Compatibility fallback to findTransferRoutesBetweenPoints
    const singleTransfers = await this.findTransferRoutesBetweenPoints(
      originLat,
      originLon,
      destLat,
      destLon,
      radiusMeters,
      260
    );
    return singleTransfers.map((m) => ({
      transfers_count: 1 as const,
      leg1_route_id: m.leg1_route_id,
      leg1_route_short_name: m.leg1_route_short_name,
      leg1_route_long_name: m.leg1_route_long_name,
      leg1_direction_id: m.leg1_direction_id,
      origin_stop_id: m.origin_stop_id,
      origin_stop_code: m.origin_stop_code,
      origin_stop_name: m.origin_stop_name,
      origin_stop_name_he: m.origin_stop_name_he,
      origin_stop_sequence: m.origin_stop_sequence,
      origin_lat: m.origin_lat,
      origin_lon: m.origin_lon,
      xfer1_alight_stop_id: m.xfer_alight_stop_id,
      xfer1_alight_stop_code: m.xfer_alight_stop_code,
      xfer1_alight_stop_name: m.xfer_alight_stop_name,
      xfer1_alight_stop_name_he: m.xfer_alight_stop_name_he,
      xfer1_alight_stop_sequence: m.xfer_alight_stop_sequence,
      xfer1_alight_lat: m.xfer_alight_lat,
      xfer1_alight_lon: m.xfer_alight_lon,
      leg1_stops_between: m.leg1_stops_between,
      xfer1_walk_meters: m.transfer_walk_meters_actual,
      leg2_route_id: m.leg2_route_id,
      leg2_route_short_name: m.leg2_route_short_name,
      leg2_route_long_name: m.leg2_route_long_name,
      leg2_direction_id: m.leg2_direction_id,
      xfer1_board_stop_id: m.xfer_board_stop_id,
      xfer1_board_stop_code: m.xfer_board_stop_code,
      xfer1_board_stop_name: m.xfer_board_stop_name,
      xfer1_board_stop_name_he: m.xfer_board_stop_name_he,
      xfer1_board_stop_sequence: m.xfer_board_stop_sequence,
      xfer1_board_lat: m.xfer_board_lat,
      xfer1_board_lon: m.xfer_board_lon,
      leg2_stops_between: m.leg2_stops_between,
      xfer2_walk_meters: 0,
      dest_stop_id: m.dest_stop_id,
      dest_stop_code: m.dest_stop_code,
      dest_stop_name: m.dest_stop_name,
      dest_stop_name_he: m.dest_stop_name_he,
      dest_stop_sequence: m.dest_stop_sequence,
      dest_lat: m.dest_lat,
      dest_lon: m.dest_lon,
      leg3_stops_between: 0
    }));
  }

  private mapNearbyTerminusRow(row: Record<string, unknown>): NearbyLineTerminusRow {
    return {
      route_id: String(row.route_id),
      line_number: String(row.line_number ?? row.route_short_name ?? ''),
      route_long_name: String(row.route_long_name ?? ''),
      direction_id: Number(row.direction_id) === 1 ? 1 : 0,
      nearest_stop_id: String(row.nearest_stop_id),
      nearest_stop_code: String(row.nearest_stop_code ?? row.nearest_stop_id),
      nearest_stop_name: String(row.nearest_stop_name),
      nearest_stop_name_he: String(row.nearest_stop_name_he ?? row.nearest_stop_name),
      nearest_stop_sequence: Number(row.nearest_stop_sequence ?? 1),
      stop_lat: Number(row.stop_lat),
      stop_lon: Number(row.stop_lon),
      distance_meters: Math.round(Number(row.distance_meters ?? 0)),
      destination_name: String(row.destination_name ?? row.destination_he ?? row.route_long_name ?? ''),
      destination_he: String(row.destination_he ?? row.destination_name ?? row.route_long_name ?? '')
    };
  }

  async getNearbyLinesAndTermini(
    userLat: number,
    userLon: number,
    radiusMeters = 500,
    maxLines = 8
  ): Promise<NearbyLineTerminusRow[]> {
    this.ensureInit();
    const radiiToTry = Array.from(new Set([radiusMeters, Math.max(900, radiusMeters), 1600]));

    for (const radius of radiiToTry) {
      if (this.client) {
        try {
          const { data, error } = await this.client.rpc('get_nearby_lines_and_termini', {
            user_lat: userLat,
            user_lon: userLon,
            radius_meters: radius,
            max_lines: maxLines
          });
          if (!error && Array.isArray(data) && data.length > 0) {
            return data.map((row) => this.mapNearbyTerminusRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[Supabase] get_nearby_lines_and_termini RPC fallback:', (err as Error).message);
        }
      }

      if (this.pgPool) {
        try {
          const res = await this.pgPool.query(
            `SELECT * FROM get_nearby_lines_and_termini($1, $2, $3, $4)`,
            [userLat, userLon, radius, maxLines]
          );
          if (res.rows.length > 0) {
            return res.rows.map((row) => this.mapNearbyTerminusRow(row as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[PostgreSQL] get_nearby_lines_and_termini error:', (err as Error).message);
        }
      }
    }

    // PostgREST table scan fallback when get_nearby_lines_and_termini RPC is not yet installed on remote Supabase
    if (this.client) {
      try {
        const { data: routesData } = await this.client
          .from('routes')
          .select('route_id, route_short_name, route_long_name')
          .limit(30);

        const matches: NearbyLineTerminusRow[] = [];
        for (const r of routesData ?? []) {
          for (const dir of [0, 1] as const) {
            const stops = await this.getDirectionStopCoords(String(r.route_id), dir);
            if (stops.length < 2) continue;
            const terminal = stops[stops.length - 1];
            let bestStop: RouteStopCoord | null = null;
            let minDist = Infinity;

            for (const s of stops.slice(0, -1)) {
              const d = haversineDistanceMeters(userLat, userLon, s.lat, s.lon);
              if (d < minDist) {
                minDist = d;
                bestStop = s;
              }
            }

            if (bestStop && minDist <= 1600) {
              matches.push({
                route_id: String(r.route_id),
                line_number: String(r.route_short_name),
                route_long_name: String(r.route_long_name ?? ''),
                direction_id: dir,
                nearest_stop_id: bestStop.stop_id,
                nearest_stop_code: bestStop.stop_code,
                nearest_stop_name: bestStop.stop_name,
                nearest_stop_name_he: bestStop.stop_name_he,
                nearest_stop_sequence: bestStop.stop_sequence,
                stop_lat: bestStop.lat,
                stop_lon: bestStop.lon,
                distance_meters: Math.round(minDist),
                destination_name: terminal.stop_name,
                destination_he: terminal.stop_name_he
              });
            }
          }
        }

        if (matches.length > 0) {
          return matches
            .sort((a, b) => a.distance_meters - b.distance_meters || a.line_number.localeCompare(b.line_number))
            .slice(0, maxLines);
        }
      } catch (err) {
        console.warn('[Supabase] getNearbyLinesAndTermini table fallback error:', (err as Error).message);
      }
    }

    return [];
  }

  private resolveCityKeywords(cityName: string): string[] {
    const q = cityName.trim().toLowerCase();
    if (/חיפה|хайф|haifa/.test(q)) return ['חיפה', 'haifa'];
    if (/טירת|тират|tirat/.test(q)) return ['טירת כרמל', 'tirat carmel'];
    if (/תל.?אביב|тель.?авив|tel.?aviv|\btlv\b/.test(q)) return ['תל אביב', 'tel aviv'];
    if (/ירושלים|иерусалим|jerusalem/.test(q)) return ['ירושלים', 'jerusalem'];
    if (/אשדוד|ашдод|ashdod/.test(q)) return ['אשדוד', 'ashdod'];
    if (/קריית.?גת|קרית.?גת|кирьят.?гат|kiryat.?gat/.test(q)) return ['קריית גת', 'kiryat gat'];
    if (/נתניה|нетани|netanya/.test(q)) return ['נתניה', 'netanya'];
    if (/אשקלון|ашкелон|ashkelon/.test(q)) return ['אשקלון', 'ashkelon'];
    if (/באר.?שבע|беэр.?шев|beer.?sheva/.test(q)) return ['באר שבע', 'beer sheva'];
    if (/חדרה|хадер|hadera/.test(q)) return ['חדרה', 'hadera'];
    if (/עכו|акко|acre|akko/.test(q)) return ['עכו', 'acre', 'akko'];
    if (/נהריה|нагари|nahariya/.test(q)) return ['נהריה', 'nahariya'];
    return [cityName.trim()];
  }

  private resolveStreetKeywords(streetName: string): string[] {
    const q = streetName
      .trim()
      .toLowerCase()
      .replace(/^(?:улица|ул\.?|на\s+улицу|проспект|пр\.?|бульвар|street|st\.?|ave\.?|blvd\.?|רחוב|רח׳|שדרות|שד׳)\s+/i, '')
      .trim();
    if (/חורב|хорев|horev/.test(q)) return ['חורב', 'horev'];
    if (/הרצל|герцл|herzl/.test(q)) return ['הרצל', 'herzl'];
    if (/פרויד|фрейд|freud/.test(q)) return ['פרויד', 'freud'];
    if (/מוריה|мория|moriah/.test(q)) return ['מוריה', 'moriah'];
    if (/פיק|пика|pika/.test(q)) return ['פיק', 'pika'];
    if (/איינשטיין|эйнштейн|einstein/.test(q)) return ['איינשטיין', 'einstein'];
    if (/אבא.?חושי|аба.?хуши|abba.?hushi/.test(q)) return ['אבא חושי', 'abba hushi'];
    if (/רוטשילד|ротшильд|rothschild/.test(q)) return ['רוטשילד', 'rothschild'];
    if (/דיזנגוף|дизенгоф|dizengoff/.test(q)) return ['דיזנגוף', 'dizengoff'];
    if (/ארלוזורוב|арлозоров|arlozorov/.test(q)) return ['ארלוזורוב', 'arlozorov'];
    if (/יפו|яффо|jaffa/.test(q)) return ['יפו', 'jaffa'];
    if (/ויצמן|вейцман|weizmann/.test(q)) return ['ויצמן', 'weizmann'];
    if (/ז.?בוטינסקי|жаботинск|jabotinsky/.test(q)) return ['בוטינסקי', 'jabotinsky'];
    if (/הנשיא|ха-?наси|hanassi/.test(q)) return ['הנשיא', 'hanassi'];
    if (/ההגנה|ха-?хагана|hagana/.test(q)) return ['ההגנה', 'hagana'];
    if (/נרקיסים|наркисим|narkisim/.test(q)) return ['נרקיסים', 'narkisim'];
    return q ? [q] : [];
  }

  private mapResolvedStopRow(row: Record<string, unknown>): ResolvedStopOption {
    return {
      stop_id: String(row.stop_id),
      stop_code: String(row.stop_code ?? row.stop_id),
      stop_name: String(row.stop_name),
      stop_name_he: String(row.stop_name_he ?? row.stop_name),
      lat: Number(row.stop_lat ?? row.lat),
      lon: Number(row.stop_lon ?? row.lon),
      ...(row.routes_count !== undefined ? { routes_count: Number(row.routes_count) } : {}),
      ...(row.distance_meters !== undefined && row.distance_meters !== null
        ? { distance_meters: Math.round(Number(row.distance_meters)) }
        : {}),
      ...(row.is_central_hub !== undefined ? { is_central_hub: Boolean(row.is_central_hub) } : {}),
      ...(row.is_hub !== undefined ? { is_hub: Boolean(row.is_hub) } : {})
    };
  }

  /**
   * Finds the primary central bus station or main transit hub of a city via GTFS/PostGIS.
   */
  async findCentralStopForCity(cityName: string): Promise<ResolvedStopOption | null> {
    this.ensureInit();
    const cleaned = cityName.trim();
    if (!cleaned) return null;

    if (this.client) {
      try {
        const { data, error } = await this.client.rpc('find_central_stop_for_city', {
          city_name: cleaned
        });
        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row && typeof row.stop_id === 'string') {
          return this.mapResolvedStopRow(row as Record<string, unknown>);
        }
      } catch (err) {
        console.warn('[Supabase] find_central_stop_for_city RPC fallback:', (err as Error).message);
      }
    }

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT * FROM find_central_stop_for_city($1)`,
          [cleaned]
        );
        if (res.rows[0]) {
          return this.mapResolvedStopRow(res.rows[0] as Record<string, unknown>);
        }
      } catch (err) {
        console.warn('[PostgreSQL] find_central_stop_for_city query error:', (err as Error).message);
      }
    }

    // PostgREST fallback scan on stops + route_stops when RPC isn't installed remotely
    if (this.client) {
      try {
        const keywords = this.resolveCityKeywords(cleaned);
        const orFilter = keywords
          .flatMap((kw) => [`stop_name.ilike.%${kw}%`, `stop_name_he.ilike.%${kw}%`])
          .join(',');
        const { data: stopsData } = await this.client
          .from('stops')
          .select('stop_id, stop_code, stop_name, stop_name_he')
          .or(orFilter)
          .limit(30);

        if (stopsData && stopsData.length > 0) {
          const stopIds = stopsData.map((s) => String(s.stop_id));
          const { data: rsData } = await this.client
            .from('route_stops')
            .select('stop_id, route_id')
            .in('stop_id', stopIds);

          const routeMap = new Map<string, Set<string>>();
          for (const rs of rsData ?? []) {
            const sid = String(rs.stop_id);
            const set = routeMap.get(sid) ?? new Set<string>();
            set.add(String(rs.route_id));
            routeMap.set(sid, set);
          }

          const scoreStop = (s: { stop_id: string; stop_name: string; stop_name_he?: string | null }) => {
            const txt = `${s.stop_name} ${s.stop_name_he ?? ''}`;
            const isCbs = /(תחנה\s*מרכזית|ת\.\s*מרכזית|Central Bus Station|רציפים בינעירוני)/i.test(txt) ? 100 : 0;
            const isHub = /(רכבת\s*מרכז|מסוף|סבידור|חוף\s*הכרמל|Central Train|Savidor|Hof HaCarmel)/i.test(txt) ? 80 : 0;
            const isDrop = /הורדה/i.test(txt) ? -15 : 0;
            const routesCnt = routeMap.get(s.stop_id)?.size ?? 0;
            return isCbs + isHub + isDrop + routesCnt * 3;
          };

          const ranked = [...stopsData].sort((a, b) => scoreStop(b) - scoreStop(a));
          const best = ranked[0];
          // Retrieve coordinates via getDirectionStopCoords if associated with a route
          const bestRouteId = Array.from(routeMap.get(String(best.stop_id)) ?? [])[0];
          if (bestRouteId) {
            const coords =
              (await this.getDirectionStopCoords(bestRouteId, 0)).find((c) => c.stop_id === best.stop_id) ??
              (await this.getDirectionStopCoords(bestRouteId, 1)).find((c) => c.stop_id === best.stop_id);
            if (coords) {
              return {
                stop_id: coords.stop_id,
                stop_code: coords.stop_code,
                stop_name: coords.stop_name,
                stop_name_he: coords.stop_name_he,
                lat: coords.lat,
                lon: coords.lon,
                routes_count: routeMap.get(String(best.stop_id))?.size ?? 1,
                is_central_hub: scoreStop(best) >= 80
              };
            }
          }
        }
      } catch (err) {
        console.warn('[Supabase] findCentralStopForCity table fallback error:', (err as Error).message);
      }
    }

    return null;
  }

  /**
   * Finds stops along a named street corridor, ordered by route connectivity (`route_stops` count),
   * hub markers, and optional proximity. Returns up to 6 stops (primary popular stop + alternatives).
   */
  async findPopularStopOnStreet(
    streetName: string,
    cityHint?: string,
    nearLat?: number,
    nearLon?: number
  ): Promise<ResolvedStopOption[]> {
    this.ensureInit();
    const cleaned = streetName.trim();
    if (!cleaned) return [];

    if (this.client) {
      try {
        const { data, error } = await this.client.rpc('find_popular_stop_on_street', {
          street_name: cleaned,
          city_hint: cityHint ?? null,
          near_lat: nearLat ?? null,
          near_lon: nearLon ?? null
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((row) => this.mapResolvedStopRow(row as Record<string, unknown>));
        }
      } catch (err) {
        console.warn('[Supabase] find_popular_stop_on_street RPC fallback:', (err as Error).message);
      }
    }

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT * FROM find_popular_stop_on_street($1, $2, $3, $4)`,
          [cleaned, cityHint ?? null, nearLat ?? null, nearLon ?? null]
        );
        if (res.rows.length > 0) {
          return res.rows.map((row) => this.mapResolvedStopRow(row as Record<string, unknown>));
        }
      } catch (err) {
        console.warn('[PostgreSQL] find_popular_stop_on_street error:', (err as Error).message);
      }
    }

    if (this.client) {
      try {
        const stKeywords = this.resolveStreetKeywords(cleaned);
        if (stKeywords.length === 0) return [];
        const orFilter = stKeywords
          .flatMap((kw) => [`stop_name.ilike.%${kw}%`, `stop_name_he.ilike.%${kw}%`])
          .join(',');
        const { data: stopsData } = await this.client
          .from('stops')
          .select('stop_id, stop_code, stop_name, stop_name_he')
          .or(orFilter)
          .limit(20);

        if (stopsData && stopsData.length > 0) {
          const stopIds = stopsData.map((s) => String(s.stop_id));
          const { data: rsData } = await this.client
            .from('route_stops')
            .select('stop_id, route_id, direction_id')
            .in('stop_id', stopIds);

          const routeCount = new Map<string, Set<string>>();
          const sampleDir = new Map<string, { routeId: string; dir: 0 | 1 }>();
          for (const rs of rsData ?? []) {
            const sid = String(rs.stop_id);
            const set = routeCount.get(sid) ?? new Set<string>();
            set.add(String(rs.route_id));
            routeCount.set(sid, set);
            if (!sampleDir.has(sid)) {
              sampleDir.set(sid, {
                routeId: String(rs.route_id),
                dir: Number(rs.direction_id) === 1 ? 1 : 0
              });
            }
          }

          const cityKeywords = cityHint ? this.resolveCityKeywords(cityHint) : [];
          const cityFiltered =
            cityKeywords.length > 0
              ? stopsData.filter((s) =>
                  cityKeywords.some((ck) =>
                    `${s.stop_name} ${s.stop_name_he ?? ''}`.toLowerCase().includes(ck.toLowerCase())
                  )
                )
              : [];
          const pool = cityFiltered.length > 0 ? cityFiltered : stopsData;

          const resolved: ResolvedStopOption[] = [];
          for (const s of pool) {
            const ref = sampleDir.get(String(s.stop_id));
            if (!ref) continue;
            const coords = (await this.getDirectionStopCoords(ref.routeId, ref.dir)).find(
              (c) => c.stop_id === s.stop_id
            );
            if (!coords) continue;
            const dist =
              nearLat !== undefined && nearLon !== undefined
                ? Math.round(haversineDistanceMeters(nearLat, nearLon, coords.lat, coords.lon))
                : undefined;
            resolved.push({
              stop_id: coords.stop_id,
              stop_code: coords.stop_code,
              stop_name: coords.stop_name,
              stop_name_he: coords.stop_name_he,
              lat: coords.lat,
              lon: coords.lon,
              routes_count: routeCount.get(String(s.stop_id))?.size ?? 1,
              distance_meters: dist,
              is_hub: /(מרכז|קניון|צומת|מרפאה|Center|Mall|Junction|Clinic)/i.test(
                `${coords.stop_name} ${coords.stop_name_he}`
              )
            });
          }

          return resolved
            .sort((a, b) => (b.routes_count ?? 0) - (a.routes_count ?? 0) || (a.distance_meters ?? 0) - (b.distance_meters ?? 0))
            .slice(0, 6);
        }
      } catch (err) {
        console.warn('[Supabase] findPopularStopOnStreet fallback error:', (err as Error).message);
      }
    }

    return [];
  }

  /**
   * Finds nearest physical bus stops around `(lat, lon)` within walking radius (~450m, expanding if needed).
   */
  async findNearestStopsToPoint(
    lat: number,
    lon: number,
    radiusMeters = 480
  ): Promise<ResolvedStopOption[]> {
    this.ensureInit();
    const radii = Array.from(new Set([radiusMeters, Math.max(1200, radiusMeters)]));

    if (this.pgPool) {
      for (const radius of radii) {
        try {
          const res = await this.pgPool.query(
            `WITH target AS (
               SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS geog
             )
             SELECT
               s.stop_id,
               s.stop_code,
               s.stop_name,
               COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
               ST_Y(s.location::geometry)::FLOAT AS stop_lat,
               ST_X(s.location::geometry)::FLOAT AS stop_lon,
               COUNT(DISTINCT rs.route_id)::INT AS routes_count,
               ROUND(ST_Distance(s.location, t.geog))::INT AS distance_meters
             FROM stops s
             CROSS JOIN target t
             LEFT JOIN route_stops rs ON rs.stop_id = s.stop_id
             WHERE ST_DWithin(s.location, t.geog, $3)
             GROUP BY s.stop_id, s.stop_code, s.stop_name, s.stop_name_he, s.location, t.geog
             ORDER BY ST_Distance(s.location, t.geog) ASC
             LIMIT 5`,
            [lat, lon, radius]
          );
          if (res.rows.length > 0) {
            return res.rows.map((r) => this.mapResolvedStopRow(r as Record<string, unknown>));
          }
        } catch (err) {
          console.warn('[PostgreSQL] findNearestStopsToPoint error:', (err as Error).message);
        }
      }
    }

    // Fallback via nearby lines PostGIS / PostgREST
    const nearbyLines = await this.getNearbyLinesAndTermini(lat, lon, Math.max(900, radiusMeters), 5);
    if (nearbyLines.length > 0) {
      const seen = new Set<string>();
      const opts: ResolvedStopOption[] = [];
      for (const l of nearbyLines) {
        if (seen.has(l.nearest_stop_id)) continue;
        seen.add(l.nearest_stop_id);
        opts.push({
          stop_id: l.nearest_stop_id,
          stop_code: l.nearest_stop_code,
          stop_name: l.nearest_stop_name,
          stop_name_he: l.nearest_stop_name_he,
          lat: l.stop_lat,
          lon: l.stop_lon,
          distance_meters: l.distance_meters
        });
      }
      return opts;
    }

    return [];
  }

  /**
   * Finds nearest confirmed major transit hub (central station or high-connectivity stop)
   * to suggest when no verified bus route reaches a destination.
   */
  async findNearestConfirmedHub(lat: number, lon: number): Promise<UserStopInfo | null> {
    this.ensureInit();

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `WITH target AS (
             SELECT ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography AS geog
           )
           SELECT
             s.stop_id,
             s.stop_code,
             s.stop_name,
             COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
             ST_Y(s.location::geometry)::FLOAT AS stop_lat,
             ST_X(s.location::geometry)::FLOAT AS stop_lon,
             ROUND(ST_Distance(s.location, t.geog))::INT AS distance_meters,
             COUNT(DISTINCT rs.route_id)::INT AS routes_cnt
           FROM stops s
           CROSS JOIN target t
           JOIN route_stops rs ON rs.stop_id = s.stop_id
           WHERE COALESCE(s.stop_name_he, '') ~* '(תחנה\s*מרכזית|ת\.\s*מרכזית|רכבת\s*מרכז|מסוף|מרכז|חוף\s*הכרמל|סבידור)'
              OR s.stop_name ~* '(Central Bus Station|Central Train|Hof HaCarmel|Savidor|Center)'
           GROUP BY s.stop_id, s.stop_code, s.stop_name, s.stop_name_he, s.location, t.geog
           ORDER BY ST_Distance(s.location, t.geog) ASC
           LIMIT 1`,
          [lat, lon]
        );
        const r = res.rows[0];
        if (r) {
          return {
            stop_id: String(r.stop_id),
            stop_code: String(r.stop_code),
            stop_name: String(r.stop_name),
            stop_name_he: String(r.stop_name_he),
            stop_sequence: 1,
            lat: Number(r.stop_lat),
            lon: Number(r.stop_lon),
            distance_meters: Number(r.distance_meters)
          };
        }
      } catch (err) {
        console.warn('[PostgreSQL] findNearestConfirmedHub error:', (err as Error).message);
      }
    }

    const nearest = await this.findNearestStopsToPoint(lat, lon, 5000);
    if (nearest[0]) {
      return {
        stop_id: nearest[0].stop_id,
        stop_code: nearest[0].stop_code,
        stop_name: nearest[0].stop_name,
        stop_name_he: nearest[0].stop_name_he,
        stop_sequence: 1,
        lat: nearest[0].lat,
        lon: nearest[0].lon,
        distance_meters: nearest[0].distance_meters
      };
    }

    return null;
  }

  /**
   * Looks up whether a requested bus line exists in the database and returns its nearest stop
   * without silently substituting an unrelated fallback route.
   */
  async lookupNearestStopForExistingLine(
    lineNum: string,
    userLat: number,
    userLon: number
  ): Promise<NearestStopRpcRow | null> {
    this.ensureInit();
    const cleaned = lineNum.trim();
    if (!cleaned) return null;

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT * FROM find_nearest_stop_for_line($1, $2, $3, NULL)`,
          [cleaned, userLat, userLon]
        );
        if (res.rows[0]) {
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
            route_short_name: String(row.route_short_name ?? cleaned),
            route_long_name: String(row.route_long_name ?? `Line ${cleaned}`),
            distance_meters: Math.round(Number(row.distance_meters ?? 0))
          };
        }
        return null;
      } catch (err) {
        console.warn('[PostgreSQL] lookupNearestStopForExistingLine error:', (err as Error).message);
      }
    }

    if (this.client) {
      try {
        const { data: exists } = await this.client
          .from('routes')
          .select('route_id')
          .ilike('route_short_name', cleaned)
          .limit(1);
        if (!exists || exists.length === 0) return null;

        const { data, error } = await this.client.rpc('find_nearest_stop_for_line', {
          line_num: cleaned,
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
            route_short_name: String(row.route_short_name ?? cleaned),
            route_long_name: String(row.route_long_name ?? `Line ${cleaned}`),
            distance_meters: Math.round(Number(row.distance_meters ?? 0))
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Matches stops by stop code or free-form stop/landmark name in GTFS stops table.
   */
  async findStopsByNameQuery(
    query: string,
    nearLat?: number,
    nearLon?: number
  ): Promise<ResolvedStopOption[]> {
    this.ensureInit();
    const cleaned = query.trim();
    if (!cleaned) return [];

    if (/^\d{4,6}$/.test(cleaned) && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT
             s.stop_id, s.stop_code, s.stop_name, COALESCE(s.stop_name_he, s.stop_name) AS stop_name_he,
             ST_Y(s.location::geometry)::FLOAT AS stop_lat, ST_X(s.location::geometry)::FLOAT AS stop_lon,
             CASE WHEN $2::FLOAT IS NOT NULL AND $3::FLOAT IS NOT NULL
               THEN ROUND(ST_Distance(s.location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography))::INT
               ELSE NULL::INT END AS distance_meters
           FROM stops s WHERE s.stop_code = $1 LIMIT 3`,
          [cleaned, nearLat ?? null, nearLon ?? null]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r) => this.mapResolvedStopRow(r as Record<string, unknown>));
        }
      } catch {
        // Fallback below
      }
    }

    return this.findPopularStopOnStreet(cleaned, undefined, nearLat, nearLon);
  }

  async upsertUserRouteHistoryRow(input: UpsertUserHistoryInput): Promise<void> {
    this.ensureInit();

    if (this.pgPool) {
      try {
        const existing = await this.pgPool.query<{ id: string }>(
          `SELECT id FROM user_route_history
           WHERE user_id = $1
             AND ST_DWithin(origin_location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 250)
             AND (
               ($4::TEXT IS NOT NULL AND LOWER(COALESCE(dest_label, '')) = LOWER($4))
               OR ($4::TEXT IS NULL AND route_id = $5 AND COALESCE(direction_id, -1) = COALESCE($6, -1))
             )
           ORDER BY last_used_at DESC
           LIMIT 1`,
          [
            input.userId,
            input.originLat,
            input.originLon,
            input.destLabel ?? null,
            input.routeId ?? null,
            input.directionId ?? null
          ]
        );

        if (existing.rows[0]) {
          await this.pgPool.query(
            `UPDATE user_route_history
             SET use_count = use_count + 1,
                 last_used_at = NOW(),
                 origin_lat = $2,
                 origin_lon = $3,
                 origin_location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
                 origin_stop_id = COALESCE($4, origin_stop_id),
                 origin_stop_name = COALESCE($5, origin_stop_name),
                 route_id = COALESCE($6, route_id),
                 line_number = COALESCE($7, line_number),
                 direction_id = COALESCE($8, direction_id)
             WHERE id = $1`,
            [
              existing.rows[0].id,
              input.originLat,
              input.originLon,
              input.originStopId ?? null,
              input.originStopName ?? null,
              input.routeId ?? null,
              input.lineNumber ?? null,
              input.directionId ?? null
            ]
          );
        } else {
          await this.pgPool.query(
            `INSERT INTO user_route_history (
               user_id, origin_lat, origin_lon, origin_location,
               origin_stop_id, origin_stop_name, dest_label, dest_lat, dest_lon,
               route_id, line_number, direction_id, use_count, last_used_at
             ) VALUES (
               $1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
               $4, $5, $6, $7, $8,
               $9, $10, $11, 1, NOW()
             )`,
            [
              input.userId,
              input.originLat,
              input.originLon,
              input.originStopId ?? null,
              input.originStopName ?? null,
              input.destLabel ?? null,
              input.destLat ?? null,
              input.destLon ?? null,
              input.routeId ?? null,
              input.lineNumber ?? null,
              input.directionId ?? null
            ]
          );
        }
      } catch (err) {
        console.warn('[PostgreSQL] upsertUserRouteHistoryRow warning:', (err as Error).message);
      }
    }

    if (this.client) {
      try {
        const { data: existingRows, error } = await this.client
          .from('user_route_history')
          .select('id, origin_lat, origin_lon, dest_label, route_id, direction_id, use_count')
          .eq('user_id', input.userId)
          .limit(30);

        if (!error && Array.isArray(existingRows)) {
          const matched = existingRows.find((r) => {
            const dist = haversineDistanceMeters(
              input.originLat,
              input.originLon,
              Number(r.origin_lat),
              Number(r.origin_lon)
            );
            if (dist > 250) return false;
            if (input.destLabel) {
              return String(r.dest_label ?? '').toLowerCase() === input.destLabel.toLowerCase();
            }
            return (
              String(r.route_id ?? '') === String(input.routeId ?? '') &&
              Number(r.direction_id ?? -1) === Number(input.directionId ?? -1)
            );
          });

          if (matched) {
            await this.client
              .from('user_route_history')
              .update({
                use_count: Number(matched.use_count ?? 1) + 1,
                last_used_at: new Date().toISOString(),
                origin_stop_id: input.originStopId ?? null,
                origin_stop_name: input.originStopName ?? null,
                route_id: input.routeId ?? null,
                line_number: input.lineNumber ?? null,
                direction_id: input.directionId ?? null
              })
              .eq('id', matched.id);
          } else {
            await this.client.from('user_route_history').insert({
              user_id: input.userId,
              origin_lat: input.originLat,
              origin_lon: input.originLon,
              origin_location: `POINT(${input.originLon} ${input.originLat})`,
              origin_stop_id: input.originStopId ?? null,
              origin_stop_name: input.originStopName ?? null,
              dest_label: input.destLabel ?? null,
              dest_lat: input.destLat ?? null,
              dest_lon: input.destLon ?? null,
              route_id: input.routeId ?? null,
              line_number: input.lineNumber ?? null,
              direction_id: input.directionId ?? null,
              use_count: 1,
              last_used_at: new Date().toISOString()
            });
          }
        }
      } catch (err) {
        console.warn('[Supabase] upsertUserRouteHistoryRow warning:', (err as Error).message);
      }
    }
  }

  private mapUserHistoryRow(r: Record<string, unknown>): UserRouteHistoryRow {
    return {
      id: r.id !== undefined ? String(r.id) : undefined,
      user_id: String(r.user_id),
      origin_lat: Number(r.origin_lat),
      origin_lon: Number(r.origin_lon),
      origin_stop_id: r.origin_stop_id ? String(r.origin_stop_id) : null,
      origin_stop_name: r.origin_stop_name ? String(r.origin_stop_name) : null,
      dest_label: r.dest_label ? String(r.dest_label) : null,
      dest_lat: r.dest_lat !== null && r.dest_lat !== undefined ? Number(r.dest_lat) : null,
      dest_lon: r.dest_lon !== null && r.dest_lon !== undefined ? Number(r.dest_lon) : null,
      route_id: r.route_id ? String(r.route_id) : null,
      line_number: r.line_number ? String(r.line_number) : null,
      direction_id:
        r.direction_id !== null && r.direction_id !== undefined
          ? (Number(r.direction_id) === 1 ? 1 : 0)
          : null,
      use_count: Number(r.use_count ?? 1),
      last_used_at: String(r.last_used_at ?? new Date().toISOString()),
      distance_meters: Math.round(Number(r.distance_meters ?? 0))
    };
  }

  async findUserRouteHistoryNearLocation(
    userId: string,
    lat: number,
    lon: number,
    radiusMeters = 250,
    limit = 6
  ): Promise<UserRouteHistoryRow[]> {
    this.ensureInit();
    if (!userId.trim()) return [];

    if (this.client) {
      try {
        const { data, error } = await this.client.rpc('find_user_route_history_near_location', {
          p_user_id: userId,
          p_lat: lat,
          p_lon: lon,
          p_radius_meters: radiusMeters,
          p_limit: limit
        });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((r) => this.mapUserHistoryRow(r as Record<string, unknown>));
        }
      } catch {
        // Fallback below
      }
    }

    if (this.pgPool) {
      try {
        const res = await this.pgPool.query(
          `SELECT * FROM find_user_route_history_near_location($1, $2, $3, $4, $5)`,
          [userId, lat, lon, radiusMeters, limit]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r) => this.mapUserHistoryRow(r as Record<string, unknown>));
        }
      } catch {
        // Fallback cleanly to Redis history mirror in user-context service
      }
    }

    return [];
  }
}

export const supabaseService = new SupabaseService();

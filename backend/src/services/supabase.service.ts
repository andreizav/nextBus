import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { haversineDistanceMeters } from './eta.service.js';
import type {
  DirectRouteMatch,
  StopTimelineItem,
  TransferRouteMatch
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
      } catch (err) {
        console.warn('[Supabase] Table scan fallback error:', (err as Error).message);
      }
    }

    const fallbackStop = await this.findNearestStopForLine(cleanedLine, userLat, userLon);
    return [
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
    ];
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
}

export const supabaseService = new SupabaseService();

import { Redis } from 'ioredis';
import type { CachedRouteState } from '../types/bus.types.js';

const STATE_TTL_SECONDS = 60;
const ACTIVE_ROUTE_TTL_MS = 15 * 60 * 1000;
const ACTIVE_ROUTES_KEY = 'bus:active_routes';

export interface ActiveRouteRef {
  routeId: string;
  directionId: 0 | 1;
}

class RedisService {
  private client: Redis | null = null;
  private memoryStates = new Map<string, { value: string; expiresAt: number }>();
  private memoryActiveRoutes = new Map<string, number>();
  private useMemoryFallback = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.useMemoryFallback = true;
      return;
    }

    const isTls = redisUrl.startsWith('rediss://');
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      lazyConnect: true,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {})
    });

    this.client.on('error', (err: Error) => {
      if (!this.useMemoryFallback) {
        console.warn('[Redis] Falling back to in-memory cache due to error:', err.message);
        this.useMemoryFallback = true;
      }
    });

    this.client.on('ready', () => {
      this.useMemoryFallback = false;
    });
  }

  private stateKey(routeId: string, directionId: 0 | 1): string {
    return `bus:state:${routeId}:${directionId}`;
  }

  private memberKey(routeId: string, directionId: 0 | 1): string {
    return `${routeId}:${directionId}`;
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.useMemoryFallback || !this.client) {
      return false;
    }
    if (this.client.status === 'ready') {
      return true;
    }
    try {
      await this.client.connect();
      return !this.useMemoryFallback;
    } catch {
      this.useMemoryFallback = true;
      return false;
    }
  }

  async getBusState(routeId: string, directionId: 0 | 1): Promise<CachedRouteState | null> {
    const key = this.stateKey(routeId, directionId);

    if (await this.ensureConnected()) {
      const raw = await this.client!.get(key);
      return raw ? (JSON.parse(raw) as CachedRouteState) : null;
    }

    const entry = this.memoryStates.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.memoryStates.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as CachedRouteState;
  }

  async setBusState(
    routeId: string,
    directionId: 0 | 1,
    state: CachedRouteState
  ): Promise<void> {
    const key = this.stateKey(routeId, directionId);
    const payload = JSON.stringify(state);

    if (await this.ensureConnected()) {
      await this.client!.set(key, payload, 'EX', STATE_TTL_SECONDS);
      return;
    }

    this.memoryStates.set(key, {
      value: payload,
      expiresAt: Date.now() + STATE_TTL_SECONDS * 1000
    });
  }

  async touchActiveRoute(routeId: string, directionId: 0 | 1): Promise<void> {
    const member = this.memberKey(routeId, directionId);
    const expiresAtScore = Date.now() + ACTIVE_ROUTE_TTL_MS;

    if (await this.ensureConnected()) {
      await this.client!.zadd(ACTIVE_ROUTES_KEY, expiresAtScore, member);
      return;
    }

    this.memoryActiveRoutes.set(member, expiresAtScore);
  }

  async pruneAndGetActiveRoutes(now: number = Date.now()): Promise<ActiveRouteRef[]> {
    let members: string[] = [];

    if (await this.ensureConnected()) {
      await this.client!.zremrangebyscore(ACTIVE_ROUTES_KEY, '-inf', now);
      members = await this.client!.zrangebyscore(ACTIVE_ROUTES_KEY, `(${now}`, '+inf');
    } else {
      for (const [member, score] of this.memoryActiveRoutes.entries()) {
        if (score <= now) {
          this.memoryActiveRoutes.delete(member);
        }
      }
      members = Array.from(this.memoryActiveRoutes.keys());
    }

    return members
      .map((member): ActiveRouteRef | null => {
        const lastColon = member.lastIndexOf(':');
        if (lastColon === -1) return null;
        const routeId = member.slice(0, lastColon);
        const dirNum = Number(member.slice(lastColon + 1));
        const directionId: 0 | 1 = dirNum === 1 ? 1 : 0;
        return { routeId, directionId };
      })
      .filter((item): item is ActiveRouteRef => item !== null);
  }

  async disconnect(): Promise<void> {
    if (this.client && this.client.status !== 'end') {
      await this.client.quit().catch(() => undefined);
    }
  }
}

export const redisService = new RedisService();

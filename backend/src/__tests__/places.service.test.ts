import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRealNearbyCafes, MAX_CAFE_DISTANCE_METERS } from '../services/places.service.js';
import { redisService } from '../services/redis.service.js';
import type { NearbyOffer } from '../types/bus.types.js';

describe('places.service — nearby cafes <= 400m filter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters cached cafes to at most 400m and sorts closest first', async () => {
    const cachedCafes: NearbyOffer[] = [
      {
        id: 'cafe-far',
        name: 'Far Cafe',
        name_he: 'קפה רחוק',
        category: 'Cafe',
        walk_minutes: 7,
        distance_meters: 520,
        promo: 'Far St',
        lat: 32.794,
        lon: 34.968
      },
      {
        id: 'cafe-edge',
        name: 'Edge Cafe',
        name_he: 'קפה גבול',
        category: 'Cafe',
        walk_minutes: 5,
        distance_meters: 400,
        promo: 'Edge St',
        lat: 32.792,
        lon: 34.966
      },
      {
        id: 'cafe-near',
        name: 'Near Cafe',
        name_he: 'קפה קרוב',
        category: 'Cafe',
        walk_minutes: 2,
        distance_meters: 140,
        promo: 'Near St',
        lat: 32.79,
        lon: 34.964
      }
    ];

    vi.spyOn(redisService, 'getJson').mockResolvedValue(cachedCafes);

    const results = await fetchRealNearbyCafes(32.7895, 34.964);
    expect(MAX_CAFE_DISTANCE_METERS).toBe(400);
    expect(results.map((c) => c.id)).toEqual(['cafe-near', 'cafe-edge']);
    expect(results.every((c) => c.distance_meters <= 400)).toBe(true);
  });

  it('filters fallback cafes strictly to <= 400m and returns empty array if none are close', async () => {
    vi.spyOn(redisService, 'getJson').mockResolvedValue(null);
    vi.spyOn(redisService, 'setJson').mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network offline'));

    // Near Greg Cafe (32.7897417, 34.9638889) & Mandarin (32.7895252, 34.9653507) in Haifa: both < 200m
    const haifaCafes = await fetchRealNearbyCafes(32.7895, 34.964);
    expect(haifaCafes.length).toBeGreaterThan(0);
    expect(haifaCafes.every((c) => c.distance_meters <= 400)).toBe(true);

    // Far from all fallback cafes (e.g. Jerusalem center): should return []
    const farCafes = await fetchRealNearbyCafes(31.789, 35.203);
    expect(farCafes).toEqual([]);
  });
});

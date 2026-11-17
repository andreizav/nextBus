import { redisService } from './redis.service.js';
import type { RouteStopCoord } from './supabase.service.js';
import type { BoundingBox } from '../types/bus.types.js';

const SVG_WIDTH = 600;
const SVG_HEIGHT = 320;
const TILE_CACHE_TTL_SECONDS = 86_400; // 24 hours

function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom
  );
}

function tileXToLon(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function chooseTileZoom(bbox: BoundingBox): {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  for (let zoom = 16; zoom >= 12; zoom--) {
    const minX = lonToTileX(bbox.minLon, zoom);
    const maxX = lonToTileX(bbox.maxLon, zoom);
    const minY = latToTileY(bbox.maxLat, zoom);
    const maxY = latToTileY(bbox.minLat, zoom);
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count <= 12) {
      return { zoom, minX, maxX, minY, maxY };
    }
  }
  const zoom = 12;
  return {
    zoom,
    minX: lonToTileX(bbox.minLon, zoom),
    maxX: lonToTileX(bbox.maxLon, zoom),
    minY: latToTileY(bbox.maxLat, zoom),
    maxY: latToTileY(bbox.minLat, zoom)
  };
}

async function fetchTileDataUri(zoom: number, x: number, y: number): Promise<string | null> {
  const cacheKey = `bus:tile:${zoom}:${x}:${y}`;
  const cached = await redisService.getJson<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const urls = [
    `https://basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`,
    `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
  ];

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'nextBus-TransitWidget/1.0' },
        signal: controller.signal
      });
      if (!response.ok) continue;
      const arrayBuf = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      const dataUri = `data:image/png;base64,${base64}`;
      await redisService.setJson(cacheKey, dataUri, TILE_CACHE_TTL_SECONDS);
      return dataUri;
    } catch {
      // Try next tile mirror
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

export function buildStaticMapUrl(
  bbox: BoundingBox,
  routeId: string,
  directionId: 0 | 1
): string {
  const params = new URLSearchParams({
    minLat: bbox.minLat.toFixed(5),
    maxLat: bbox.maxLat.toFixed(5),
    minLon: bbox.minLon.toFixed(5),
    maxLon: bbox.maxLon.toFixed(5),
    route_id: routeId,
    direction_id: String(directionId)
  });
  return `/api/static-map?${params.toString()}`;
}

export async function generateStaticStreetMapSvg(
  bbox: BoundingBox,
  stops: RouteStopCoord[]
): Promise<string> {
  const lonSpan = Math.max(0.0005, bbox.maxLon - bbox.minLon);
  const latSpan = Math.max(0.0005, bbox.maxLat - bbox.minLat);

  const toSvgX = (lon: number): number =>
    Number((((lon - bbox.minLon) / lonSpan) * SVG_WIDTH).toFixed(2));
  const toSvgY = (lat: number): number =>
    Number((((bbox.maxLat - lat) / latSpan) * SVG_HEIGHT).toFixed(2));

  const { zoom, minX, maxX, minY, maxY } = chooseTileZoom(bbox);

  const tileCoords: Array<{ x: number; y: number }> = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tileCoords.push({ x, y });
    }
  }

  const tileImages = await Promise.all(
    tileCoords.map(async ({ x, y }) => {
      const dataUri = await fetchTileDataUri(zoom, x, y);
      if (!dataUri) return '';

      const westLon = tileXToLon(x, zoom);
      const eastLon = tileXToLon(x + 1, zoom);
      const northLat = tileYToLat(y, zoom);
      const southLat = tileYToLat(y + 1, zoom);

      const x1 = toSvgX(westLon);
      const x2 = toSvgX(eastLon);
      const y1 = toSvgY(northLat);
      const y2 = toSvgY(southLat);

      const w = Math.max(1, Number((x2 - x1).toFixed(2)));
      const h = Math.max(1, Number((y2 - y1).toFixed(2)));

      return `<image href="${dataUri}" x="${x1}" y="${y1}" width="${w + 0.6}" height="${h + 0.6}" preserveAspectRatio="none" />`;
    })
  );

  const polylinePoints = stops.map((s) => `${toSvgX(s.lon)},${toSvgY(s.lat)}`).join(' ');
  const stopCircles = stops
    .map((s) => {
      const cx = toSvgX(s.lon);
      const cy = toSvgY(s.lat);
      if (cx < -10 || cx > SVG_WIDTH + 10 || cy < -10 || cy > SVG_HEIGHT + 10) return '';
      return `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#0f172a" stroke="#ffffff" stroke-width="1.5" />`;
    })
    .filter(Boolean)
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#e2e8f0" />
  <g>
    ${tileImages.filter(Boolean).join('\n    ')}
  </g>
  ${
    polylinePoints
      ? `<polyline points="${polylinePoints}" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.92" />
  <polyline points="${polylinePoints}" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />`
      : ''
  }
  <g>
    ${stopCircles}
  </g>
  <rect x="8" y="${SVG_HEIGHT - 22}" width="154" height="16" rx="4" fill="rgba(15, 23, 42, 0.72)" />
  <text x="14" y="${SVG_HEIGHT - 10}" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="9.5" font-weight="600">© OpenStreetMap • CARTO</text>
</svg>`;
}

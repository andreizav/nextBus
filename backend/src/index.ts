import './config/env.js';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { handleMcpPostRequest } from './mcp/server.js';
import { getLiveBusStatus } from './services/bus-status.service.js';
import { resolveDestinationText } from './services/geocoding.service.js';
import { redisService } from './services/redis.service.js';
import { generateStaticStreetMapSvg } from './services/static-map.service.js';
import { supabaseService } from './services/supabase.service.js';
import { planBestBusesToDestination } from './services/trip-planner.service.js';
import type { EntryContext } from './types/bus.types.js';
import { pollingWorker } from './workers/polling.worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function resolveRepoPath(...segments: string[]): string {
  const fromDist = path.resolve(__dirname, '../..', ...segments);
  if (fs.existsSync(fromDist)) {
    return fromDist;
  }
  return path.resolve(process.cwd(), ...segments);
}

// 1. Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'nextBus', timestamp: new Date().toISOString() });
});

// 2. Google Connected Apps domain verification endpoint
app.get('/.well-known/google-connected-apps', (_req: Request, res: Response) => {
  const verificationToken = process.env.GOOGLE_VERIFICATION_TOKEN ?? '';
  res.json({
    service: 'nextBus',
    protocol: 'mcp',
    mcp_endpoint: '/mcp',
    verification_token: verificationToken,
    privacy_policy_url: '/privacy',
    terms_of_service_url: '/terms',
    supported_tools: ['get_live_bus_status', 'find_best_buses_to_destination']
  });
});

// 3. MCP Streamable HTTP endpoint (POST /mcp)
app.post('/mcp', async (req: Request, res: Response) => {
  try {
    await handleMcpPostRequest(req, res);
  } catch (error) {
    console.error('[MCP] Request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error' },
        id: null
      });
    }
  }
});

const searchRoutesBodySchema = z.object({
  query: z.string().trim().min(1),
  user_location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180)
  })
});

// 4. Standalone A -> B Smart Search endpoint
app.post('/api/search-routes', async (req: Request, res: Response) => {
  try {
    const parsed = searchRoutesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid search payload', details: parsed.error.flatten() });
      return;
    }

    const { query, user_location } = parsed.data;
    const destination = await resolveDestinationText(query, user_location);
    const result = await planBestBusesToDestination({
      userLocation: user_location,
      destination,
      entryContext: 'standalone',
      allowColdBootstrap: true
    });

    res.json(result);
  } catch (error) {
    console.error('[REST] /api/search-routes error:', error);
    res.status(500).json({ error: 'Failed to search A-to-B routes' });
  }
});

// 4a. REST polling endpoint for Angular widget (15s interval)
// Strictly reads from Redis cache; NEVER calls Open Bus Stride API directly.
app.get('/api/live-status', async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat ?? 32.7895);
    const lon = Number(req.query.lon ?? 34.9640);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'Invalid lat or lon query parameter' });
      return;
    }

    const entryContext: EntryContext =
      req.query.entry_context === 'mcp' ? 'mcp' : 'standalone';

    const destLatRaw = req.query.dest_lat;
    const destLonRaw = req.query.dest_lon;
    if (destLatRaw !== undefined && destLonRaw !== undefined) {
      const destLat = Number(destLatRaw);
      const destLon = Number(destLonRaw);
      if (Number.isNaN(destLat) || Number.isNaN(destLon)) {
        res.status(400).json({ error: 'Invalid dest_lat or dest_lon query parameter' });
        return;
      }

      const routeIdsParam = String(req.query.route_ids ?? '').trim();
      const routeIdsFilter = routeIdsParam
        ? routeIdsParam.split(',').map((id) => id.trim()).filter(Boolean)
        : undefined;
      const destLabel = String(req.query.dest_label ?? 'Destination');
      const allowColdBootstrap = req.query.bootstrap === 'true';

      const tripStatus = await planBestBusesToDestination({
        userLocation: { lat, lon },
        destination: {
          lat: destLat,
          lon: destLon,
          place_name: destLabel,
          formatted_address: destLabel,
          source: entryContext === 'mcp' ? 'mcp' : 'cache'
        },
        entryContext,
        routeIdsFilter,
        allowColdBootstrap
      });

      if (!tripStatus.cache_hit) {
        void pollingWorker.runCycle();
      }

      res.json(tripStatus);
      return;
    }

    const lineNumber = String(req.query.line_number ?? '49');
    const dirQuery = req.query.direction_id;
    const preferredDirection: 0 | 1 | undefined =
      dirQuery === '0' ? 0 : dirQuery === '1' ? 1 : undefined;
    const includeNearbyPlaces = req.query.include_nearby_places === 'true';

    const status = await getLiveBusStatus({
      lineNumber,
      userLat: lat,
      userLon: lon,
      preferredDirection,
      includeNearbyPlaces,
      allowColdBootstrap: false
    });

    if (!status.cache_hit) {
      // Trigger background worker asynchronously without blocking client response
      void pollingWorker.runCycle();
    }

    res.json({ ...status, entry_context: entryContext });
  } catch (error) {
    console.error('[REST] /api/live-status error:', error);
    res.status(500).json({ error: 'Failed to retrieve live bus status' });
  }
});

// 4b. Static street map SVG endpoint for Lite Mode (real street tiles + route path)
app.get('/api/static-map', async (req: Request, res: Response) => {
  try {
    const minLat = Number(req.query.minLat ?? 32.76);
    const maxLat = Number(req.query.maxLat ?? 32.796);
    const minLon = Number(req.query.minLon ?? 34.95);
    const maxLon = Number(req.query.maxLon ?? 34.99);
    const routeId = String(req.query.route_id ?? 'stride-10049');
    const directionId: 0 | 1 = req.query.direction_id === '1' ? 1 : 0;

    if (
      [minLat, maxLat, minLon, maxLon].some((n) => Number.isNaN(n)) ||
      maxLat <= minLat ||
      maxLon <= minLon
    ) {
      res.status(400).send('Invalid bounding box parameters');
      return;
    }

    const stops = await supabaseService.getDirectionStopCoords(routeId, directionId);
    const svg = await generateStaticStreetMapSvg(
      { minLat, maxLat, minLon, maxLon },
      stops
    );

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(svg);
  } catch (error) {
    console.error('[REST] /api/static-map error:', error);
    res.status(500).send('Failed to generate static map');
  }
});

// 5. Legal pages required for Google Connected Console moderation
app.get('/privacy', (_req: Request, res: Response) => {
  const filePath = resolveRepoPath('docs', 'privacy.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  res.status(404).send('Privacy policy not found');
});

app.get('/terms', (_req: Request, res: Response) => {
  const filePath = resolveRepoPath('docs', 'terms.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
    return;
  }
  res.status(404).send('Terms of service not found');
});

// 6. Serve compiled Angular 20 widget static bundle
const frontendDistDir = [
  resolveRepoPath('frontend', 'dist', 'frontend', 'browser'),
  resolveRepoPath('public')
].find((candidate) => fs.existsSync(candidate));

if (frontendDistDir) {
  app.use(express.static(frontendDistDir));
  app.get('/{*splat}', (_req: Request, res: Response) => {
    const indexPath = path.join(frontendDistDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    res.status(404).json({ error: 'Frontend bundle not found' });
  });
}

const server = app.listen(port, () => {
  console.log(`[nextBus] Server listening on http://localhost:${port}`);
  pollingWorker.start();
});

async function shutdown(): Promise<void> {
  pollingWorker.stop();
  await redisService.disconnect();
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

export { app };

import './config/env.js';
import cors from 'cors';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleMcpPostRequest } from './mcp/server.js';
import { getLiveBusStatus } from './services/bus-status.service.js';
import { redisService } from './services/redis.service.js';
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
    supported_tools: ['get_live_bus_status']
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

// 4. REST polling endpoint for Angular widget (15s interval)
// Strictly reads from Redis cache; NEVER calls Open Bus Stride API directly.
app.get('/api/live-status', async (req: Request, res: Response) => {
  try {
    const lineNumber = String(req.query.line_number ?? '49');
    const lat = Number(req.query.lat ?? 32.7804);
    const lon = Number(req.query.lon ?? 34.9658);
    const dirQuery = req.query.direction_id;
    const preferredDirection: 0 | 1 | undefined =
      dirQuery === '0' ? 0 : dirQuery === '1' ? 1 : undefined;
    const includeNearbyPlaces = req.query.include_nearby_places === 'true';

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'Invalid lat or lon query parameter' });
      return;
    }

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

    res.json(status);
  } catch (error) {
    console.error('[REST] /api/live-status error:', error);
    res.status(500).json({ error: 'Failed to retrieve live bus status' });
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

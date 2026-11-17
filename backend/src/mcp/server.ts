import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getLiveBusStatus } from '../services/bus-status.service.js';

const getLiveBusStatusInputSchema = {
  line_number: z.string().min(1).describe('Public transit bus line number, e.g. "49"'),
  user_location: z
    .object({
      lat: z.number().min(-90).max(90).describe('User latitude in WGS84'),
      lon: z.number().min(-180).max(180).describe('User longitude in WGS84')
    })
    .describe('Current user GPS coordinates'),
  destination_hint: z
    .string()
    .optional()
    .describe('Optional destination name or area hint to disambiguate route direction'),
  include_nearby_places: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include nearby cafes/offers and force interactive mode')
};

export function createNextBusMcpServer(): McpServer {
  const server = new McpServer({
    name: 'nextBus-mcp',
    version: '1.0.0'
  });

  server.registerTool(
    'get_live_bus_status',
    {
      title: 'Get Live Israeli Bus Status',
      description:
        'Returns real-time bus ETA, stops away, nearest stop from PostGIS, and hybrid rendering mode (lite or interactive) for Israeli public transit.',
      inputSchema: getLiveBusStatusInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false
      }
    },
    async ({ line_number, user_location, destination_hint, include_nearby_places }) => {
      const result = await getLiveBusStatus({
        lineNumber: line_number,
        userLat: user_location.lat,
        userLon: user_location.lon,
        destinationHint: destination_hint,
        includeNearbyPlaces: include_nearby_places ?? false,
        allowColdBootstrap: true
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ],
        structuredContent: result as unknown as Record<string, unknown>
      };
    }
  );

  return server;
}

export async function handleMcpPostRequest(req: Request, res: Response): Promise<void> {
  const server = createNextBusMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

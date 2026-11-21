import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getLiveBusStatus } from '../services/bus-status.service.js';
import { classifyDestinationGranularity } from '../services/geocoding.service.js';
import { dispatchSearchIntent } from '../services/intent-router.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { planBestBusesToDestination } from '../services/trip-planner.service.js';
import type { GeocodedDestination } from '../types/bus.types.js';
import {
  getReturningRoutesForLocation,
  recordSearchResultForUser
} from '../services/user-context.service.js';

const getLiveBusStatusInputSchema = {
  line_number: z.string().min(1).describe('Public transit bus line number, e.g. "49"'),
  user_location: z
    .object({
      lat: z.number().min(-90).max(90).describe('User latitude in WGS84'),
      lon: z.number().min(-180).max(180).describe('User longitude in WGS84')
    })
    .describe('Current user GPS coordinates'),
  user_id: z
    .string()
    .trim()
    .max(128)
    .optional()
    .describe('Optional user identifier to personalize returning route suggestions near location'),
  destination_hint: z
    .string()
    .optional()
    .describe('Optional destination name or area hint to disambiguate route direction'),
  include_nearby_places: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to include nearby cafes/offers and force interactive mode'),
  ignore_user_location: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set true after user confirms location_mismatch prompt to search from explicit_origin instead of GPS'),
  explicit_origin: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      label: z.string().optional(),
      stop_id: z.string().optional()
    })
    .optional()
    .describe('Explicitly stated origin location / stop when different from current user GPS')
};

const findBestBusesInputSchema = {
  user_location: z
    .object({
      lat: z.number().min(-90).max(90).describe('Current user latitude in WGS84'),
      lon: z.number().min(-180).max(180).describe('Current user longitude in WGS84')
    })
    .describe('Origin user GPS coordinates'),
  destination_location: z
    .object({
      lat: z.number().min(-90).max(90).describe('Destination latitude resolved by LLM'),
      lon: z.number().min(-180).max(180).describe('Destination longitude resolved by LLM'),
      label: z.string().min(1).describe('Human-readable destination name, e.g. "Поликлиника на Хорев, Хайфа"')
    })
    .describe('Destination coordinates and label resolved by Gemini / Google Search'),
  user_id: z
    .string()
    .trim()
    .max(128)
    .optional()
    .describe('Optional user identifier to save and prioritize returning routes near location'),
  ignore_user_location: z
    .boolean()
    .optional()
    .default(false)
    .describe('Set true after user confirms location_mismatch prompt to plan from explicit_origin instead of current GPS'),
  explicit_origin: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      label: z.string().optional(),
      stop_id: z.string().optional()
    })
    .optional()
    .describe('Explicit starting point / stop when user specified an origin other than current GPS')
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
    async ({ line_number, user_location, user_id, destination_hint, include_nearby_places, ignore_user_location, explicit_origin }) => {
      const baseResult = destination_hint && !explicit_origin
        ? {
            ...(await getLiveBusStatus({
              lineNumber: line_number,
              userLat: user_location.lat,
              userLon: user_location.lon,
              destinationHint: destination_hint,
              includeNearbyPlaces: include_nearby_places ?? false,
              allowColdBootstrap: true
            })),
            entry_context: 'mcp' as const
          }
        : await dispatchSearchIntent({
            query: `bus ${line_number}`,
            userLocation: user_location,
            entryContext: 'mcp',
            includeNearbyPlaces: include_nearby_places ?? false,
            allowColdBootstrap: true,
            ignoreUserLocation: ignore_user_location ?? false,
            explicitOrigin: explicit_origin
          });

      let result = baseResult;
      if (user_id) {
        const returningRoutes = await getReturningRoutesForLocation(
          user_id,
          user_location.lat,
          user_location.lon,
          250
        ).catch(() => []);
        if (!baseResult.requires_confirmation && !baseResult.no_verified_route) {
          await recordSearchResultForUser(user_id, user_location, baseResult).catch(() => undefined);
        }
        result = {
          ...baseResult,
          user_id,
          ...(returningRoutes.length > 0 ? { returning_routes: returningRoutes } : {})
        };
      }

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

  server.registerTool(
    'find_best_buses_to_destination',
    {
      title: 'Find Top-3 Fastest Direct Buses to Destination',
      description:
        'Используй этот инструмент, когда пользователь хочет доехать до конкретного места, города, улицы или организации (например, "поликлиника на Хорев в Хайфе"). Передай координаты пользователя и координаты точки назначения, которые ты определил сам.',
      inputSchema: findBestBusesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false
      }
    },
    async ({ user_location, destination_location, user_id, ignore_user_location, explicit_origin }) => {
      // If explicit_origin was passed and differs from user_location without confirmation, use dispatchSearchIntent
      if (explicit_origin && !ignore_user_location) {
        const mismatchCheck = await dispatchSearchIntent({
          query: destination_location.label,
          userLocation: user_location,
          entryContext: 'mcp',
          allowColdBootstrap: true,
          ignoreUserLocation: false,
          explicitOrigin: explicit_origin
        });
        if (mismatchCheck.requires_confirmation) {
          return {
            content: [{ type: 'text', text: JSON.stringify(mismatchCheck) }],
            structuredContent: mismatchCheck as unknown as Record<string, unknown>
          };
        }
      }

      const origin =
        ignore_user_location && explicit_origin
          ? { lat: explicit_origin.lat, lon: explicit_origin.lon }
          : { lat: user_location.lat, lon: user_location.lon };

      const classification = classifyDestinationGranularity(destination_location.label);
      let destination: GeocodedDestination = {
        lat: destination_location.lat,
        lon: destination_location.lon,
        place_name: destination_location.label,
        formatted_address: destination_location.label,
        source: 'mcp',
        destination_granularity: classification.granularity,
        ...(classification.cityName ? { city_name: classification.cityName } : {}),
        ...(classification.streetName ? { street_name: classification.streetName } : {})
      };

      if (classification.granularity === 'city' && classification.cityName) {
        const central = await supabaseService.findCentralStopForCity(classification.cityName);
        if (central) {
          destination = {
            ...destination,
            lat: central.lat,
            lon: central.lon,
            resolved_stop: central
          };
        }
      } else if (classification.granularity === 'street') {
        const streetStops = await supabaseService.findPopularStopOnStreet(
          classification.streetName || destination_location.label,
          classification.cityName,
          origin.lat,
          origin.lon
        );
        if (streetStops[0]) {
          destination = {
            ...destination,
            lat: streetStops[0].lat,
            lon: streetStops[0].lon,
            resolved_stop: streetStops[0],
            alternative_street_stops: streetStops
          };
        }
      } else {
        const nearbyStops = await supabaseService.findNearestStopsToPoint(
          destination_location.lat,
          destination_location.lon,
          480
        );
        if (nearbyStops[0]) {
          destination = { ...destination, resolved_stop: nearbyStops[0] };
        }
      }

      const baseResult = await planBestBusesToDestination({
        userLocation: origin,
        destination,
        entryContext: 'mcp',
        allowColdBootstrap: true
      });

      let result = baseResult;
      if (user_id) {
        const returningRoutes = await getReturningRoutesForLocation(
          user_id,
          user_location.lat,
          user_location.lon,
          250
        ).catch(() => []);
        if (!baseResult.no_verified_route) {
          await recordSearchResultForUser(user_id, user_location, baseResult).catch(() => undefined);
        }
        result = {
          ...baseResult,
          user_id,
          ...(returningRoutes.length > 0 ? { returning_routes: returningRoutes } : {})
        };
      }

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

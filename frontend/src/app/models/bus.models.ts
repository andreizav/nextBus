export type RenderMode = 'lite' | 'interactive';
export type WidgetLang = 'ru' | 'en' | 'he';
export type EntryContext = 'mcp' | 'standalone';

export interface GeocodedDestination {
  lat: number;
  lon: number;
  place_name: string;
  formatted_address: string;
  source?: string;
}

export interface RouteDirectionOption {
  direction_id: 0 | 1;
  label: string;
  label_he: string;
}

export interface RouteInfo {
  route_id: string;
  short_name: string;
  long_name: string;
  direction_id: 0 | 1;
  direction_label: string;
  available_directions: RouteDirectionOption[];
}

export interface UserStopInfo {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  stop_sequence: number;
  lat: number;
  lon: number;
  distance_meters?: number;
}

export interface NearestBusInfo {
  vehicle_id: string;
  lat: number;
  lon: number;
  bearing: number;
  recorded_at_time: string;
  current_stop_sequence: number;
  speed_kmh?: number;
  stops_away: number;
  eta_minutes: number;
  current_stop_code?: string;
  current_stop_name?: string;
  current_stop_name_he?: string;
}

export interface StopTimelineItem {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  stop_sequence: number;
  lat: number;
  lon: number;
  status: 'passed' | 'approaching' | 'user_stop' | 'upcoming';
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface MapProjection {
  xPercent: number;
  yPercent: number;
}

export interface LiteMapInfo {
  static_image_url: string;
  bbox: BoundingBox;
  bus_projection: MapProjection;
  user_projection: MapProjection;
}

export interface NearbyOffer {
  id: string;
  name: string;
  name_he: string;
  category: string;
  walk_minutes: number;
  distance_meters: number;
  promo: string;
  lat: number;
  lon: number;
  address?: string;
  opening_hours?: string;
  maps_url?: string;
}

export interface RecommendedBusOption {
  rank: 1 | 2 | 3;
  route: RouteInfo;
  origin_stop: UserStopInfo;
  dest_stop: UserStopInfo;
  bus: NearestBusInfo;
  eta_to_boarding_min: number;
  stops_between: number;
  ride_duration_min: number;
  total_arrival_min: number;
  estimated_arrival_time: string;
  timeline_stops: StopTimelineItem[];
}

export interface LiveBusStatusResponse {
  entry_context?: EntryContext;
  render_mode: RenderMode;
  updated_at: string;
  cache_hit: boolean;
  user_location?: { lat: number; lon: number };
  destination?: GeocodedDestination;
  recommended_options?: RecommendedBusOption[];
  route: RouteInfo;
  user_stop: UserStopInfo;
  nearest_bus: NearestBusInfo | null;
  timeline_stops: StopTimelineItem[];
  lite_map: LiteMapInfo;
  nearby_offers: NearbyOffer[];
}

declare global {
  interface Window {
    __NEXTBUS_STATE__?: LiveBusStatusResponse;
    mcpInitialState?: LiveBusStatusResponse;
  }
}

export type RenderMode = 'lite' | 'interactive';

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

export interface VehicleTelemetry {
  vehicle_id: string;
  lat: number;
  lon: number;
  bearing: number;
  recorded_at_time: string;
  current_stop_sequence: number;
  speed_kmh?: number;
}

export interface NearestBusInfo extends VehicleTelemetry {
  stops_away: number;
  eta_minutes: number;
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

export interface CachedRouteState {
  route_id: string;
  direction_id: 0 | 1;
  vehicles: VehicleTelemetry[];
  updated_at: string;
  source: 'stride' | 'fallback';
}

export interface LiveBusStatusResponse {
  render_mode: RenderMode;
  updated_at: string;
  cache_hit: boolean;
  user_location?: { lat: number; lon: number };
  route: RouteInfo;
  user_stop: UserStopInfo;
  nearest_bus: NearestBusInfo | null;
  timeline_stops: StopTimelineItem[];
  lite_map: LiteMapInfo;
  nearby_offers: NearbyOffer[];
}

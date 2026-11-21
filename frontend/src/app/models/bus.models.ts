export type RenderMode = 'lite' | 'interactive';
export type WidgetLang = 'he' | 'en' | 'ar' | 'ru' | 'uk';
export type EntryContext = 'mcp' | 'standalone';
export type IntentType = 'LINE_LOOKUP' | 'LINE_DISAMBIGUATION' | 'TRIP_PLANNER';

export interface LineCandidate {
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
  eta_minutes: number;
}

export interface TripLegBoardStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  eta_minutes: number;
  scheduled_time: string;
}

export interface TripLegAlightStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  stops_count: number;
}

export interface TripLeg {
  leg_type: 'BOARD_AND_RIDE' | 'TRANSFER';
  line_number: string;
  route_id: string;
  direction_id: 0 | 1;
  board_stop: TripLegBoardStop;
  alight_stop: TripLegAlightStop;
  transfer_wait_min?: number;
  transfer_walk_meters?: number;
  ride_duration_min: number;
}

export interface TripOption {
  rank: 1 | 2 | 3;
  total_duration_min: number;
  estimated_arrival_time: string;
  transfers_count: number;
  legs: TripLeg[];
}

export interface TimelineWindow {
  past_stops: StopTimelineItem[];
  current_bus_stop: StopTimelineItem | null;
  user_stop: StopTimelineItem | null;
  upcoming_stops: StopTimelineItem[];
  compact_stops: StopTimelineItem[];
  hidden_past_count: number;
  hidden_upcoming_count: number;
  total_stops_count: number;
}

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

export interface TransferConnectionInfo {
  alight_stop: UserStopInfo;
  board_stop: UserStopInfo;
  walk_meters: number;
  wait_minutes: number;
  arrive_at_hub_time: string;
  next_bus_board_time: string;
  instruction_ru: string;
  instruction_en: string;
  instruction_he: string;
}

export interface TransferLegDetail {
  route: RouteInfo;
  board_stop: UserStopInfo;
  alight_stop: UserStopInfo;
  bus: NearestBusInfo;
  stops_between: number;
  ride_duration_min: number;
  timeline_stops: StopTimelineItem[];
}

export interface RecommendedBusOption {
  rank: 1 | 2 | 3;
  is_transfer?: boolean;
  route: RouteInfo;
  origin_stop: UserStopInfo;
  dest_stop: UserStopInfo;
  bus: NearestBusInfo;
  eta_to_boarding_min: number;
  stops_between: number;
  ride_duration_min: number;
  total_arrival_min: number;
  estimated_arrival_time: string;
  leg1_alight_time?: string;
  timeline_stops: StopTimelineItem[];
  timeline_window?: TimelineWindow;
  transfer_info?: TransferConnectionInfo;
  second_leg?: TransferLegDetail;
}

export interface LiveBusStatusResponse {
  entry_context?: EntryContext;
  intent_type?: IntentType;
  candidates?: LineCandidate[];
  trip_options?: TripOption[];
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
  timeline_window?: TimelineWindow;
  lite_map: LiteMapInfo;
  nearby_offers: NearbyOffer[];
}

declare global {
  interface Window {
    __NEXTBUS_STATE__?: LiveBusStatusResponse;
    mcpInitialState?: LiveBusStatusResponse;
  }
}

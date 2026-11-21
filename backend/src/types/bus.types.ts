export type RenderMode = 'lite' | 'interactive';
export type EntryContext = 'mcp' | 'standalone';
export type IntentType =
  | 'LINE_LOOKUP'
  | 'LINE_DISAMBIGUATION'
  | 'TRIP_PLANNER'
  | 'LOCATION_MISMATCH';
export type DestinationGranularity = 'city' | 'address' | 'street' | 'poi';

export interface ResolvedStopOption {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_name_he: string;
  lat: number;
  lon: number;
  routes_count?: number;
  distance_meters?: number;
  is_central_hub?: boolean;
  is_hub?: boolean;
}

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
  source?: 'cache' | 'google_places' | 'google_geocoding' | 'osm_nominatim' | 'gazetteer' | 'mcp' | 'gtfs_db';
  destination_granularity?: DestinationGranularity;
  city_name?: string;
  street_name?: string;
  resolved_stop?: ResolvedStopOption;
  alternative_street_stops?: ResolvedStopOption[];
}

export interface DirectRouteMatch {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  direction_id: 0 | 1;
  origin_stop_id: string;
  origin_stop_code: string;
  origin_stop_name: string;
  origin_stop_name_he: string;
  origin_stop_sequence: number;
  origin_lat: number;
  origin_lon: number;
  dest_stop_id: string;
  dest_stop_code: string;
  dest_stop_name: string;
  dest_stop_name_he: string;
  dest_stop_sequence: number;
  dest_lat: number;
  dest_lon: number;
  stops_between: number;
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

export type EtaSource = 'realtime' | 'scheduled';

export interface VehicleTelemetry {
  vehicle_id: string;
  lat: number;
  lon: number;
  bearing: number;
  recorded_at_time: string;
  current_stop_sequence: number;
  speed_kmh?: number;
  last_updated_sec_ago?: number;
  is_realtime?: boolean;
}

export interface NearestBusInfo extends VehicleTelemetry {
  stops_away: number;
  eta_minutes: number;
  eta_source?: EtaSource;
  route_distance_meters?: number;
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

export interface CachedRouteState {
  route_id: string;
  direction_id: 0 | 1;
  vehicles: VehicleTelemetry[];
  updated_at: string;
  source: 'stride' | 'fallback';
}

export interface TransferRouteMatch {
  leg1_route_id: string;
  leg1_route_short_name: string;
  leg1_route_long_name: string;
  leg1_direction_id: 0 | 1;
  origin_stop_id: string;
  origin_stop_code: string;
  origin_stop_name: string;
  origin_stop_name_he: string;
  origin_stop_sequence: number;
  origin_lat: number;
  origin_lon: number;
  xfer_alight_stop_id: string;
  xfer_alight_stop_code: string;
  xfer_alight_stop_name: string;
  xfer_alight_stop_name_he: string;
  xfer_alight_stop_sequence: number;
  xfer_alight_lat: number;
  xfer_alight_lon: number;
  leg1_stops_between: number;
  transfer_walk_meters_actual: number;
  leg2_route_id: string;
  leg2_route_short_name: string;
  leg2_route_long_name: string;
  leg2_direction_id: 0 | 1;
  xfer_board_stop_id: string;
  xfer_board_stop_code: string;
  xfer_board_stop_name: string;
  xfer_board_stop_name_he: string;
  xfer_board_stop_sequence: number;
  xfer_board_lat: number;
  xfer_board_lon: number;
  dest_stop_id: string;
  dest_stop_code: string;
  dest_stop_name: string;
  dest_stop_name_he: string;
  dest_stop_sequence: number;
  dest_lat: number;
  dest_lon: number;
  leg2_stops_between: number;
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

export interface ReturningRouteSuggestion {
  id?: string;
  user_id: string;
  origin_lat: number;
  origin_lon: number;
  origin_stop_id?: string | null;
  origin_stop_name?: string | null;
  dest_label?: string | null;
  dest_lat?: number | null;
  dest_lon?: number | null;
  route_id?: string | null;
  line_number?: string | null;
  direction_id?: 0 | 1 | null;
  use_count: number;
  last_used_at: string;
  distance_meters: number;
  eta_minutes?: number;
}

export interface LocalLineSuggestion {
  route_id: string;
  line_number: string;
  route_long_name: string;
  direction_id: 0 | 1;
  nearest_stop_id: string;
  nearest_stop_code: string;
  nearest_stop_name: string;
  nearest_stop_name_he: string;
  nearest_stop_sequence: number;
  stop_lat: number;
  stop_lon: number;
  distance_meters: number;
  destination_name: string;
  destination_he: string;
  eta_minutes: number;
}

export interface LocalSuggestionsResponse {
  user_location: { lat: number; lon: number };
  returning_routes: ReturningRouteSuggestion[];
  local_lines: LocalLineSuggestion[];
}

export interface ProposedOriginInfo {
  label: string;
  lat: number;
  lon: number;
  stop_id?: string;
  stop_code?: string;
  stop_name?: string;
  stop_name_he?: string;
  line_number?: string;
  destination_query?: string;
  original_query?: string;
}

export interface CurrentLocationSummary {
  lat: number;
  lon: number;
  label: string;
  nearest_stop_name?: string;
  nearest_stop_name_he?: string;
  distance_to_proposed_meters: number;
}

export interface RoutingNotice {
  message_ru: string;
  message_he: string;
  message_en: string;
  nearest_confirmed_hub?: UserStopInfo;
}

export interface LiveBusStatusResponse {
  user_id?: string;
  entry_context?: EntryContext;
  intent_type?: IntentType;
  requires_confirmation?: boolean;
  confirmation_type?: 'location_mismatch';
  proposed_origin?: ProposedOriginInfo;
  current_location_summary?: CurrentLocationSummary;
  confirmation_prompt_ru?: string;
  confirmation_prompt_he?: string;
  confirmation_prompt_en?: string;
  no_verified_route?: boolean;
  routing_notice?: RoutingNotice;
  candidates?: LineCandidate[];
  trip_options?: TripOption[];
  returning_routes?: ReturningRouteSuggestion[];
  local_suggestions?: LocalLineSuggestion[];
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

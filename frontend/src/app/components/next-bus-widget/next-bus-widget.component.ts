import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import type {
  EntryContext,
  GeocodedDestination,
  LineCandidate,
  LiveBusStatusResponse,
  LocalLineSuggestion,
  LocalSuggestionsResponse,
  RenderMode,
  ResolvedStopOption,
  ReturningRouteSuggestion,
  UserStopInfo,
  WidgetLang
} from '../../models/bus.models';
import { DataSourcesFooterComponent } from '../data-sources-footer/data-sources-footer.component';
import { InteractiveMapViewComponent } from '../interactive-map-view/interactive-map-view.component';
import { LiteTimelineViewComponent } from '../lite-timeline-view/lite-timeline-view.component';
import { SearchBarComponent } from '../search-bar/search-bar.component';

const POLL_INTERVAL_MS = 15_000;
/** Wait this long for GPS before showing suggestions around the default service-area point. */
const GEO_FALLBACK_DELAY_MS = 3_500;
/** Re-ask once for local ETAs that were still warming up in the backend cache. */
const PENDING_ETA_RETRY_MS = 5_000;
/** Moving less than this does not justify re-querying with a refined GPS fix. */
const GEO_REFINE_MIN_MOVE_METERS = 120;
const SUGGESTIONS_CACHE_KEY = 'nb_local_suggestions_v1';
const SUGGESTIONS_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

function approxDistanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

const DEFAULT_COORDS = {
  lat: 32.7895,
  lon: 34.9640
};

const EMPTY_INITIAL_STATE: LiveBusStatusResponse = {
  render_mode: 'lite',
  updated_at: new Date().toISOString(),
  cache_hit: true,
  user_location: DEFAULT_COORDS,
  route: {
    route_id: '',
    short_name: '',
    long_name: '',
    direction_id: 0,
    direction_label: '',
    available_directions: []
  },
  user_stop: {
    stop_id: '',
    stop_code: '',
    stop_name: '',
    stop_name_he: '',
    stop_sequence: 0,
    lat: DEFAULT_COORDS.lat,
    lon: DEFAULT_COORDS.lon,
    distance_meters: 0
  },
  nearest_bus: null,
  timeline_stops: [],
  lite_map: {
    static_image_url: '',
    bbox: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    bus_projection: { xPercent: 0, yPercent: 0 },
    user_projection: { xPercent: 0, yPercent: 0 }
  },
  nearby_offers: []
};

@Component({
  selector: 'nb-next-bus-widget',
  standalone: true,
  imports: [
    CommonModule,
    LiteTimelineViewComponent,
    InteractiveMapViewComponent,
    SearchBarComponent,
    DataSourcesFooterComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="widget-shell nb-card"
      [class.is-map-mode]="hasActiveSearch() && viewMode() === 'interactive'"
      [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'"
    >
      <!-- Subtle top micro utility strip (location + language + reset) -->
      <div class="micro-top-bar">
        <button
          type="button"
          class="micro-geo-btn"
          [class.is-granted]="geoStatus() === 'granted'"
          (click)="requestUserGeolocation()"
          [disabled]="geoStatus() === 'locating'"
          [title]="labels().locateMe"
        >
          <span aria-hidden="true">📍</span>
          <span>{{ geoStatus() === 'locating' ? labels().locating : detectedCityName() }}</span>
        </button>

        <div class="micro-right">
          @if (hasActiveSearch()) {
            <button
              type="button"
              class="micro-reset-btn"
              (click)="resetSearch()"
              [title]="welcomeLabels().resetTitle"
              [attr.aria-label]="welcomeLabels().resetTitle"
            >
              ✕
            </button>
          }

          <div class="micro-langs" role="group" aria-label="Language selection">
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'he'"
              (click)="selectLang('he')"
              title="עברית"
            >
              HE
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'en'"
              (click)="selectLang('en')"
              title="English"
            >
              EN
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'ar'"
              (click)="selectLang('ar')"
              title="العربية"
            >
              AR
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'ru'"
              (click)="selectLang('ru')"
              title="Русский"
            >
              RU
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'uk'"
              (click)="selectLang('uk')"
              title="Українська"
            >
              UK
            </button>
          </div>
        </div>
      </div>

      <!-- Minimalist pill search bar (strictly hidden in MCP / Gemini embed mode) -->
      @if (entryContext() === 'standalone') {
        <nb-search-bar
          [lang]="lang()"
          [isSearching]="isSearching()"
          (searchSubmitted)="onSearchDestination($event)"
        />
      }

      @if (!hasActiveSearch()) {
        <section class="minimal-ready" role="region" aria-label="Local transit and recent routes">
          <div class="ready-head">
            <h2 class="ready-title">{{ welcomeLabels().title }}</h2>
            <p class="ready-sub">{{ welcomeLabels().tip }}</p>
          </div>

          <!-- 1. Returning User Routes Near Current Location (~250m) -->
          @if (returningRoutes().length > 0) {
            <div class="sug-block">
              <div class="sug-head">{{ welcomeLabels().returningTitle }}</div>
              <div class="sug-list">
                @for (item of returningRoutes(); track (item.id || '') + '-' + (item.dest_label || item.route_id) + '-' + $index) {
                  <button
                    type="button"
                    class="sug-card is-returning"
                    (click)="onSelectReturningRoute(item)"
                  >
                    <div class="sug-row-top">
                      <span class="sug-line-badge is-history">
                        🕒 {{ item.line_number || '🚌' }}
                      </span>
                      <span class="sug-terminus" dir="auto">
                        → {{ cleanPlaceName(item.dest_label || item.origin_stop_name || '') }}
                      </span>
                      @if (item.eta_minutes !== undefined) {
                        <span class="sug-eta">{{ item.eta_minutes }} {{ minShort() }}</span>
                      }
                    </div>
                    <div class="sug-row-meta" dir="auto">
                      @if (item.origin_stop_name) {
                        <span>📍 {{ cleanPlaceName(item.origin_stop_name) }}</span>
                        <span>•</span>
                      }
                      <span>{{ item.distance_meters }} m</span>
                    </div>
                  </button>
                }
              </div>
            </div>
          }

          <!-- 2. Local Bus Lines Passing Nearby Stops (number + terminus + live ETA) -->
          <div class="sug-block">
            <div class="sug-head">{{ welcomeLabels().localTitle }}</div>

            @if (localLines().length === 0 && (isLoadingSuggestions() || geoStatus() === 'locating')) {
              <div class="sug-list" role="status" aria-busy="true" [attr.aria-label]="loadingText()">
                @for (i of skeletonRows; track i) {
                  <div class="sug-card is-skeleton" aria-hidden="true">
                    <div class="sug-row-top">
                      <span class="skel skel-badge"></span>
                      <span class="skel skel-line"></span>
                      <span class="skel skel-pill"></span>
                    </div>
                    <div class="sug-row-meta"><span class="skel skel-line is-short"></span></div>
                  </div>
                }
              </div>
            } @else if (localLines().length === 0) {
              <div class="sug-empty">{{ welcomeLabels().noLocalLines }}</div>
            } @else {
              <div class="sug-list">
                @for (line of localLines(); track line.route_id + '-' + line.direction_id) {
                  <button
                    type="button"
                    class="sug-card"
                    (click)="onSelectLocalLine(line)"
                  >
                    <div class="sug-row-top">
                      <span class="sug-line-badge">{{ line.line_number }}</span>
                      <span class="sug-terminus" dir="auto">
                        → {{
                          cleanPlaceName(
                            lang() === 'he' || lang() === 'ar'
                              ? line.destination_he
                              : line.destination_name
                          )
                        }}
                      </span>
                      @if (line.eta_minutes !== undefined) {
                        <span class="sug-eta">{{ line.eta_minutes }} {{ minShort() }}</span>
                      } @else {
                        <span class="sug-eta is-pending" [title]="etaPendingText()">
                          <span class="pending-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                          <span class="visually-hidden">{{ etaPendingText() }}</span>
                        </span>
                      }
                    </div>
                    <div class="sug-row-meta" dir="auto">
                      <span>
                        📍
                        {{
                          cleanPlaceName(
                            lang() === 'he' || lang() === 'ar'
                              ? line.nearest_stop_name_he
                              : line.nearest_stop_name
                          )
                        }}
                      </span>
                      <span>•</span>
                      <span>{{ line.distance_meters }} m</span>
                    </div>
                  </button>
                }
              </div>
            }
          </div>
        </section>
      } @else if (showStatusSkeleton()) {
        <!-- Skeleton while the first response for a new query is in flight -->
        <section class="status-skeleton" role="status" aria-busy="true" [attr.aria-label]="loadingText()">
          <div class="skel-hero">
            <div class="skel-hero-left">
              <span class="skel skel-badge is-lg"></span>
              <span class="skel skel-line is-short"></span>
            </div>
            <div class="skel-hero-right">
              <span class="skel skel-eta"></span>
              <span class="skel skel-line is-tiny"></span>
            </div>
          </div>
          <div class="skel-direction">
            <span class="skel skel-line"></span>
            <span class="skel skel-line is-short"></span>
          </div>
          <ol class="skel-timeline" aria-hidden="true">
            @for (i of skeletonRows; track i) {
              <li><span class="skel skel-dot"></span><span class="skel skel-line"></span></li>
            }
          </ol>
          <div class="skel-caption">{{ loadingText() }}</div>
        </section>
      } @else if (busState().requires_confirmation && busState().confirmation_type === 'location_mismatch') {
        <!-- Location Mismatch Confirmation Card -->
        <section class="mismatch-card" role="alertdialog" aria-label="Location mismatch confirmation">
          <div class="mismatch-head">
            <span class="mismatch-icon" aria-hidden="true">📍</span>
            <h3 class="mismatch-title">{{ extraLabels().mismatchTitle }}</h3>
          </div>
          <p class="mismatch-body" dir="auto">{{ mismatchPromptText() }}</p>
          @if (busState().proposed_origin; as prop) {
            <div class="mismatch-chips">
              <div class="mismatch-chip" dir="auto">
                <span class="chip-k">{{ extraLabels().currentGpsLabel }}:</span>
                <span class="chip-v">{{ busState().current_location_summary?.label }}</span>
              </div>
              <div class="mismatch-chip is-proposed" dir="auto">
                <span class="chip-k">{{ extraLabels().requestedOriginLabel }}:</span>
                <span class="chip-v">{{ prop.label }}</span>
              </div>
            </div>
          }
          <div class="mismatch-actions">
            <button
              type="button"
              class="mismatch-btn is-confirm"
              [disabled]="isSearching()"
              (click)="confirmLocationMismatch()"
            >
              {{ extraLabels().confirmProposedBtn }}
            </button>
            <button
              type="button"
              class="mismatch-btn is-current"
              [disabled]="isSearching()"
              (click)="useCurrentLocationInstead()"
            >
              {{ extraLabels().useCurrentBtn }}
            </button>
          </div>
        </section>
      } @else if (busState().no_verified_route) {
        <!-- Honest No Verified GTFS Route Card -->
        <section class="notice-card" role="status">
          <div class="mismatch-head">
            <span class="mismatch-icon" aria-hidden="true">🧭</span>
            <h3 class="mismatch-title">{{ extraLabels().noRouteTitle }}</h3>
          </div>
          <p class="mismatch-body" dir="auto">{{ routingNoticeText() }}</p>
          @if (busState().routing_notice?.nearest_confirmed_hub; as hub) {
            <button
              type="button"
              class="mismatch-btn is-confirm"
              [disabled]="isSearching()"
              (click)="planToConfirmedHub(hub)"
            >
              {{ extraLabels().routeToHubPrefix }}: {{ cleanPlaceName(lang() === 'he' || lang() === 'ar' ? hub.stop_name_he : hub.stop_name) }}
            </button>
          }
          <button
            type="button"
            class="mismatch-btn is-current"
            (click)="resetSearch()"
          >
            {{ welcomeLabels().resetBtn }}
          </button>
        </section>
      } @else {
        @if (busState().destination?.destination_granularity === 'street' && (busState().destination?.alternative_street_stops?.length ?? 0) > 1) {
          <div class="street-stops-strip" role="region" aria-label="Alternative street stops">
            <div class="street-stops-head">{{ extraLabels().streetStopsTitle }}</div>
            <div class="street-stops-pills">
              @for (s of busState().destination!.alternative_street_stops!; track s.stop_id) {
                <button
                  type="button"
                  class="street-stop-pill"
                  [class.is-active]="(preferredDestStopId() || busState().destination?.resolved_stop?.stop_id) === s.stop_id"
                  (click)="onSelectStreetStop(s)"
                >
                  <span class="pill-name" dir="auto">
                    {{ cleanPlaceName(lang() === 'he' || lang() === 'ar' ? s.stop_name_he : s.stop_name) }}
                  </span>
                  @if (s.routes_count) {
                    <span class="pill-cnt">({{ s.routes_count }})</span>
                  }
                </button>
              }
            </div>
          </div>
        }

        @if (isRefreshing()) {
          <div class="refresh-bar" role="progressbar" [attr.aria-label]="loadingText()"></div>
        }

        @if (viewMode() === 'lite') {
          <nb-lite-timeline-view
            [state]="busState()"
            [lang]="lang()"
            [selectedOptionIndex]="selectedOptionIndex()"
            [isTripReversed]="isTripReversed()"
            [originLabel]="detectedCityName()"
            [targetLabel]="originalDestination()?.place_name ?? busState().destination?.place_name ?? ''"
            (selectOptionIndex)="selectedOptionIndex.set($event)"
            (switchDirection)="onDirectionSwitch($event)"
            (reverseTrip)="onReverseTrip()"
            (selectCandidate)="onSelectCandidate($event)"
            (openMap)="setViewMode('interactive')"
          />
        } @else {
          @defer {
            <nb-interactive-map-view
              [state]="busState()"
              [lang]="lang()"
              [selectedOptionIndex]="selectedOptionIndex()"
              [isTripReversed]="isTripReversed()"
              [originLabel]="detectedCityName()"
              [targetLabel]="originalDestination()?.place_name ?? busState().destination?.place_name ?? ''"
              (selectOptionIndex)="selectedOptionIndex.set($event)"
              (switchDirection)="onDirectionSwitch($event)"
              (reverseTrip)="onReverseTrip()"
            />
          } @loading (minimum 120ms) {
            <div class="defer-status" role="status" aria-busy="true">
              <span class="spinner" aria-hidden="true"></span>
              <span>{{ labels().loadingMap }}</span>
            </div>
          }
        }

        <!-- Bottom segmented pill bar matching reference UI -->
        <div class="bottom-pill-bar" role="tablist" aria-label="View mode switch">
          <button
            type="button"
            role="tab"
            class="seg-btn"
            [class.is-selected]="viewMode() === 'interactive'"
            (click)="setViewMode('interactive')"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
              <line x1="9" y1="3" x2="9" y2="18"/>
              <line x1="15" y1="6" x2="15" y2="21"/>
            </svg>
            <span>{{ labels().viewMap }}</span>
          </button>

          <button
            type="button"
            role="tab"
            class="seg-btn"
            [class.is-selected]="viewMode() === 'lite'"
            (click)="setViewMode('lite')"
          >
            <span>{{ labels().liveTrack }}</span>
            <span class="live-dot" [class.is-paused]="isPollingPaused()" aria-hidden="true">●</span>
          </button>
        </div>
      }

      <nb-data-sources-footer [lang]="lang()" />
    </main>
  `,
  styles: [
    `
      .widget-shell {
        color-scheme: only dark;
        background: linear-gradient(180deg, #222931 0%, #1d232b 100%);
        color: #f8fafc;
        inline-size: 100%;
        max-inline-size: min(420px, 100%);
        margin-inline: auto;
        min-inline-size: 0;
        overflow-x: clip;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 1.75rem;
        padding-block: 1.15rem 1.2rem;
        padding-inline: 1.15rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        transition: max-inline-size 0.2s ease;
      }

      .widget-shell.is-map-mode {
        max-inline-size: min(480px, 100%);
      }

      @media (max-width: 400px) {
        .widget-shell {
          padding-block: 0.95rem 1rem;
          padding-inline: 0.85rem;
          border-radius: 1.35rem;
        }
      }

      /* Subtle Micro Header */
      .micro-top-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        column-gap: 0.45rem;
        row-gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        margin-block: -0.25rem -0.35rem;
      }

      .micro-geo-btn {
        background: transparent;
        border: none;
        padding: 0.2rem 0.3rem;
        border-radius: 999px;
        color: #8b96a5;
        font-size: 0.72rem;
        font-weight: 500;
        display: block;
        text-align: start;
        flex: 0 1 auto;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .micro-geo-btn.is-granted,
      .micro-geo-btn:hover {
        color: #cbd5e1;
      }

      .micro-right {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
        margin-inline-start: auto;
        max-inline-size: 100%;
      }

      .micro-langs {
        display: inline-flex;
        gap: 0.1rem;
      }

      .micro-lang-btn,
      .micro-reset-btn {
        background: transparent;
        border: none;
        color: #7c8796;
        font-size: 0.66rem;
        font-weight: 700;
        padding: 0.18rem 0.28rem;
        border-radius: 0.4rem;
        cursor: pointer;
      }

      .micro-lang-btn.is-active {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.09);
      }

      .micro-reset-btn:hover {
        color: #f87171;
        background: rgba(239, 68, 68, 0.12);
      }

      /* Minimalist Empty Ready State */
      .minimal-ready {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.9rem;
        padding-block: 0.35rem 0.25rem;
      }

      .ready-head {
        text-align: center;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0.28rem;
      }

      .ready-title {
        margin: 0;
        font-size: 1.08rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .ready-sub {
        margin: 0;
        font-size: 0.76rem;
        color: #8b96a5;
        line-height: 1.38;
      }

      .sug-block {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.42rem;
      }

      .sug-head {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #8b96a5;
        padding-inline: 0.2rem;
      }

      .sug-empty {
        font-size: 0.78rem;
        color: #7c8796;
        text-align: center;
        padding-block: 0.65rem;
      }

      .sug-list {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.42rem;
      }

      .sug-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.2rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-align: start;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 0.9rem;
        padding: 0.5rem 0.7rem;
        color: #e2e8f0;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .sug-card:hover {
        background: rgba(48, 135, 246, 0.16);
        border-color: #3087f6;
        color: #ffffff;
      }

      .sug-card.is-returning {
        background: rgba(48, 135, 246, 0.12);
        border-color: rgba(59, 130, 246, 0.38);
      }

      .sug-row-top {
        display: flex;
        align-items: center;
        gap: 0.48rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .sug-line-badge {
        background: #3087f6;
        color: #ffffff;
        font-size: 0.76rem;
        font-weight: 800;
        border-radius: 0.45rem;
        padding: 0.12rem 0.45rem;
        flex-shrink: 0;
      }

      .sug-line-badge.is-history {
        background: rgba(59, 130, 246, 0.28);
        border: 1px solid rgba(96, 165, 250, 0.55);
      }

      .sug-terminus {
        font-size: 0.82rem;
        font-weight: 600;
        color: #f8fafc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1 1 auto;
        min-inline-size: 0;
      }

      .sug-eta {
        font-size: 0.74rem;
        font-weight: 700;
        color: #93c5fd;
        flex-shrink: 0;
      }

      .sug-row-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        font-size: 0.71rem;
        color: #9aa6b4;
        overflow-wrap: anywhere;
      }

      .defer-status {
        padding-block: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.6rem;
        font-size: 0.85rem;
        color: #9aa6b4;
      }

      /* Loading skeletons & progress indicators */
      .skel {
        display: inline-block;
        block-size: 0.7rem;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.06) 0%,
          rgba(255, 255, 255, 0.14) 50%,
          rgba(255, 255, 255, 0.06) 100%
        );
        background-size: 200% 100%;
        animation: nb-shimmer 1.2s ease-in-out infinite;
      }

      .skel-badge { inline-size: 2.4rem; block-size: 1.35rem; border-radius: 0.5rem; flex: none; }
      .skel-badge.is-lg { inline-size: 4.2rem; block-size: 2rem; border-radius: 0.7rem; }
      .skel-pill { inline-size: 2.6rem; block-size: 1.1rem; flex: none; }
      .skel-line { inline-size: 100%; min-inline-size: 0; flex: 1 1 auto; }
      .skel-line.is-short { inline-size: 55%; flex: none; }
      .skel-line.is-tiny { inline-size: 3.2rem; flex: none; }
      .skel-eta { inline-size: 4.4rem; block-size: 2.4rem; border-radius: 0.7rem; }
      .skel-dot { inline-size: 0.8rem; block-size: 0.8rem; flex: none; }

      .sug-card.is-skeleton { pointer-events: none; }
      .sug-card.is-skeleton .sug-row-top { display: flex; align-items: center; gap: 0.5rem; }

      .status-skeleton {
        display: grid;
        gap: 0.85rem;
        padding: 0.9rem;
        border-radius: 1.1rem;
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      .skel-hero { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
      .skel-hero-left, .skel-hero-right { display: grid; gap: 0.45rem; justify-items: start; min-inline-size: 0; flex: 1; }
      .skel-hero-right { justify-items: end; flex: none; }
      .skel-direction { display: grid; gap: 0.45rem; padding: 0.7rem; border-radius: 0.8rem; background: rgba(255, 255, 255, 0.03); }
      .skel-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.75rem; }
      .skel-timeline li { display: flex; align-items: center; gap: 0.7rem; }
      .skel-caption { text-align: center; font-size: 0.75rem; color: #8b96a5; }

      .refresh-bar {
        block-size: 3px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(59, 130, 246, 0.15);
        position: relative;
      }
      .refresh-bar::after {
        content: '';
        position: absolute;
        inset-block: 0;
        inline-size: 35%;
        border-radius: inherit;
        background: #3b82f6;
        animation: nb-indeterminate 1s ease-in-out infinite;
      }

      .spinner {
        inline-size: 1rem;
        block-size: 1rem;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.15);
        border-top-color: #3b82f6;
        animation: nb-spin 0.8s linear infinite;
      }

      .sug-eta.is-pending { display: inline-flex; align-items: center; }
      .pending-dots { display: inline-flex; gap: 3px; }
      .pending-dots i {
        inline-size: 4px;
        block-size: 4px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.35;
        animation: nb-blink 1.2s ease-in-out infinite;
      }
      .pending-dots i:nth-child(2) { animation-delay: 0.2s; }
      .pending-dots i:nth-child(3) { animation-delay: 0.4s; }

      .visually-hidden {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      @keyframes nb-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      @keyframes nb-indeterminate { from { inset-inline-start: -35%; } to { inset-inline-start: 100%; } }
      @keyframes nb-spin { to { transform: rotate(360deg); } }
      @keyframes nb-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

      @media (prefers-reduced-motion: reduce) {
        .skel, .refresh-bar::after, .spinner, .pending-dots i { animation-duration: 0s; animation-iteration-count: 1; }
      }

      /* Bottom Segmented Blue Pill Bar */
      .bottom-pill-bar {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        min-inline-size: 0;
        max-inline-size: 100%;
        background: #1a54a6;
        border-radius: 999px;
        padding: 0.22rem;
        margin-block-start: 0.25rem;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35);
      }

      .seg-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        min-inline-size: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background: transparent;
        border: none;
        border-radius: 999px;
        padding-block: 0.62rem;
        padding-inline: 0.55rem;
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.84rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      }

      .seg-btn.is-selected {
        background: #3087f6;
        color: #ffffff;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
      }

      .live-dot {
        font-size: 0.62rem;
        color: #7dd3fc;
      }

      .live-dot.is-paused {
        color: #94a3b8;
      }

      /* Location Mismatch Confirmation & Honest Notice Cards */
      .mismatch-card,
      .notice-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(59, 130, 246, 0.35);
        border-radius: 1.15rem;
        padding: 0.9rem 0.95rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .notice-card {
        border-color: rgba(245, 158, 11, 0.4);
      }

      .mismatch-head {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-inline-size: 0;
      }

      .mismatch-icon {
        font-size: 1.05rem;
        flex-shrink: 0;
      }

      .mismatch-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 700;
        color: #f8fafc;
        overflow-wrap: anywhere;
      }

      .mismatch-body {
        margin: 0;
        font-size: 0.82rem;
        line-height: 1.45;
        color: #dbe2ea;
        overflow-wrap: anywhere;
      }

      .mismatch-chips {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.35rem;
        min-inline-size: 0;
      }

      .mismatch-chip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
        font-size: 0.74rem;
        padding: 0.38rem 0.6rem;
        border-radius: 0.65rem;
        background: rgba(15, 23, 34, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .mismatch-chip.is-proposed {
        border-color: rgba(59, 130, 246, 0.4);
        color: #eff6ff;
      }

      .chip-k {
        color: #9aa6b4;
        font-weight: 600;
      }

      .mismatch-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.45rem;
        min-inline-size: 0;
      }

      .mismatch-btn {
        inline-size: 100%;
        padding: 0.58rem 0.8rem;
        border-radius: 0.85rem;
        border: 1px solid transparent;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
        text-align: center;
        overflow-wrap: anywhere;
        transition: all 0.15s ease;
      }

      .mismatch-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .mismatch-btn.is-confirm {
        background: #3087f6;
        color: #ffffff;
      }

      .mismatch-btn.is-confirm:hover:not(:disabled) {
        background: #2563eb;
      }

      .mismatch-btn.is-current {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(255, 255, 255, 0.14);
        color: #e2e8f0;
      }

      .mismatch-btn.is-current:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.13);
      }

      /* Alternative Street Stops Switcher */
      .street-stops-strip {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.35rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .street-stops-head {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #8b96a5;
        padding-inline: 0.15rem;
      }

      .street-stops-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 0.32rem;
        min-inline-size: 0;
      }

      .street-stop-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        max-inline-size: 100%;
        min-inline-size: 0;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 999px;
        padding: 0.24rem 0.58rem;
        color: #cbd5e1;
        font-size: 0.71rem;
        font-weight: 600;
        cursor: pointer;
      }

      .street-stop-pill.is-active {
        background: rgba(48, 135, 246, 0.22);
        border-color: #3087f6;
        color: #ffffff;
      }

      .pill-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pill-cnt {
        color: #93c5fd;
        flex-shrink: 0;
      }
    `
  ]
})
export class NextBusWidgetComponent implements OnInit, OnDestroy {
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  readonly initialState = input<LiveBusStatusResponse | null>(null);

  readonly busState = signal<LiveBusStatusResponse>(EMPTY_INITIAL_STATE);
  readonly hasActiveSearch = signal<boolean>(false);
  readonly activeSearchLabel = signal<string>('');
  readonly entryContext = signal<EntryContext>('standalone');
  readonly isSearching = signal<boolean>(false);
  readonly selectedDirection = signal<0 | 1>(0);
  readonly selectedRouteId = signal<string | null>(null);
  readonly selectedOptionIndex = signal<number>(0);
  readonly isTripReversed = signal<boolean>(false);
  readonly originalDestination = signal<GeocodedDestination | null>(null);
  readonly hasExplicitDirection = signal(false);
  readonly confirmedExplicitOrigin = signal<{ lat: number; lon: number; label: string; stop_id?: string } | null>(null);
  readonly preferredDestStopId = signal<string | null>(null);
  readonly userId = signal<string>('');
  readonly returningRoutes = signal<ReturningRouteSuggestion[]>([]);
  readonly localLines = signal<LocalLineSuggestion[]>([]);
  readonly isLoadingSuggestions = signal<boolean>(false);
  readonly lang = signal<WidgetLang>('he');
  private hasManualLang = false;
  readonly userCoords = signal<{ lat: number; lon: number; accuracy?: number } | null>(null);
  readonly geoStatus = signal<'idle' | 'locating' | 'granted' | 'denied'>('idle');
  private readonly modeOverride = signal<RenderMode | null>(null);
  private readonly isTabHidden = signal(false);
  private readonly isInViewport = signal(true);

  readonly viewMode = computed<RenderMode>(
    () => this.modeOverride() ?? this.busState().render_mode
  );

  readonly isPollingPaused = computed(
    () => this.isTabHidden() || !this.isInViewport()
  );

  /** User-initiated refresh of an already displayed result (direction switch, reverse, ...). */
  readonly isRefreshing = signal<boolean>(false);
  readonly skeletonRows = [0, 1, 2];

  /** Full skeleton only when there is nothing meaningful to show for the new query yet. */
  readonly showStatusSkeleton = computed(
    () =>
      this.hasActiveSearch() &&
      (this.isSearching() || this.busState() === EMPTY_INITIAL_STATE)
  );

  readonly loadingText = computed(() => {
    switch (this.lang()) {
      case 'he':
        return 'טוען נתונים…';
      case 'ar':
        return 'جارٍ التحميل…';
      case 'uk':
        return 'Завантаження…';
      case 'ru':
        return 'Загрузка…';
      default:
        return 'Loading…';
    }
  });

  readonly etaPendingText = computed(() => {
    switch (this.lang()) {
      case 'he':
        return 'ממתין לנתוני זמן אמת';
      case 'ar':
        return 'بانتظار البيانات الحية';
      case 'uk':
        return 'Очікуємо дані в реальному часі';
      case 'ru':
        return 'Ждём данные в реальном времени';
      default:
        return 'Waiting for live data';
    }
  });

  /**
   * Monotonic id of the latest user action. Any response belonging to an older action (or a poll
   * that started before it) is dropped, so a slow stale response can never overwrite a newer view.
   */
  private actionSeq = 0;
  private pollInFlight = false;
  private suggestionsSeq = 0;
  private geoFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEtaTimer: ReturnType<typeof setTimeout> | null = null;

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          live: 'חי • 15 שניות',
          paused: 'מושהה ברקע',
          locateMe: 'המיקום שלי',
          locating: 'מאתר...',
          defaultArea: 'חיפה (ברירת מחדל)',
          toStop: 'מרחק לתחנה',
          viewMap: 'צפה במפה',
          liveTrack: 'מעקב חי',
          loadingMap: 'טוען מפה אינטראקטיבית...',
          lineWord: 'קו'
        };
      case 'ar':
        return {
          live: 'مباشر • 15ث',
          paused: 'متوقف مؤقتاً',
          locateMe: 'موقعي',
          locating: 'جارٍ التحديد...',
          defaultArea: 'حيفا (افتراضي)',
          toStop: 'المسافة للمحطة',
          viewMap: 'عرض الخريطة',
          liveTrack: 'تتبع مباشر',
          loadingMap: 'جارٍ تحميل الخريطة...',
          lineWord: 'خط'
        };
      case 'uk':
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (фон)',
          locateMe: 'Моя геопозиція',
          locating: 'Пошук GPS...',
          defaultArea: 'Хайфа (за замовч.)',
          toStop: 'До зупинки',
          viewMap: 'Карта',
          liveTrack: 'Live Track',
          loadingMap: 'Завантаження інтерактивної карти...',
          lineWord: 'Автобус'
        };
      case 'en':
        return {
          live: 'Live • 15s',
          paused: 'Paused',
          locateMe: 'My Location',
          locating: 'Locating...',
          defaultArea: 'Haifa (default)',
          toStop: 'To nearest stop',
          viewMap: 'View Map',
          liveTrack: 'Live Track',
          loadingMap: 'Loading map...',
          lineWord: 'Line'
        };
      default:
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (не видим)',
          locateMe: 'Моя геопозиция',
          locating: 'Поиск GPS...',
          defaultArea: 'Хайфа (по умолчанию)',
          toStop: 'До остановки',
          viewMap: 'Карта',
          liveTrack: 'Live Track',
          loadingMap: 'Загрузка интерактивной карты...',
          lineWord: 'Автобус'
        };
    }
  });

  readonly welcomeLabels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          title: 'לאן תרצו להגיע היום?',
          tip: 'הזינו מספר קו או כתובת יעד, או בחרו מהקווים הקרובים אליכם.',
          returningTitle: 'המסלולים האחרונים שלך מכאן',
          localTitle: 'אוטובוסים קרובים אליך',
          noLocalLines: 'אין תחנות אוטובוס בקרבת המיקום הנוכחי',
          resetBtn: 'חיפוש חדש',
          resetTitle: 'איפוס וחזרה למסך הראשי'
        };
      case 'ar':
        return {
          title: 'إلى أين تريد الذهاب اليوم؟',
          tip: 'أدخل رقم الحافلة أو الوجهة، أو اختر من الحافلات القريبة منك.',
          returningTitle: 'مساراتك الأخيرة من هنا',
          localTitle: 'حافلات بالقرب منك',
          noLocalLines: 'لم يتم العثور على محطات قريبة',
          resetBtn: 'بحث جديد',
          resetTitle: 'إعادة تعيين والعودة للبداية'
        };
      case 'uk':
        return {
          title: 'Куди ви хочете поїхати?',
          tip: 'Введіть номер автобуса або пункт призначення чи оберіть найближчий рейс.',
          returningTitle: 'Ваші нещодавні маршрути звідси',
          localTitle: 'Автобуси поруч із вами',
          noLocalLines: 'Не знайдено зупинок поблизу',
          resetBtn: 'Новий пошук',
          resetTitle: 'Скинути та повернутися на головний екран'
        };
      case 'en':
        return {
          title: 'Where would you like to go?',
          tip: 'Enter a bus line or destination, or tap a local bus stop nearby.',
          returningTitle: 'Your recent routes from here',
          localTitle: 'Buses near you',
          noLocalLines: 'No nearby bus stops found',
          resetBtn: 'New search',
          resetTitle: 'Clear and return to start screen'
        };
      default:
        return {
          title: 'Куда вы хотите поехать?',
          tip: 'Введите номер автобуса или место назначения, либо выберите маршрут рядом с вами.',
          returningTitle: 'Ваши недавние маршруты отсюда',
          localTitle: 'Автобусы рядом с вами',
          noLocalLines: 'Поблизости нет остановок в базе',
          resetBtn: 'Новый поиск',
          resetTitle: 'Сбросить и вернуться на главный экран'
        };
    }
  });

  readonly extraLabels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          mismatchTitle: 'אי התאמה במיקום הנוכחי',
          currentGpsLabel: 'מיקום GPS נוכחי',
          requestedOriginLabel: 'מוצא מבוקש',
          confirmProposedBtn: 'כן, חפש מנקודה זו',
          useCurrentBtn: 'השתמש במיקום הנוכחי שלי',
          noRouteTitle: 'לא נמצא מסלול מאומת',
          routeToHubPrefix: 'מסלול למרכז הקרוב',
          streetStopsTitle: 'תחנות מומלצות ברחוב (בחירה)'
        };
      case 'ar':
        return {
          mismatchTitle: 'عدم تطابق الموقع الحالي',
          currentGpsLabel: 'موقع GPS الحالي',
          requestedOriginLabel: 'نقطة الانطلاق المطلوبة',
          confirmProposedBtn: 'نعم، ابحث من النقطة المحددة',
          useCurrentBtn: 'استخدام موقعي الحالي',
          noRouteTitle: 'لم يتم العثور على مسار مؤكد',
          routeToHubPrefix: 'مسار إلى أقرب محطة رئيسية',
          streetStopsTitle: 'محطات الشارع المتاحة'
        };
      case 'uk':
        return {
          mismatchTitle: 'Невідповідність поточної локації',
          currentGpsLabel: 'Поточний GPS',
          requestedOriginLabel: 'Вказана точка',
          confirmProposedBtn: 'Так, шукати з вказаної точки',
          useCurrentBtn: 'Використати мою поточну локацію',
          noRouteTitle: 'Підтверджений маршрут не знайдено',
          routeToHubPrefix: 'Маршрут до найближчого вузла',
          streetStopsTitle: 'Ключові зупинки на вулиці'
        };
      case 'en':
        return {
          mismatchTitle: 'Current Location Mismatch',
          currentGpsLabel: 'Your GPS location',
          requestedOriginLabel: 'Requested origin',
          confirmProposedBtn: 'Yes, search from the specified point',
          useCurrentBtn: 'Use my current location',
          noRouteTitle: 'No verified route found',
          routeToHubPrefix: 'Route to nearest confirmed hub',
          streetStopsTitle: 'Stops along this street'
        };
      default:
        return {
          mismatchTitle: 'Локация не совпадает с указанной точкой',
          currentGpsLabel: 'Ваша текущая GPS-локация',
          requestedOriginLabel: 'Указанная точка отправления',
          confirmProposedBtn: 'Да, искать от указанной точки',
          useCurrentBtn: 'Использовать мою текущую локацию',
          noRouteTitle: 'Подтверждённый маршрут в базе не найден',
          routeToHubPrefix: 'Маршрут до ближайшего узла',
          streetStopsTitle: 'Остановки на этой улице'
        };
    }
  });

  readonly mismatchPromptText = computed(() => {
    const state = this.busState();
    const l = this.lang();
    if (l === 'he') return state.confirmation_prompt_he || state.confirmation_prompt_en || '';
    if (l === 'en') return state.confirmation_prompt_en || state.confirmation_prompt_ru || '';
    return state.confirmation_prompt_ru || state.confirmation_prompt_en || '';
  });

  readonly routingNoticeText = computed(() => {
    const notice = this.busState().routing_notice;
    if (!notice) return '';
    const l = this.lang();
    if (l === 'he') return notice.message_he || notice.message_en;
    if (l === 'en') return notice.message_en || notice.message_ru;
    return notice.message_ru || notice.message_en;
  });

  readonly minShort = computed(() => {
    switch (this.lang()) {
      case 'he':
        return 'דק׳';
      case 'ar':
        return 'د';
      case 'uk':
        return 'хв';
      case 'en':
        return 'min';
      default:
        return 'мин';
    }
  });

  readonly detectedCityName = computed(() => {
    const c = this.userCoords();
    if (!c) return this.labels().defaultArea;
    const l = this.lang();
    if (c.lat >= 32.74 && c.lat <= 32.785 && c.lon >= 34.95 && c.lon <= 34.995) {
      if (l === 'he') return 'טירת כרמל';
      if (l === 'ar') return 'طيرة الكرمل';
      if (l === 'uk') return 'Тірат-Кармель';
      return l === 'en' ? 'Tirat Carmel' : 'Тират-Кармель';
    }
    if (c.lat >= 32.0 && c.lat <= 32.15 && c.lon >= 34.74 && c.lon <= 34.85) {
      if (l === 'he') return 'תל אביב';
      if (l === 'ar') return 'تل أبيب';
      if (l === 'uk') return 'Тель-Авів';
      return l === 'en' ? 'Tel Aviv' : 'Тель-Авив';
    }
    if (c.lat >= 31.74 && c.lat <= 31.85 && c.lon >= 35.15 && c.lon <= 35.25) {
      if (l === 'he') return 'ירושלים';
      if (l === 'ar') return 'القدس';
      if (l === 'uk') return 'Єрусалим';
      return l === 'en' ? 'Jerusalem' : 'Иерусалим';
    }
    if (l === 'he') return 'חיפה';
    if (l === 'ar') return 'حيفا';
    if (l === 'uk') return 'Хайфа';
    return l === 'en' ? 'Haifa' : 'Хайфа';
  });

  cleanPlaceName(name: string): string {
    return name.replace(/\s*\([^)]+\)\s*$/, '').trim() || name;
  }

  private resolvePersistentUserId(): string {
    const paramId = new URLSearchParams(window.location.search).get('user_id')?.trim();
    if (paramId) return paramId;

    const storageKey = 'nextbus_user_id';
    try {
      const existing = window.localStorage?.getItem(storageKey)?.trim();
      if (existing) return existing;
      const generated = `nb_u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      window.localStorage?.setItem(storageKey, generated);
      return generated;
    } catch {
      return `nb_u_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private observer: IntersectionObserver | null = null;

  private readonly onVisibilityChange = () => {
    this.isTabHidden.set(document.visibilityState === 'hidden');
  };

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const injected =
      this.initialState() ??
      window.mcpInitialState ??
      window.__NEXTBUS_STATE__ ??
      null;

    const isMcp =
      Boolean(this.initialState()) ||
      Boolean(window.mcpInitialState) ||
      injected?.entry_context === 'mcp' ||
      params.get('entry_context') === 'mcp';

    if (isMcp) {
      this.entryContext.set('mcp');
      const paramUid = params.get('user_id')?.trim() || injected?.user_id?.trim();
      if (paramUid) {
        this.userId.set(paramUid);
      }
      if (injected) {
        this.busState.set(injected);
        if (injected.destination) {
          this.originalDestination.set(injected.destination);
        }
        this.selectedDirection.set(injected.route.direction_id);
        this.selectedRouteId.set(injected.route.route_id || null);
        this.modeOverride.set(injected.render_mode);
      } else {
        this.modeOverride.set('lite');
      }
    } else {
      this.entryContext.set('standalone');
      this.userId.set(this.resolvePersistentUserId());
      if (injected) {
        this.busState.set(injected);
        if (injected.destination) {
          this.originalDestination.set(injected.destination);
        }
        this.selectedDirection.set(injected.route.direction_id);
        this.selectedRouteId.set(injected.route.route_id || null);
      }
      // Standalone web/mobile defaults to uncluttered lightweight card view with @defer map toggle
      this.modeOverride.set('lite');
    }

    const modeParam = params.get('mode');
    if (modeParam === 'lite' || modeParam === 'interactive') {
      this.modeOverride.set(modeParam);
    }
    const langParam = params.get('lang');
    if (
      langParam === 'he' ||
      langParam === 'en' ||
      langParam === 'ar' ||
      langParam === 'ru' ||
      langParam === 'uk'
    ) {
      this.hasManualLang = true;
      this.lang.set(langParam);
    }

    const latParam = params.get('lat');
    const lonParam = params.get('lon');
    if (latParam && lonParam && !Number.isNaN(Number(latParam)) && !Number.isNaN(Number(lonParam))) {
      const parsedCoords = { lat: Number(latParam), lon: Number(lonParam) };
      this.userCoords.set(parsedCoords);
      this.geoStatus.set('granted');
      this.applyLocationDefaultLang(parsedCoords);
    } else {
      this.applyLocationDefaultLang(null);
      this.requestUserGeolocation();
    }

    this.isTabHidden.set(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) {
            this.isInViewport.set(entry.isIntersecting);
          }
        },
        { threshold: 0.05 }
      );
      this.observer.observe(this.hostRef.nativeElement);
    }

    const qParam = params.get('q');
    const hasExplicitQuery =
      Boolean(params.get('line')) ||
      Boolean(params.get('dest_lat')) ||
      Boolean(qParam);

    if (qParam) {
      void this.onSearchDestination(qParam);
    } else if (isMcp || hasExplicitQuery || injected) {
      this.hasActiveSearch.set(true);
      if (params.get('line')) {
        this.activeSearchLabel.set(params.get('line') ?? '');
      } else if (params.get('dest_label')) {
        this.activeSearchLabel.set(params.get('dest_label') ?? '');
      }
      void this.fetchLatestStatus();
      this.startPolling();
    } else {
      this.hasActiveSearch.set(false);
      this.stopPolling();
      if (this.entryContext() === 'standalone') {
        this.restoreCachedSuggestions();
        if (this.userCoords() || this.geoStatus() !== 'locating') {
          void this.loadLocalSuggestions();
        } else {
          // Do not flash lines around the default point while GPS is resolving; fall back only
          // if GPS is slow. requestUserGeolocation() loads suggestions as soon as a fix arrives.
          this.geoFallbackTimer = setTimeout(() => {
            this.geoFallbackTimer = null;
            if (!this.userCoords() && !this.hasActiveSearch()) {
              void this.loadLocalSuggestions();
            }
          }, GEO_FALLBACK_DELAY_MS);
        }
      }
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.stopPolling();
    this.clearTimer('geoFallbackTimer');
    this.clearTimer('pendingEtaTimer');
  }

  private clearTimer(name: 'geoFallbackTimer' | 'pendingEtaTimer'): void {
    const t = this[name];
    if (t !== null) {
      clearTimeout(t);
      this[name] = null;
    }
  }

  startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.isPollingPaused() && this.hasActiveSearch()) {
        void this.fetchLatestStatus(false, true);
      }
    }, POLL_INTERVAL_MS);
  }

  /** Starts a new user action and invalidates every in-flight response of older ones. */
  private beginAction(): number {
    // A superseded action never reaches its own `finally` reset, so clear loaders here.
    this.isSearching.set(false);
    this.isRefreshing.set(false);
    return ++this.actionSeq;
  }

  private isCurrentAction(seq: number): boolean {
    return seq === this.actionSeq;
  }

  private restoreCachedSuggestions(): void {
    if (this.localLines().length > 0) return;
    try {
      const raw = window.localStorage?.getItem(SUGGESTIONS_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as { saved_at: number; local_lines: LocalLineSuggestion[] };
      if (!cached?.saved_at || Date.now() - cached.saved_at > SUGGESTIONS_CACHE_MAX_AGE_MS) return;
      // Lines at nearby stops are stable; ETAs are not — show them as pending until refreshed.
      this.localLines.set(
        (cached.local_lines ?? []).map((l) => ({ ...l, eta_minutes: undefined, eta_is_realtime: false }))
      );
    } catch {
      // Ignore corrupt cache
    }
  }

  private persistSuggestions(lines: LocalLineSuggestion[]): void {
    try {
      window.localStorage?.setItem(
        SUGGESTIONS_CACHE_KEY,
        JSON.stringify({ saved_at: Date.now(), local_lines: lines })
      );
    } catch {
      // Storage full or unavailable — non-critical
    }
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  resetSearch(): void {
    this.beginAction();
    this.stopPolling();
    this.hasActiveSearch.set(false);
    this.activeSearchLabel.set('');
    this.selectedRouteId.set(null);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
    this.hasExplicitDirection.set(false);
    this.confirmedExplicitOrigin.set(null);
    this.preferredDestStopId.set(null);
    this.busState.set(EMPTY_INITIAL_STATE);
    if (this.entryContext() === 'standalone') {
      void this.loadLocalSuggestions();
    }
  }

  selectLang(nextLang: WidgetLang): void {
    this.hasManualLang = true;
    this.lang.set(nextLang);
  }

  private isLocationInIsrael(lat: number, lon: number): boolean {
    return lat >= 29.45 && lat <= 33.4 && lon >= 34.2 && lon <= 35.95;
  }

  private detectDefaultLangByLocation(
    coords: { lat: number; lon: number } | null
  ): WidgetLang {
    if (coords) {
      if (this.isLocationInIsrael(coords.lat, coords.lon)) {
        return 'he';
      }
      if (coords.lat >= 44.3 && coords.lat <= 52.4 && coords.lon >= 22.1 && coords.lon <= 40.3) {
        return 'uk';
      }
      const navLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
      if (navLang.startsWith('he') || navLang.startsWith('iw')) return 'he';
      if (navLang.startsWith('ar')) return 'ar';
      if (navLang.startsWith('uk')) return 'uk';
      if (navLang.startsWith('ru')) return 'ru';
      return 'en';
    }

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz === 'Asia/Jerusalem' || tz === 'Asia/Tel_Aviv') {
        return 'he';
      }
    } catch {
      // Ignore timezone detection failure
    }

    // Default service area is Israel (DEFAULT_COORDS)
    return 'he';
  }

  private applyLocationDefaultLang(coords: { lat: number; lon: number } | null): void {
    if (this.hasManualLang) return;
    this.lang.set(this.detectDefaultLangByLocation(coords));
  }

  requestUserGeolocation(): void {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.geoStatus.set('denied');
      return;
    }

    this.geoStatus.set('locating');
    let pending = 2;
    let gotFix = false;

    const onPosition = (position: GeolocationPosition) => {
      gotFix = true;
      const detected = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy)
      };
      const previous = this.userCoords();
      // Keep the more precise fix if the coarse one happens to resolve last.
      if (previous?.accuracy !== undefined && detected.accuracy > previous.accuracy &&
          approxDistanceMeters(previous, detected) < GEO_REFINE_MIN_MOVE_METERS) {
        return;
      }
      this.userCoords.set(detected);
      this.geoStatus.set('granted');
      this.applyLocationDefaultLang(detected);
      this.clearTimer('geoFallbackTimer');

      const moved = !previous || approxDistanceMeters(previous, detected) >= GEO_REFINE_MIN_MOVE_METERS;
      if (!moved) return;

      if (this.hasActiveSearch()) {
        if (this.activeSearchLabel()) {
          void this.onSearchDestination(this.activeSearchLabel());
        } else {
          void this.fetchLatestStatus();
        }
      } else if (this.entryContext() === 'standalone') {
        void this.loadLocalSuggestions();
      }
    };

    const onError = (err: GeolocationPositionError) => {
      pending -= 1;
      if (gotFix) return;
      if (err.code === err.PERMISSION_DENIED || pending === 0) {
        this.geoStatus.set('denied');
        this.clearTimer('geoFallbackTimer');
        if (!this.hasActiveSearch() && this.entryContext() === 'standalone') {
          void this.loadLocalSuggestions();
        }
      }
    };

    // 1) Fast coarse fix (cached / network based) so the widget can render within ~0.5 s.
    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: false,
      timeout: 4000,
      maximumAge: 5 * 60 * 1000
    });
    // 2) Precise GPS fix; only triggers a re-query if it moves the user noticeably.
    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000
    });
  }

  onDirectionSwitch(directionId: 0 | 1): void {
    this.hasExplicitDirection.set(true);
    this.selectedDirection.set(directionId);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus(true);
    }
  }

  onReverseTrip(): void {
    if (!this.busState().destination && !this.originalDestination()) {
      const nextDir: 0 | 1 = this.selectedDirection() === 0 ? 1 : 0;
      this.onDirectionSwitch(nextDir);
      return;
    }

    this.isTripReversed.set(!this.isTripReversed());
    this.selectedOptionIndex.set(0);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus(true);
    }
  }

  setViewMode(nextMode: RenderMode): void {
    if (this.viewMode() === nextMode) return;
    this.modeOverride.set(nextMode);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus();
    }
  }

  toggleInteractiveMode(): void {
    const nextMode: RenderMode = this.viewMode() === 'lite' ? 'interactive' : 'lite';
    this.setViewMode(nextMode);
  }

  async loadLocalSuggestions(): Promise<void> {
    const seq = ++this.suggestionsSeq;
    this.clearTimer('pendingEtaTimer');
    this.isLoadingSuggestions.set(true);
    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const uid = this.userId().trim();
      const userParam = uid ? `&user_id=${encodeURIComponent(uid)}` : '';
      const url = `/api/local-suggestions?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}${userParam}`;
      const response = await fetch(url);
      if (response.ok && seq === this.suggestionsSeq) {
        const data = (await response.json()) as LocalSuggestionsResponse;
        if (seq !== this.suggestionsSeq) return;
        const lines = data.local_lines ?? [];
        this.returningRoutes.set(data.returning_routes ?? []);
        this.localLines.set(lines);
        this.persistSuggestions(lines);

        // The backend warms live state for these lines right now; ask again once shortly.
        if (lines.some((l) => l.eta_minutes === undefined)) {
          this.pendingEtaTimer = setTimeout(() => {
            this.pendingEtaTimer = null;
            if (!this.hasActiveSearch() && seq === this.suggestionsSeq) {
              void this.refreshPendingEtas(seq);
            }
          }, PENDING_ETA_RETRY_MS);
        }
      }
    } catch {
      // Keep current suggestions on transient error
    } finally {
      if (seq === this.suggestionsSeq) {
        this.isLoadingSuggestions.set(false);
      }
    }
  }

  /** Silent one-shot refresh: no skeleton, keeps the current list if anything fails. */
  private async refreshPendingEtas(seq: number): Promise<void> {
    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const uid = this.userId().trim();
      const userParam = uid ? `&user_id=${encodeURIComponent(uid)}` : '';
      const response = await fetch(
        `/api/local-suggestions?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}${userParam}`
      );
      if (!response.ok || seq !== this.suggestionsSeq || this.hasActiveSearch()) return;
      const data = (await response.json()) as LocalSuggestionsResponse;
      if (seq !== this.suggestionsSeq || this.hasActiveSearch()) return;
      this.returningRoutes.set(data.returning_routes ?? []);
      this.localLines.set(data.local_lines ?? []);
      this.persistSuggestions(data.local_lines ?? []);
    } catch {
      // Non-critical
    }
  }

  async onSelectLocalLine(line: LocalLineSuggestion): Promise<void> {
    const seq = this.beginAction();
    this.isSearching.set(true);
    this.hasActiveSearch.set(true);
    this.selectedRouteId.set(line.route_id);
    this.selectedDirection.set(line.direction_id);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
    this.hasExplicitDirection.set(true);
    this.activeSearchLabel.set(line.line_number);

    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: line.line_number,
          user_location: { lat: coords.lat, lon: coords.lon },
          user_id: this.userId() || undefined,
          route_id: line.route_id,
          direction_id: line.direction_id,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        this.busState.set(data);
        this.startPolling();
        void this.loadLocalSuggestions();
      }
    } catch {
      // Keep state on transient error
    } finally {
      if (this.isCurrentAction(seq)) {
        this.isSearching.set(false);
      }
    }
  }

  onSelectReturningRoute(item: ReturningRouteSuggestion): void {
    if (
      item.route_id &&
      item.line_number &&
      (item.dest_lat === null || item.dest_lat === undefined)
    ) {
      void this.onSelectLocalLine({
        route_id: item.route_id,
        line_number: item.line_number,
        route_long_name: item.dest_label || item.line_number,
        direction_id: item.direction_id === 1 ? 1 : 0,
        nearest_stop_id: item.origin_stop_id ?? '',
        nearest_stop_code: '',
        nearest_stop_name: item.origin_stop_name ?? '',
        nearest_stop_name_he: item.origin_stop_name ?? '',
        nearest_stop_sequence: 1,
        stop_lat: item.origin_lat,
        stop_lon: item.origin_lon,
        distance_meters: item.distance_meters,
        destination_name: item.dest_label || item.line_number,
        destination_he: item.dest_label || item.line_number,
        eta_minutes: item.eta_minutes ?? 5
      });
      return;
    }

    const q = item.dest_label?.trim() || item.line_number?.trim();
    if (q) {
      void this.onSearchDestination(q);
    }
  }

  async onSelectCandidate(candidate: LineCandidate): Promise<void> {
    const seq = this.beginAction();
    this.isSearching.set(true);
    this.selectedRouteId.set(candidate.route_id);
    this.selectedDirection.set(candidate.direction_id);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
    this.hasExplicitDirection.set(true);
    this.activeSearchLabel.set(candidate.line_number);

    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const existingCandidates = this.busState().candidates;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: candidate.line_number,
          user_location: { lat: coords.lat, lon: coords.lon },
          user_id: this.userId() || undefined,
          route_id: candidate.route_id,
          direction_id: candidate.direction_id,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        this.busState.set({
          ...data,
          candidates: existingCandidates ?? data.candidates
        });
        this.startPolling();
        if (this.entryContext() === 'standalone') {
          void this.loadLocalSuggestions();
        }
      }
    } catch {
      // Keep current state on temporary failure
    } finally {
      if (this.isCurrentAction(seq)) {
        this.isSearching.set(false);
      }
    }
  }

  async onSearchDestination(query: string): Promise<void> {
    const cleaned = query.trim();
    if (!cleaned) return;

    const seq = this.beginAction();
    this.isSearching.set(true);
    this.hasActiveSearch.set(true);
    this.activeSearchLabel.set(cleaned);
    this.hasExplicitDirection.set(false);
    this.selectedRouteId.set(null);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
    this.confirmedExplicitOrigin.set(null);
    this.preferredDestStopId.set(null);

    try {
      let coords = this.userCoords();
      if (!coords && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        coords = await new Promise<{ lat: number; lon: number; accuracy?: number } | null>(
          (resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const c = {
                  lat: pos.coords.latitude,
                  lon: pos.coords.longitude,
                  accuracy: Math.round(pos.coords.accuracy)
                };
                this.userCoords.set(c);
                this.geoStatus.set('granted');
                this.applyLocationDefaultLang(c);
                resolve(c);
              },
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 2000 }
            );
          }
        );
      }

      const finalCoords = coords ?? this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cleaned,
          user_location: { lat: finalCoords.lat, lon: finalCoords.lon },
          user_id: this.userId() || undefined,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        this.busState.set(data);
        if (data.destination) {
          this.originalDestination.set(data.destination);
        }
        this.selectedRouteId.set(data.route.route_id || null);
        this.selectedDirection.set(data.route.direction_id);
        if (data.requires_confirmation || data.no_verified_route) {
          this.stopPolling();
        } else {
          this.startPolling();
        }
        if (this.entryContext() === 'standalone' && !data.requires_confirmation) {
          void this.loadLocalSuggestions();
        }
      }
    } catch {
      // Keep current state on temporary failure
    } finally {
      if (this.isCurrentAction(seq)) {
        this.isSearching.set(false);
      }
    }
  }

  async confirmLocationMismatch(): Promise<void> {
    const prop = this.busState().proposed_origin;
    if (!prop) return;

    const retryQuery =
      prop.original_query ||
      this.activeSearchLabel() ||
      (prop.line_number ? `bus ${prop.line_number}` : prop.destination_query || prop.label);

    this.confirmedExplicitOrigin.set({
      lat: prop.lat,
      lon: prop.lon,
      label: prop.label,
      stop_id: prop.stop_id
    });
    const seq = this.beginAction();
    this.isSearching.set(true);

    try {
      const gpsCoords = this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: retryQuery,
          user_location: { lat: gpsCoords.lat, lon: gpsCoords.lon },
          user_id: this.userId() || undefined,
          ignore_user_location: true,
          explicit_origin: {
            lat: prop.lat,
            lon: prop.lon,
            label: prop.label,
            stop_id: prop.stop_id
          },
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        this.busState.set(data);
        if (data.destination) {
          this.originalDestination.set(data.destination);
        }
        this.selectedRouteId.set(data.route.route_id || null);
        this.selectedDirection.set(data.route.direction_id);
        this.startPolling();
      }
    } catch {
      // Keep confirmation card if network failed
    } finally {
      if (this.isCurrentAction(seq)) {
        this.isSearching.set(false);
      }
    }
  }

  async useCurrentLocationInstead(): Promise<void> {
    const prop = this.busState().proposed_origin;
    this.confirmedExplicitOrigin.set(null);

    const targetQuery =
      prop?.destination_query?.trim() ||
      prop?.line_number?.trim() ||
      this.activeSearchLabel();

    if (!targetQuery) {
      this.resetSearch();
      return;
    }

    const seq = this.beginAction();
    this.isSearching.set(true);
    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: targetQuery,
          user_location: { lat: coords.lat, lon: coords.lon },
          user_id: this.userId() || undefined,
          ignore_user_location: true,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        this.busState.set(data);
        if (data.destination) {
          this.originalDestination.set(data.destination);
        }
        this.selectedRouteId.set(data.route.route_id || null);
        this.selectedDirection.set(data.route.direction_id);
        if (!data.requires_confirmation && !data.no_verified_route) {
          this.startPolling();
        }
      }
    } catch {
      // Ignore transient error
    } finally {
      if (this.isCurrentAction(seq)) {
        this.isSearching.set(false);
      }
    }
  }

  async onSelectStreetStop(stop: ResolvedStopOption): Promise<void> {
    const dest = this.busState().destination;
    if (!dest) return;
    this.preferredDestStopId.set(stop.stop_id);
    this.selectedOptionIndex.set(0);
    const updatedDest: GeocodedDestination = {
      ...dest,
      lat: stop.lat,
      lon: stop.lon,
      place_name: stop.stop_name_he || stop.stop_name,
      resolved_stop: stop
    };
    this.originalDestination.set(updatedDest);
    await this.fetchLatestStatus(true);
  }

  async planToConfirmedHub(hub: UserStopInfo): Promise<void> {
    const label = hub.stop_name_he || hub.stop_name;
    this.preferredDestStopId.set(hub.stop_id);
    this.originalDestination.set({
      lat: hub.lat,
      lon: hub.lon,
      place_name: label,
      formatted_address: label,
      source: 'gtfs_db',
      destination_granularity: 'poi',
      resolved_stop: {
        stop_id: hub.stop_id,
        stop_code: hub.stop_code,
        stop_name: hub.stop_name,
        stop_name_he: hub.stop_name_he,
        lat: hub.lat,
        lon: hub.lon
      }
    });
    this.selectedOptionIndex.set(0);
    this.startPolling();
    await this.fetchLatestStatus(true);
  }

  private async fetchLatestStatus(bootstrapLine = false, fromPoll = false): Promise<void> {
    if (!this.hasActiveSearch()) return;
    if (this.busState().requires_confirmation) return;

    // Polls never overlap each other and never race a user action that is still loading.
    if (fromPoll && (this.pollInFlight || this.isSearching() || this.isRefreshing())) return;
    const seq = fromPoll ? this.actionSeq : this.beginAction();
    if (fromPoll) {
      this.pollInFlight = true;
    } else if (this.busState() !== EMPTY_INITIAL_STATE) {
      this.isRefreshing.set(true);
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const coords = this.confirmedExplicitOrigin() ?? this.userCoords() ?? DEFAULT_COORDS;
      const current = this.busState();

      const urlDestLat = params.get('dest_lat');
      const urlDestLon = params.get('dest_lon');
      const urlDestLabel = params.get('dest_label');

      const origDest = this.originalDestination() ?? current.destination;
      const destLat =
        origDest?.lat ??
        (urlDestLat && !Number.isNaN(Number(urlDestLat)) ? Number(urlDestLat) : undefined);
      const destLon =
        origDest?.lon ??
        (urlDestLon && !Number.isNaN(Number(urlDestLon)) ? Number(urlDestLon) : undefined);

      const uid = this.userId().trim();
      const userParam = uid ? `&user_id=${encodeURIComponent(uid)}` : '';

      if (destLat !== undefined && destLon !== undefined) {
        const destLabel = origDest?.place_name ?? urlDestLabel ?? 'Destination';
        const reversed = this.isTripReversed();
        const fromLat = reversed ? destLat : coords.lat;
        const fromLon = reversed ? destLon : coords.lon;
        const toLat = reversed ? coords.lat : destLat;
        const toLon = reversed ? coords.lon : destLon;
        const toLabel = reversed ? this.detectedCityName() : destLabel;

        const routeIds = reversed
          ? ''
          : (current.recommended_options ?? []).map((opt) => opt.route.route_id).join(',');
        const routeIdsParam = routeIds ? `&route_ids=${encodeURIComponent(routeIds)}` : '';
        const prefStopParam =
          !reversed && this.preferredDestStopId()
            ? `&preferred_dest_stop_id=${encodeURIComponent(this.preferredDestStopId()!)}`
            : '';
        const bootstrapParam = !current.destination || bootstrapLine ? '&bootstrap=true' : '';

        const tripUrl = `/api/live-status?lat=${encodeURIComponent(
          fromLat
        )}&lon=${encodeURIComponent(fromLon)}&dest_lat=${encodeURIComponent(
          toLat
        )}&dest_lon=${encodeURIComponent(toLon)}&dest_label=${encodeURIComponent(
          toLabel
        )}&entry_context=${encodeURIComponent(this.entryContext())}${userParam}${routeIdsParam}${prefStopParam}${bootstrapParam}`;

        const response = await fetch(tripUrl);
        if (!response.ok) return;
        const data = (await response.json()) as LiveBusStatusResponse;
        if (!this.isCurrentAction(seq)) return;
        // Preserve street granularity & alternative street stops across live polling refreshes
        if (!reversed && origDest?.alternative_street_stops?.length) {
          data.destination = {
            ...(data.destination ?? origDest),
            destination_granularity: origDest.destination_granularity,
            resolved_stop: origDest.resolved_stop,
            alternative_street_stops: origDest.alternative_street_stops
          };
        }
        this.busState.set(data);
        if (!reversed && data.destination && !this.originalDestination()) {
          this.originalDestination.set(data.destination);
        }
        return;
      }

      const line = params.get('line') ?? current.route.short_name;
      if (!line) return;

      const includeNearby = this.viewMode() === 'interactive';
      const dirParam = this.hasExplicitDirection()
        ? `&direction_id=${this.selectedDirection()}`
        : '';
      const routeId = this.selectedRouteId() ?? current.route.route_id;
      const routeParam = routeId ? `&route_id=${encodeURIComponent(routeId)}` : '';
      const bootstrapParam = bootstrapLine ? '&bootstrap=true' : '';

      const url = `/api/live-status?line_number=${encodeURIComponent(
        line
      )}&lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(
        coords.lon
      )}${dirParam}${routeParam}&include_nearby_places=${includeNearby}&entry_context=${encodeURIComponent(
        this.entryContext()
      )}${userParam}${bootstrapParam}`;

      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as LiveBusStatusResponse;
      if (!this.isCurrentAction(seq)) return;
      this.busState.set({
        ...data,
        candidates: current.candidates ?? data.candidates
      });
      if (!this.hasExplicitDirection()) {
        this.selectedDirection.set(data.route.direction_id);
      }
    } catch {
      // Keep current signal snapshot if network temporarily fails
    } finally {
      if (fromPoll) {
        this.pollInFlight = false;
      } else if (this.isCurrentAction(seq)) {
        this.isRefreshing.set(false);
      }
    }
  }
}

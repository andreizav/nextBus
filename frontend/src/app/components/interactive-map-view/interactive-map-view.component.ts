import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  computed,
  effect,
  input,
  output,
  viewChild
} from '@angular/core';
import * as L from 'leaflet';
import type {
  LiveBusStatusResponse,
  RecommendedBusOption,
  TripLeg,
  TripOption,
  WidgetLang
} from '../../models/bus.models';

@Component({
  selector: 'nb-interactive-map-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../../node_modules/leaflet/dist/leaflet.css'],
  template: `
    <section
      class="nb-map-card"
      [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'"
      aria-label="Minimalist live map and route variants"
    >
      <!-- 1. Redesigned Unified Route & Arrival Hero Card -->
      <header class="nb-map-hero">
        <div class="nb-hero-route-group">
          <div class="nb-hero-line-badge" [class.is-compact]="heroRouteDisplay().length > 4">
            <span aria-hidden="true">🚌</span>
            <span>{{ heroRouteDisplay() }}</span>
          </div>
          <div class="nb-hero-route-meta">
            <span class="nb-map-metric-caption">{{ labels().busRoute }}</span>
            @if (activeBus()) {
              <div
                class="nb-map-freshness-pill"
                [class.is-realtime]="!isScheduledEta()"
                [class.is-scheduled]="isScheduledEta()"
              >
                <span class="nb-map-eta-dot" aria-hidden="true"></span>
                <span>{{ etaStatusText() }}</span>
              </div>
            }
          </div>
        </div>

        <div class="nb-hero-eta-box" role="status" aria-live="polite">
          <div class="nb-map-metric-main">
            <span>{{ etaDigits() }}</span>
            @if (etaUnit()) {
              <span class="nb-map-metric-unit">{{ etaUnit() }}</span>
            }
          </div>
          <div class="nb-map-metric-caption">{{ labels().arrivalCountdown }}</div>
        </div>
      </header>

      <!-- 2. Clear Route Start & End Endpoints Card (Street / City) with Reverse Button -->
      @if (state().destination || activeDisplayRoute().available_directions.length > 1 || (activeOption()?.timeline_stops ?? state().timeline_stops).length > 1) {
        <div class="nb-map-dir-bar">
          <div class="nb-dir-endpoints">
            <div class="nb-dir-point-row">
              <span class="nb-dir-point-tag is-start">{{ labels().fromWord }}</span>
              <span class="nb-dir-point-text" dir="auto">{{ directionStartText() }}</span>
            </div>
            <div class="nb-dir-point-row">
              <span class="nb-dir-point-tag is-end">{{ labels().toWord }}</span>
              <span class="nb-dir-point-text" dir="auto">{{ directionEndText() }}</span>
            </div>
          </div>
          <button
            type="button"
            class="nb-map-dir-btn"
            (click)="state().destination ? reverseTrip.emit() : onSwitchDirection()"
            [title]="state().destination ? labels().reverseRoute : labels().switchDir"
            [attr.aria-label]="state().destination ? labels().reverseRoute : labels().switchDir"
          >
            <span aria-hidden="true">⇄</span>
            <span>{{ state().destination ? labels().reverseRoute : labels().switchDir }}</span>
          </button>
        </div>
      }

      <!-- 3. Multi-Stop Trip Variant Switcher (Option 1 / 2 / 3 with stop & walking distance) -->
      @if (state().destination && recommendedOptions().length > 1) {
        <div class="nb-map-variants" role="tablist" [attr.aria-label]="labels().variantsAria">
          @for (opt of recommendedOptions(); track opt.route.route_id + '-' + opt.origin_stop.stop_id + '-' + $index; let idx = $index) {
            <button
              type="button"
              role="tab"
              class="nb-map-var-tab"
              [class.is-active]="clampedOptionIndex() === idx"
              [attr.aria-selected]="clampedOptionIndex() === idx"
              (click)="selectOptionIndex.emit(idx)"
            >
              <div class="nb-map-var-top">
                <span class="nb-map-var-rank">{{ labels().optionWord }} {{ opt.rank }}</span>
                <span class="nb-map-var-route">🚌 {{ formatOptionRoute(opt) }}</span>
                <span class="nb-map-var-time">{{ opt.total_arrival_min }} {{ labels().minShort }}</span>
              </div>
              <div class="nb-map-var-bottom" dir="auto">
                <span class="nb-map-var-stop">
                  📍 {{ cleanStopName(lang() === 'he' ? opt.origin_stop.stop_name_he : opt.origin_stop.stop_name) }}
                </span>
                @if (opt.origin_stop.distance_meters !== undefined) {
                  <span class="nb-map-var-walk">• 🚶 {{ opt.origin_stop.distance_meters }} m</span>
                }
              </div>
            </button>
          }
        </div>
      }

      <!-- 4. Minimalist Dark-Slate Map Viewport -->
      <div class="nb-map-viewport">
        <div #mapContainer class="nb-leaflet-host" aria-label="OpenStreetMap interactive map"></div>

        <div class="nb-map-fab-stack">
          <button
            type="button"
            class="nb-map-fab"
            (click)="zoomToUserLocation()"
            [title]="labels().myLocation"
            [attr.aria-label]="labels().myLocation"
          >
            📍
          </button>
          <button
            type="button"
            class="nb-map-fab"
            (click)="recenterMap()"
            [title]="labels().recenter"
            [attr.aria-label]="labels().recenter"
          >
            🎯
          </button>
        </div>

        <div class="nb-map-hud">
          <span class="nb-hud-stop" dir="auto">
            <span class="nb-hud-pin" aria-hidden="true">📍</span>
            <strong>
              {{
                cleanStopName(
                  lang() === 'he' ? activeOriginStop().stop_name_he : activeOriginStop().stop_name
                )
              }}
            </strong>
            @if (activeOriginStop().distance_meters !== undefined) {
              <span class="nb-hud-muted">• 🚶 {{ activeOriginStop().distance_meters }} m</span>
            }
          </span>
          <span class="nb-hud-away">{{ stopsAwayText() }}</span>
        </div>
      </div>

      <!-- 5. Step-by-Step Transfer & Itinerary Card -->
      @if (activeTripOption(); as trip) {
        @if (trip.transfers_count > 0 || state().destination) {
          <div class="nb-map-trip-strip">
            <div class="nb-map-trip-row">
              <span class="nb-map-dest-label">🏁 {{ state().destination?.place_name }}</span>
              <span class="nb-map-dest-eta">
                {{ trip.estimated_arrival_time }}
                @if (trip.total_duration_min) {
                  • {{ trip.total_duration_min }} {{ labels().minShort }}
                }
              </span>
            </div>

            @if (trip.transfers_count > 0) {
              <ol class="nb-map-xfer-list">
                @for (leg of trip.legs; track leg.route_id + '-' + $index; let legIdx = $index) {
                  <li class="nb-map-xfer-card" [class.is-xfer]="leg.leg_type === 'TRANSFER'">
                    <div class="nb-map-xfer-header">
                      <span class="nb-map-xfer-step">{{ legIdx + 1 }}</span>
                      <span class="nb-map-xfer-badge">
                        {{ leg.leg_type === 'TRANSFER' ? '🔄' : '🚌' }} {{ leg.line_number }}
                      </span>
                      <span class="nb-map-xfer-time">
                        {{ leg.ride_duration_min }} {{ labels().minShort }}
                        @if (leg.alight_stop.stops_count) {
                          ({{ leg.alight_stop.stops_count }} {{ labels().stopsCountWord }})
                        }
                      </span>
                    </div>

                    <div class="nb-map-xfer-route-flow">
                      <div class="nb-flow-stop is-board" dir="auto">
                        <span class="nb-flow-marker">📍</span>
                        <span class="nb-flow-label">{{ labels().boardWord }}:</span>
                        <strong class="nb-flow-name">{{ cleanStopName(lang() === 'he' ? leg.board_stop.stop_name_he : leg.board_stop.stop_name) }}</strong>
                      </div>
                      <div class="nb-flow-stop is-alight" dir="auto">
                        <span class="nb-flow-marker">⬇️</span>
                        <span class="nb-flow-label">{{ labels().alightWord }}:</span>
                        <strong class="nb-flow-name">{{ cleanStopName(lang() === 'he' ? leg.alight_stop.stop_name_he : leg.alight_stop.stop_name) }}</strong>
                      </div>
                    </div>

                    @if (leg.leg_type === 'TRANSFER' && (leg.transfer_wait_min !== undefined || leg.transfer_walk_meters !== undefined)) {
                      <div class="nb-map-xfer-wait-bar" dir="auto">
                        @if (leg.transfer_wait_min !== undefined) {
                          <span>⏳ {{ labels().waitWord }} ~{{ leg.transfer_wait_min }} {{ labels().minShort }}</span>
                        }
                        @if (leg.transfer_walk_meters !== undefined && leg.transfer_walk_meters > 0) {
                          <span>• 🚶 {{ leg.transfer_walk_meters }} m</span>
                        }
                      </div>
                    }
                  </li>
                }
              </ol>
            }
          </div>
        }
      } @else if (state().destination && !activeOption()) {
        <div class="nb-map-trip-strip">
          <div class="nb-map-trip-row">
            <span class="nb-map-dest-label">🚆 {{ state().destination?.place_name }}</span>
          </div>
          <p class="nb-map-intercity-msg">{{ labels().intercityAdvice }}</p>
        </div>
      }

      <!-- 6. Cafes Nearby (populated by backend only if waiting > 10 minutes) -->
      @if (state().nearby_offers.length > 0) {
        <div class="nb-map-offers">
          <div class="nb-map-offers-head">
            <span>☕ {{ labels().offersTitle }} ({{ state().nearby_offers.length }})</span>
          </div>
          <div class="nb-map-offers-grid">
            @for (offer of state().nearby_offers; track offer.id) {
              <article class="nb-map-offer-card">
                <div class="nb-map-offer-top">
                  <strong class="nb-map-offer-name">
                    {{ lang() === 'he' ? offer.name_he : offer.name }}
                  </strong>
                  <span class="nb-map-offer-dist">
                    {{ offer.walk_minutes }} {{ labels().minShort }} • {{ offer.distance_meters }} m
                  </span>
                </div>
                <p class="nb-map-offer-promo">{{ offer.promo }}</p>
                @if (offer.maps_url) {
                  <a
                    class="nb-map-offer-link"
                    [href]="offer.maps_url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ labels().openMaps }} ↗
                  </a>
                }
              </article>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .nb-map-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.95rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        color: #f8fafc;
      }

      /* 1. Unified Hero Summary Card (identical to Lite View) */
      .nb-map-hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        padding: 0.72rem 0.88rem;
        border-radius: 1.15rem;
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 34, 0.88));
        border: 1px solid rgba(96, 165, 250, 0.24);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      .nb-hero-route-group {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex: 1 1 auto;
        min-inline-size: 0;
      }

      .nb-hero-line-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.35rem;
        padding: 0.45rem 0.78rem;
        border-radius: 0.88rem;
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: #ffffff;
        font-size: clamp(1.35rem, 5.5vw, 1.85rem);
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.02em;
        white-space: nowrap;
        flex-shrink: 0;
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.38);
      }

      .nb-hero-line-badge.is-compact {
        font-size: clamp(1rem, 4.2vw, 1.3rem);
        padding: 0.45rem 0.6rem;
      }

      .nb-hero-route-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
        min-inline-size: 0;
      }

      .nb-hero-eta-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.16rem;
        min-inline-size: 92px;
        padding: 0.48rem 0.78rem;
        border-radius: 0.95rem;
        background: rgba(12, 18, 28, 0.78);
        border: 1px solid rgba(255, 255, 255, 0.12);
        text-align: center;
        flex-shrink: 0;
      }

      .nb-map-metric-main {
        display: inline-flex;
        align-items: baseline;
        justify-content: center;
        color: #ffffff;
        font-size: clamp(1.55rem, 6.2vw, 2.05rem);
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.03em;
        white-space: nowrap;
      }

      .nb-map-metric-unit {
        font-size: clamp(0.78rem, 3vw, 0.96rem);
        font-weight: 700;
        margin-inline-start: 0.2rem;
        color: #93c5fd;
        letter-spacing: 0.02em;
      }

      .nb-map-metric-caption {
        font-size: 0.72rem;
        color: #94a3b8;
        font-weight: 500;
        max-inline-size: 100%;
        white-space: nowrap;
      }

      .nb-map-freshness-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.3rem;
        padding: 0.14rem 0.52rem;
        border-radius: 999px;
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        max-inline-size: 100%;
        white-space: nowrap;
      }

      .nb-map-freshness-pill.is-realtime {
        background: rgba(34, 197, 94, 0.14);
        color: #86efac;
        border: 1px solid rgba(34, 197, 94, 0.35);
      }

      .nb-map-freshness-pill.is-scheduled {
        background: rgba(245, 158, 11, 0.14);
        color: #fde68a;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }

      .nb-map-eta-dot {
        inline-size: 6px;
        block-size: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        background: currentColor;
      }

      /* 2. Clear Route Start / End Card */
      .nb-map-dir-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.55rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 0.95rem;
        padding: 0.55rem 0.72rem;
      }

      .nb-dir-endpoints {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.28rem;
        flex: 1 1 180px;
        min-inline-size: 0;
      }

      .nb-dir-point-row {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .nb-dir-point-tag {
        font-size: 0.66rem;
        font-weight: 700;
        padding: 0.08rem 0.42rem;
        border-radius: 999px;
        flex-shrink: 0;
        letter-spacing: 0.02em;
      }

      .nb-dir-point-tag.is-start {
        background: rgba(59, 130, 246, 0.18);
        color: #93c5fd;
        border: 1px solid rgba(59, 130, 246, 0.35);
      }

      .nb-dir-point-tag.is-end {
        background: rgba(16, 185, 129, 0.16);
        color: #6ee7b7;
        border: 1px solid rgba(16, 185, 129, 0.35);
      }

      .nb-dir-point-text {
        font-size: 0.78rem;
        font-weight: 600;
        color: #e2e8f0;
        line-height: 1.25;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .nb-map-dir-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
        max-inline-size: 100%;
        white-space: nowrap;
        background: rgba(48, 135, 246, 0.16);
        color: #93c5fd;
        border: 1px solid rgba(59, 130, 246, 0.45);
        border-radius: 999px;
        padding: 0.28rem 0.62rem;
        font-size: 0.72rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .nb-map-dir-btn:hover {
        background: #3087f6;
        border-color: #3087f6;
        color: #ffffff;
      }

      /* 3. Multi-Stop Trip Variants (Option 1 / 2 / 3) */
      .nb-map-variants {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.4rem;
      }

      .nb-map-var-tab {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.22rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-align: start;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 0.85rem;
        padding: 0.48rem 0.72rem;
        color: #cbd5e1;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .nb-map-var-tab:hover {
        border-color: rgba(59, 130, 246, 0.55);
        background: rgba(48, 135, 246, 0.1);
      }

      .nb-map-var-tab.is-active {
        background: rgba(48, 135, 246, 0.2);
        border-color: #3087f6;
        color: #ffffff;
        box-shadow: 0 0 0 1px rgba(48, 135, 246, 0.25);
      }

      .nb-map-var-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
        min-inline-size: 0;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .nb-map-var-rank {
        color: #93c5fd;
      }

      .nb-map-var-tab.is-active .nb-map-var-rank {
        color: #ffffff;
      }

      .nb-map-var-route {
        background: rgba(255, 255, 255, 0.08);
        padding: 0.08rem 0.45rem;
        border-radius: 999px;
        font-size: 0.73rem;
      }

      .nb-map-var-tab.is-active .nb-map-var-route {
        background: #3087f6;
        color: #ffffff;
      }

      .nb-map-var-time {
        color: #7dd3fc;
        font-weight: 700;
        margin-inline-start: auto;
      }

      .nb-map-var-bottom {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        font-size: 0.72rem;
        color: #9aa6b4;
      }

      .nb-map-var-tab.is-active .nb-map-var-bottom {
        color: #dbeafe;
      }

      .nb-map-var-stop {
        flex: 1 1 auto;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nb-map-var-walk {
        color: #93c5fd;
        flex-shrink: 0;
      }

      /* 4. Map Viewport */
      .nb-map-viewport {
        position: relative;
        overflow: hidden;
        border-radius: 1.15rem;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: #171d24;
        inline-size: 100%;
        min-inline-size: 0;
      }

      .nb-leaflet-host {
        inline-size: 100%;
        block-size: 295px;
        z-index: 1;
      }

      .nb-map-fab-stack {
        position: absolute;
        top: 0.65rem;
        right: 0.65rem;
        left: auto;
        z-index: 450;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .nb-map-fab {
        display: grid;
        place-items: center;
        inline-size: 2.2rem;
        block-size: 2.2rem;
        border-radius: 999px;
        background: rgba(29, 35, 43, 0.92);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.22);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.42);
        font-size: 0.96rem;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .nb-map-fab:hover {
        background: #3087f6;
        border-color: #3087f6;
      }

      .leaflet-marker-icon.nb-smooth-marker {
        transition: transform 1.2s ease-out;
      }

      .nb-pin-emoji {
        display: grid;
        place-items: center;
        inline-size: 30px;
        block-size: 30px;
        border-radius: 999px;
        font-size: 15px;
        border: 2px solid #f8fafc;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      }

      .nb-pin-user {
        background: #3087f6;
        color: #ffffff;
        box-shadow: 0 0 0 5px rgba(59, 130, 246, 0.28), 0 3px 10px rgba(0, 0, 0, 0.5);
      }

      .nb-pin-gps {
        inline-size: 18px;
        block-size: 18px;
        border-radius: 999px;
        background: #2563eb;
        border: 3px solid #ffffff;
        box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.35), 0 2px 8px rgba(0, 0, 0, 0.45);
        animation: nb-gps-pulse 2s infinite ease-in-out;
      }

      @keyframes nb-gps-pulse {
        0%, 100% {
          box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.35), 0 2px 8px rgba(0, 0, 0, 0.45);
        }
        50% {
          box-shadow: 0 0 0 11px rgba(37, 99, 235, 0.14), 0 2px 8px rgba(0, 0, 0, 0.45);
        }
      }

      .nb-pin-board {
        background: #10b981;
        color: #ffffff;
        box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.28), 0 3px 10px rgba(0, 0, 0, 0.5);
      }

      .nb-pin-dest {
        background: #ef4444;
        color: #ffffff;
      }

      .nb-pin-xfer {
        background: #f59e0b;
        color: #041322;
      }

      .nb-pin-bus-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding-block: 3px;
        padding-inline: 8px;
        border-radius: 999px;
        color: #ffffff;
        font-weight: 800;
        font-size: 12px;
        border: 2px solid #ffffff;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.55);
        white-space: nowrap;
      }

      .nb-smooth-marker {
        transition: transform 0.85s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: transform;
      }

      .leaflet-zoom-anim .nb-smooth-marker {
        transition: none;
      }

      .nb-pin-bus-pill.is-primary {
        transform: scale(1.06);
        box-shadow: 0 0 0 4px rgba(48, 135, 246, 0.35), 0 4px 12px rgba(0, 0, 0, 0.6);
      }

      .nb-pin-bus-pill.is-secondary {
        color: #041322;
      }

      .nb-pin-cafe {
        background: #1f262e;
        color: #93c5fd;
        border-color: #60a5fa;
      }

      .nb-map-hud {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.45rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        padding-block: 0.52rem;
        padding-inline: 0.78rem;
        background: rgba(15, 23, 34, 0.78);
        border-block-start: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 0.76rem;
        color: #e2e8f0;
      }

      .nb-hud-stop {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        flex: 1 1 160px;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        white-space: nowrap;
      }

      .nb-hud-stop::-webkit-scrollbar {
        display: none;
      }

      .nb-hud-pin,
      .nb-hud-muted {
        flex-shrink: 0;
      }

      .nb-hud-stop strong {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .nb-hud-muted {
        color: #93c5fd;
        font-weight: 600;
      }

      .nb-hud-away {
        color: #9aa6b4;
        font-weight: 500;
      }

      /* 5. Compact Transfer / Destination Strip */
      .nb-map-trip-strip {
        background: rgba(15, 23, 34, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.85rem;
        padding: 0.55rem 0.75rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        gap: 0.4rem;
      }

      .nb-map-trip-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.45rem;
        min-inline-size: 0;
        font-size: 0.8rem;
        font-weight: 600;
        color: #e2e8f0;
      }

      .nb-map-dest-eta {
        color: #60a5fa;
        font-weight: 700;
        flex-shrink: 0;
      }

      .nb-map-xfer-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0.45rem;
      }

      .nb-map-xfer-card {
        background: rgba(30, 41, 59, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 0.65rem;
        padding: 0.42rem 0.55rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.35rem;
        min-inline-size: 0;
      }

      .nb-map-xfer-card.is-xfer {
        border-color: rgba(245, 158, 11, 0.25);
      }

      .nb-map-xfer-header {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        min-inline-size: 0;
      }

      .nb-map-xfer-step {
        background: #334155;
        color: #f8fafc;
        border-radius: 50%;
        width: 1.25rem;
        height: 1.25rem;
        font-size: 0.68rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .nb-map-xfer-badge {
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
        border-radius: 0.38rem;
        padding: 0.08rem 0.4rem;
        font-size: 0.78rem;
        font-weight: 700;
        flex-shrink: 0;
      }

      .nb-map-xfer-card.is-xfer .nb-map-xfer-badge {
        background: rgba(245, 158, 11, 0.2);
        color: #fcd34d;
      }

      .nb-map-xfer-time {
        font-size: 0.72rem;
        color: #94a3b8;
        font-weight: 500;
        margin-inline-start: auto;
      }

      .nb-map-xfer-route-flow {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.2rem;
        font-size: 0.74rem;
        color: #cbd5e1;
      }

      .nb-flow-stop {
        display: flex;
        align-items: baseline;
        gap: 0.32rem;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .nb-flow-marker {
        font-size: 0.8rem;
        flex-shrink: 0;
      }

      .nb-flow-label {
        font-size: 0.68rem;
        color: #94a3b8;
        flex-shrink: 0;
      }

      .nb-flow-name {
        color: #f1f5f9;
        font-weight: 600;
      }

      .nb-map-xfer-wait-bar {
        font-size: 0.7rem;
        color: #fbbf24;
        background: rgba(245, 158, 11, 0.1);
        border-radius: 0.35rem;
        padding: 0.15rem 0.4rem;
        display: flex;
        gap: 0.35rem;
        align-items: center;
      }

      .nb-map-intercity-msg {
        margin: 0;
        font-size: 0.78rem;
        line-height: 1.45;
        color: #cbd5e1;
        overflow-wrap: anywhere;
      }

      /* 6. Cafes Nearby */
      .nb-map-offers {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.48rem;
      }

      .nb-map-offers-head {
        font-size: 0.8rem;
        font-weight: 700;
        color: #cbd5e1;
      }

      .nb-map-offers-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0.45rem;
      }

      .nb-map-offer-card {
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 0.85rem;
        padding: 0.55rem 0.72rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        gap: 0.25rem;
      }

      .nb-map-offer-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .nb-map-offer-name {
        font-size: 0.82rem;
        color: #f8fafc;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .nb-map-offer-dist {
        font-size: 0.73rem;
        color: #93c5fd;
        font-weight: 600;
        flex-shrink: 0;
      }

      .nb-map-offer-promo {
        margin: 0;
        font-size: 0.75rem;
        color: #9aa6b4;
        overflow-wrap: anywhere;
      }

      .nb-map-offer-link {
        font-size: 0.74rem;
        font-weight: 600;
        color: #60a5fa;
        text-decoration: none;
      }

      .nb-map-offer-link:hover {
        text-decoration: underline;
      }
    `
  ]
})
export class InteractiveMapViewComponent implements AfterViewInit, OnDestroy {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('he');
  readonly selectedOptionIndex = input<number>(0);
  readonly isTripReversed = input<boolean>(false);
  readonly originLabel = input<string>('');
  readonly targetLabel = input<string>('');

  readonly selectOptionIndex = output<number>();
  readonly switchDirection = output<0 | 1>();
  readonly reverseTrip = output<void>();

  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private busLayer: L.LayerGroup | null = null;
  private busMarkers = new Map<string, { marker: L.Marker; iconSig: string }>();
  private lastFitSignature = '';

  readonly recommendedOptions = computed<RecommendedBusOption[]>(
    () => this.state().recommended_options ?? []
  );

  readonly tripOptions = computed<TripOption[]>(() => this.state().trip_options ?? []);

  readonly clampedOptionIndex = computed(() => {
    const len = Math.max(this.recommendedOptions().length, this.tripOptions().length);
    if (len === 0) return 0;
    return Math.min(Math.max(0, this.selectedOptionIndex()), len - 1);
  });

  readonly activeOption = computed<RecommendedBusOption | null>(() => {
    const opts = this.recommendedOptions();
    if (opts.length === 0) return null;
    return opts[this.clampedOptionIndex()] ?? opts[0];
  });

  readonly activeTripOption = computed<TripOption | null>(() => {
    const opts = this.tripOptions();
    if (opts.length === 0) return null;
    return opts[this.clampedOptionIndex()] ?? opts[0];
  });

  readonly activeDisplayRoute = computed(
    () => this.activeOption()?.route ?? this.state().route
  );

  readonly activeOriginStop = computed(
    () => this.activeOption()?.origin_stop ?? this.state().user_stop
  );

  readonly activeBus = computed(
    () => this.activeOption()?.bus ?? this.state().nearest_bus
  );

  formatClearEndpoint(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const parenMatch = trimmed.match(/^(.*?)\(([^)]+)\)\s*$/);
    let place = parenMatch ? parenMatch[1].trim() : trimmed;
    const city = parenMatch ? parenMatch[2].trim() : '';
    place = place.replace(/\/(?:הורדה|רציפים\s*בינעירוני|איסוף)\b/g, '').trim();
    if (city && !place.toLowerCase().includes(city.toLowerCase())) {
      return `${place}, ${city}`;
    }
    return place;
  }

  private resolveEndpointPair(): { start: string; end: string } {
    const isHe = this.lang() === 'he' || this.lang() === 'ar';
    if (this.state().destination) {
      const stopRaw = isHe
        ? this.activeOriginStop().stop_name_he
        : this.activeOriginStop().stop_name;
      const startPoint =
        this.formatClearEndpoint(stopRaw) || this.cleanStopName(this.originLabel() || '📍');
      const destStop = this.activeOption()?.dest_stop;
      const destRaw =
        this.targetLabel() ||
        this.state().destination?.place_name ||
        (destStop ? (isHe ? destStop.stop_name_he : destStop.stop_name) : '') ||
        '🏁';
      const endPoint = this.formatClearEndpoint(destRaw);
      return this.isTripReversed()
        ? { start: endPoint, end: startPoint }
        : { start: startPoint, end: endPoint };
    }

    const stops = this.activeOption()?.timeline_stops ?? this.state().timeline_stops;
    if (stops.length >= 2) {
      const firstRaw = isHe ? stops[0].stop_name_he : stops[0].stop_name;
      const lastRaw = isHe
        ? stops[stops.length - 1].stop_name_he
        : stops[stops.length - 1].stop_name;
      return {
        start: this.formatClearEndpoint(firstRaw),
        end: this.formatClearEndpoint(lastRaw)
      };
    }

    const route = this.activeDisplayRoute();
    const dir = route.available_directions.find((d) => d.direction_id === route.direction_id);
    const raw = isHe
      ? dir?.label_he ?? dir?.label ?? route.direction_label
      : dir?.label ?? route.direction_label;
    const parts = raw
      .split(/\s*(?:->|→)\s*/)
      .map((p) => this.formatClearEndpoint(p))
      .filter(Boolean);
    return {
      start: parts[0] ?? '',
      end: parts[parts.length - 1] ?? ''
    };
  }

  readonly directionStartText = computed(() => this.resolveEndpointPair().start);
  readonly directionEndText = computed(() => this.resolveEndpointPair().end);

  readonly heroRouteDisplay = computed(() => {
    const base = this.activeDisplayRoute().short_name || '—';
    const trip = this.activeTripOption();
    if (trip && trip.transfers_count > 0 && trip.legs.length > 1) {
      return trip.legs.map((l) => l.line_number).join('→');
    }
    if (this.activeOption()?.is_transfer && this.activeOption()?.second_leg) {
      return `${base}→${this.activeOption()!.second_leg!.route.short_name}`;
    }
    return base;
  });

  readonly etaDigits = computed(() => {
    const eta = this.activeBus()?.eta_minutes;
    if (eta === undefined) return '—';
    return String(eta);
  });

  readonly etaUnit = computed(() => {
    const eta = this.activeBus()?.eta_minutes;
    if (eta === undefined) return '';
    if (this.lang() === 'he') return 'דק׳';
    if (this.lang() === 'ar') return 'د';
    if (this.lang() === 'uk') return 'ХВ';
    if (this.lang() === 'ru') return 'МИН';
    return 'MIN';
  });

  readonly isScheduledEta = computed(() => {
    const bus = this.activeBus();
    return bus?.eta_source === 'scheduled' || bus?.is_realtime === false;
  });

  readonly etaStatusText = computed(() => {
    const bus = this.activeBus();
    if (!bus) return '';
    if (this.isScheduledEta()) {
      return this.labels().scheduledEta;
    }
    const sec = bus.last_updated_sec_ago;
    if (sec !== undefined && sec > 0) {
      return `LIVE GPS • ${sec}${this.labels().secShort}`;
    }
    return 'LIVE GPS';
  });

  readonly stopsAwayText = computed(() => {
    const stops = this.activeBus()?.stops_away ?? 0;
    if (this.lang() === 'he') return `${stops} תחנות ממך`;
    if (this.lang() === 'ar') return `يبعد ${stops} محطات`;
    if (this.lang() === 'uk') return `${stops} зуп. до вас`;
    if (this.lang() === 'en') return `${stops} stops away`;
    return `${stops} ост. до вас`;
  });

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          busRoute: 'קו אוטובוס',
          arrivalCountdown: 'זמן הגעה',
          switchDir: 'החלף כיוון',
          reverseRoute: 'מסלול הפוך',
          optionWord: 'אפשרות',
          variantsAria: 'בחר אפשרות נסיעה',
          minShort: 'דק׳',
          waitWord: 'המתנה',
          recenter: 'מרכז מסלול',
          myLocation: 'התמקד במיקום שלי',
          offersTitle: 'בתי קפה בקרבת מקום',
          openMaps: 'פתח במפות',
          intercityAdvice:
            'היעד המבוקש נמצא מחוץ לרשת העירונית. מומלץ לקחת קו אקספרס 910/900 או רכבת ממרכזית חוף הכרמל.',
          scheduledEta: 'לפי לו״ז',
          secShort: 'ש׳',
          fromWord: 'מוצא',
          toWord: 'יעד',
          boardWord: 'עליה',
          alightWord: 'ירידה',
          stopsCountWord: 'תחנות'
        };
      case 'ar':
        return {
          busRoute: 'خط الحافلة',
          arrivalCountdown: 'الوقت المتبقي',
          switchDir: 'تبديل الاتجاه',
          reverseRoute: 'المسار العكسي',
          optionWord: 'خيار',
          variantsAria: 'اختر خيار الرحلة',
          minShort: 'د',
          waitWord: 'انتظار',
          recenter: 'توسيط المسار',
          myLocation: 'التقريب إلى موقعي',
          offersTitle: 'مقاهي قريبة أثناء الانتظار',
          openMaps: 'فتح في الخرائط',
          intercityAdvice:
            'الوجهة خارج الشبكة الحضرية المحلية. يُنصح بأخذ خط إكسبرس 900/910 أو القطار من محطة حوف هكرمل.',
          scheduledEta: 'حسب الجدول',
          secShort: 'ث',
          fromWord: 'من',
          toWord: 'إلى',
          boardWord: 'صعود',
          alightWord: 'نزول',
          stopsCountWord: 'محطات'
        };
      case 'uk':
        return {
          busRoute: 'маршрут',
          arrivalCountdown: 'до прибуття',
          switchDir: 'Змінити напрямок',
          reverseRoute: 'Зворотний маршрут',
          optionWord: 'Варіант',
          variantsAria: 'Вибір варіанта маршруту',
          minShort: 'хв',
          waitWord: 'очік.',
          recenter: 'Центрувати маршрут',
          myLocation: 'Наблизити до моєї локації',
          offersTitle: 'Кафе поруч на час очікування',
          openMaps: 'Відкрити на карті',
          intercityAdvice:
            'Пункт призначення за межами міської мережі. Рекомендуємо експрес №900/910 або потяг від Хоф ха-Кармель.',
          scheduledEta: 'За розкладом',
          secShort: 'с',
          fromWord: 'Звідки',
          toWord: 'Куди',
          boardWord: 'Посадка',
          alightWord: 'Висадка',
          stopsCountWord: 'зуп.'
        };
      case 'en':
        return {
          busRoute: 'bus route',
          arrivalCountdown: 'arrival countdown',
          switchDir: 'Switch direction',
          reverseRoute: 'Reverse route',
          optionWord: 'Option',
          variantsAria: 'Select trip option',
          minShort: 'min',
          waitWord: 'wait',
          recenter: 'Center route',
          myLocation: 'Zoom to my location',
          offersTitle: 'Cafes nearby while you wait',
          openMaps: 'Open in Maps',
          intercityAdvice:
            'Destination is outside the local urban corridor. Take Express 910/900 or rail from Hof HaCarmel Central.',
          scheduledEta: 'Scheduled',
          secShort: 's',
          fromWord: 'From',
          toWord: 'To',
          boardWord: 'Board',
          alightWord: 'Alight',
          stopsCountWord: 'stops'
        };
      default:
        return {
          busRoute: 'маршрут',
          arrivalCountdown: 'до прибытия',
          switchDir: 'Сменить направление',
          reverseRoute: 'Обратный маршрут',
          optionWord: 'Вариант',
          variantsAria: 'Выбор варианта маршрута',
          minShort: 'мин',
          waitWord: 'ожид.',
          recenter: 'Центрировать маршрут',
          myLocation: 'Приблизить к моему местоположению',
          offersTitle: 'Кафе рядом на время ожидания',
          openMaps: 'Открыть на карте',
          intercityAdvice:
            'Пункт назначения находится за пределами городской сети. Рекомендуем экспресс №910/900 или поезд от Хоф ха-Кармель.',
          scheduledEta: 'По расписанию',
          secShort: 'с',
          fromWord: 'Откуда',
          toWord: 'Куда',
          boardWord: 'Посадка',
          alightWord: 'Высадка',
          stopsCountWord: 'ост.'
        };
    }
  });

  constructor() {
    effect(() => {
      const currentState = this.state();
      const currentLang = this.lang();
      const optionIdx = this.clampedOptionIndex();
      if (this.map && this.markersLayer) {
        this.renderMapLayers(currentState, currentLang, optionIdx);
      }
    });
  }

  ngAfterViewInit(): void {
    const container = this.mapEl()?.nativeElement;
    if (!container) return;

    const initial = this.state();
    const centerLat = initial.user_location?.lat ?? initial.user_stop.lat;
    const centerLon = initial.user_location?.lon ?? initial.user_stop.lon;

    this.map = L.map(container, {
      center: [centerLat, centerLon],
      zoom: 14,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
    this.busLayer = L.layerGroup().addTo(this.map);
    this.renderMapLayers(initial, this.lang(), this.clampedOptionIndex());
    setTimeout(() => this.map?.invalidateSize(), 60);
  }

  ngOnDestroy(): void {
    this.busMarkers.clear();
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markersLayer = null;
      this.busLayer = null;
    }
  }

  onSwitchDirection(): void {
    const nextDir: 0 | 1 = this.activeDisplayRoute().direction_id === 0 ? 1 : 0;
    this.switchDirection.emit(nextDir);
  }

  formatOptionRoute(opt: RecommendedBusOption): string {
    if (opt.is_transfer && opt.second_leg) {
      if (opt.third_leg) {
        return `${opt.route.short_name}→${opt.second_leg.route.short_name}→${opt.third_leg.route.short_name}`;
      }
      return `${opt.route.short_name}→${opt.second_leg.route.short_name}`;
    }
    return opt.route.short_name;
  }

  cleanStopName(name: string): string {
    return name.replace(/\s*\([^)]+\)\s*$/, '').trim() || name;
  }

  zoomToUserLocation(): void {
    if (!this.map) return;
    const data = this.state();
    const target = data.user_location ?? this.activeOriginStop();
    this.map.setView([target.lat, target.lon], 16, { animate: true });
  }

  recenterMap(): void {
    if (!this.map) return;
    this.lastFitSignature = '';
    this.renderMapLayers(this.state(), this.lang(), this.clampedOptionIndex());
  }

  private approxMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLat = (lat2 - lat1) * 111_000;
    const dLon = (lon2 - lon1) * 111_000 * Math.cos((lat1 * Math.PI) / 180);
    return Math.hypot(dLat, dLon);
  }

  private sliceLegStops(leg: TripLeg): NonNullable<TripLeg['timeline_stops']> {
    const stops = leg.timeline_stops ?? [];
    if (stops.length === 0) return [];
    const startSeq = leg.board_stop.stop_sequence;
    const endSeq = leg.alight_stop.stop_sequence;
    if (startSeq !== undefined && endSeq !== undefined && endSeq >= startSeq) {
      const sliced = stops.filter(
        (s) => s.stop_sequence >= startSeq && s.stop_sequence <= endSeq
      );
      if (sliced.length > 0) return sliced;
    }
    const startIdx = stops.findIndex(
      (s) => s.stop_id === leg.board_stop.stop_id || s.stop_code === leg.board_stop.stop_code
    );
    const endIdx = stops.findIndex(
      (s) => s.stop_id === leg.alight_stop.stop_id || s.stop_code === leg.alight_stop.stop_code
    );
    if (startIdx >= 0 && endIdx >= startIdx) {
      return stops.slice(startIdx, endIdx + 1);
    }
    return stops;
  }

  private renderMapLayers(
    data: LiveBusStatusResponse,
    lang: WidgetLang,
    optionIdx: number
  ): void {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];
    const activeOpt =
      data.recommended_options?.[optionIdx] ?? data.recommended_options?.[0] ?? null;
    const tripOpt =
      data.trip_options?.[optionIdx] ?? data.trip_options?.[0] ?? null;

    if (tripOpt && tripOpt.legs && tripOpt.legs.length > 0) {
      // Full multi-leg render (Direct, 1-transfer, 2-transfer, etc.)
      const legColors = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6'];
      const stopFillColors = ['#bfdbfe', '#fde68a', '#a7f3d0', '#ddd6fe'];

      tripOpt.legs.forEach((leg, legIdx) => {
        const legColor = legColors[legIdx % legColors.length];
        const stopFill = stopFillColors[legIdx % stopFillColors.length];
        const dashArray = legIdx === 1 ? '8, 6' : legIdx >= 2 ? '6, 6' : undefined;
        const legStops = this.sliceLegStops(leg);

        // Polyline from sliced leg stops if available
        if (legStops.length > 0) {
          const legCoords: L.LatLngExpression[] = legStops.map((s) => [s.lat, s.lon]);
          L.polyline(legCoords, {
            color: legColor,
            weight: 5,
            opacity: 0.92,
            dashArray
          }).addTo(this.markersLayer!);

          for (const s of legStops) {
            boundsPoints.push([s.lat, s.lon]);
            const isBoard = s.stop_id === leg.board_stop.stop_id || s.stop_code === leg.board_stop.stop_code;
            const isAlight = s.stop_id === leg.alight_stop.stop_id || s.stop_code === leg.alight_stop.stop_code;

            L.circleMarker([s.lat, s.lon], {
              radius: isBoard || isAlight ? 7 : 4,
              color: '#0f172a',
              weight: 2,
              fillColor: isBoard
                ? '#ffffff'
                : isAlight
                  ? (legIdx === tripOpt.legs.length - 1 ? '#ef4444' : legColor)
                  : stopFill,
              fillOpacity: 1
            })
              .bindPopup(
                `<strong>${lang === 'he' ? s.stop_name_he : s.stop_name}</strong><br/>${lang === 'he' ? 'קו' : lang === 'en' ? 'Line' : 'Линия'} ${leg.line_number} • #${s.stop_code}`
              )
              .addTo(this.markersLayer!);
          }
        } else if (leg.board_stop.lat && leg.board_stop.lon && leg.alight_stop.lat && leg.alight_stop.lon) {
          const legCoords: L.LatLngExpression[] = [
            [leg.board_stop.lat, leg.board_stop.lon],
            [leg.alight_stop.lat, leg.alight_stop.lon]
          ];
          L.polyline(legCoords, {
            color: legColor,
            weight: 5,
            opacity: 0.9,
            dashArray
          }).addTo(this.markersLayer!);
          boundsPoints.push([leg.board_stop.lat, leg.board_stop.lon]);
          boundsPoints.push([leg.alight_stop.lat, leg.alight_stop.lon]);
        }

        // Leg 0: Walking connector from User GPS + crisp 🚏 Boarding Stop Pin
        if (legIdx === 0 && leg.board_stop.lat && leg.board_stop.lon) {
          if (data.user_location) {
            const walkToBoardM = this.approxMeters(
              data.user_location.lat,
              data.user_location.lon,
              leg.board_stop.lat,
              leg.board_stop.lon
            );
            if (walkToBoardM > 20) {
              L.polyline(
                [
                  [data.user_location.lat, data.user_location.lon],
                  [leg.board_stop.lat, leg.board_stop.lon]
                ],
                { color: '#60a5fa', weight: 3, dashArray: '4, 6', opacity: 0.85 }
              ).addTo(this.markersLayer!);
            }
          }

          boundsPoints.push([leg.board_stop.lat, leg.board_stop.lon]);
          const boardIcon = L.divIcon({
            className: '',
            html: '<div class="nb-pin-emoji nb-pin-board">🚏</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          });
          L.marker([leg.board_stop.lat, leg.board_stop.lon], { icon: boardIcon })
            .bindPopup(
              `<strong>🚏 ${lang === 'he' ? 'עליה לקו' : lang === 'en' ? 'Board Line' : 'Посадка на Линию'} ${leg.line_number}</strong><br/>${lang === 'he' ? leg.board_stop.stop_name_he : leg.board_stop.stop_name} (#${leg.board_stop.stop_code})`
            )
            .addTo(this.markersLayer!);
        }

        // Transfer connections (between legIdx - 1 and legIdx)
        if (legIdx > 0) {
          const prevLeg = tripOpt.legs[legIdx - 1];
          const xferFromLat = prevLeg.alight_stop.lat;
          const xferFromLon = prevLeg.alight_stop.lon;
          const xferToLat = leg.board_stop.lat;
          const xferToLon = leg.board_stop.lon;

          if (
            xferFromLat &&
            xferFromLon &&
            xferToLat &&
            xferToLon &&
            (xferFromLat !== xferToLat || xferFromLon !== xferToLon)
          ) {
            L.polyline(
              [
                [xferFromLat, xferFromLon],
                [xferToLat, xferToLon]
              ],
              { color: '#cbd5e1', weight: 3, dashArray: '3, 5' }
            ).addTo(this.markersLayer!);
          }

          const hubLat = xferToLat ?? xferFromLat;
          const hubLon = xferToLon ?? xferFromLon;
          if (hubLat && hubLon) {
            boundsPoints.push([hubLat, hubLon]);
            const xferIcon = L.divIcon({
              className: '',
              html: '<div class="nb-pin-emoji nb-pin-xfer">🔄</div>',
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });
            const waitText = leg.transfer_wait_min
              ? `~${leg.transfer_wait_min} ${lang === 'he' ? 'דק׳' : lang === 'en' ? 'min' : 'мин'}`
              : '';
            const walkText = leg.transfer_walk_meters ? `🚶 ${leg.transfer_walk_meters}m` : '';
            L.marker([hubLat, hubLon], { icon: xferIcon })
              .bindPopup(
                `<strong>🔄 ${lang === 'he' ? 'מעבר לקו' : lang === 'en' ? 'Transfer to Line' : 'Пересадка на Линию'} ${leg.line_number}</strong><br/>${lang === 'he' ? leg.board_stop.stop_name_he : leg.board_stop.stop_name} (#${leg.board_stop.stop_code})<br/>${waitText} ${walkText}`
              )
              .addTo(this.markersLayer!);
          }
        }

        // Final Alighting stop: dotted walk to destination (strictly ONE 🏁 rendered in Section 3, or here only if no destination)
        if (legIdx === tripOpt.legs.length - 1 && leg.alight_stop.lat && leg.alight_stop.lon) {
          boundsPoints.push([leg.alight_stop.lat, leg.alight_stop.lon]);
          if (data.destination) {
            if (legStops.length === 0) {
              L.circleMarker([leg.alight_stop.lat, leg.alight_stop.lon], {
                radius: 7,
                color: '#0f172a',
                weight: 2,
                fillColor: '#ef4444',
                fillOpacity: 1
              })
                .bindPopup(
                  `<strong>${lang === 'he' ? 'ירידה מהקו' : lang === 'en' ? 'Alight Line' : 'Высадка из Линии'} ${leg.line_number}</strong><br/>${lang === 'he' ? leg.alight_stop.stop_name_he : leg.alight_stop.stop_name} (#${leg.alight_stop.stop_code})`
                )
                .addTo(this.markersLayer!);
            }
            const walkFromAlightM = this.approxMeters(
              leg.alight_stop.lat,
              leg.alight_stop.lon,
              data.destination.lat,
              data.destination.lon
            );
            if (walkFromAlightM > 25) {
              L.polyline(
                [
                  [leg.alight_stop.lat, leg.alight_stop.lon],
                  [data.destination.lat, data.destination.lon]
                ],
                { color: '#f87171', weight: 3, dashArray: '4, 6', opacity: 0.85 }
              ).addTo(this.markersLayer!);
            }
          } else {
            const alightIcon = L.divIcon({
              className: '',
              html: '<div class="nb-pin-emoji nb-pin-dest">🏁</div>',
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });
            L.marker([leg.alight_stop.lat, leg.alight_stop.lon], { icon: alightIcon })
              .bindPopup(
                `<strong>🏁 ${lang === 'he' ? 'ירידה סופית מקו' : lang === 'en' ? 'Final Alight from Line' : 'Высадка из Линии'} ${leg.line_number}</strong><br/>${lang === 'he' ? leg.alight_stop.stop_name_he : leg.alight_stop.stop_name} (#${leg.alight_stop.stop_code})`
              )
              .addTo(this.markersLayer!);
          }
        }
      });
    } else {
      // 1. Primary Leg Polyline (#3087f6 electric blue) & stop dots fallback
      const rawTimeline = activeOpt?.timeline_stops ?? data.timeline_stops;
      const originStopSeq = activeOpt?.origin_stop.stop_sequence ?? data.user_stop.stop_sequence;
      const destStopSeq = activeOpt?.is_transfer
        ? activeOpt.transfer_info?.alight_stop.stop_sequence
        : activeOpt?.dest_stop.stop_sequence;
      const slicedTimeline =
        originStopSeq !== undefined && destStopSeq !== undefined && destStopSeq >= originStopSeq
          ? rawTimeline.filter(
              (s) => s.stop_sequence >= originStopSeq && s.stop_sequence <= destStopSeq
            )
          : rawTimeline;
      const activeTimeline = slicedTimeline.length > 0 ? slicedTimeline : rawTimeline;

      if (activeTimeline.length > 0) {
        const polyCoords: L.LatLngExpression[] = activeTimeline.map((s) => [s.lat, s.lon]);
        L.polyline(polyCoords, { color: '#3087f6', weight: 4.5, opacity: 0.92 }).addTo(
          this.markersLayer
        );

        for (const stop of activeTimeline) {
          boundsPoints.push([stop.lat, stop.lon]);
          const isOrigin = stop.stop_sequence === originStopSeq;
          const isEnd = destStopSeq !== undefined && stop.stop_sequence === destStopSeq;
          L.circleMarker([stop.lat, stop.lon], {
            radius: isOrigin || isEnd ? 8 : 4.5,
            color: isOrigin ? '#3087f6' : '#181e24',
            weight: isOrigin ? 3 : 2,
            fillColor: isEnd
              ? activeOpt?.is_transfer
                ? '#f59e0b'
                : '#ef4444'
              : isOrigin
                ? '#ffffff'
                : '#cbd5e1',
            fillOpacity: 1
          })
            .bindPopup(
              `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Line ${activeOpt?.route.short_name ?? data.route.short_name} • #${stop.stop_code}`
            )
            .addTo(this.markersLayer);
        }
      }

      // 1b. Transfer Leg 2 dashed amber polyline + walking connector + transfer hub pin
      if (activeOpt?.is_transfer && activeOpt.transfer_info && activeOpt.second_leg) {
        const xfer = activeOpt.transfer_info;
        const rawLeg2Stops = activeOpt.second_leg.timeline_stops;
        const l2Start = activeOpt.second_leg.board_stop.stop_sequence;
        const l2End = activeOpt.second_leg.alight_stop?.stop_sequence ?? activeOpt.dest_stop.stop_sequence;
        const slicedLeg2 =
          l2Start !== undefined && l2End !== undefined && l2End >= l2Start
            ? rawLeg2Stops.filter((s) => s.stop_sequence >= l2Start && s.stop_sequence <= l2End)
            : rawLeg2Stops;
        const leg2Stops = slicedLeg2.length > 0 ? slicedLeg2 : rawLeg2Stops;
        if (leg2Stops.length > 0) {
          const leg2Coords: L.LatLngExpression[] = leg2Stops.map((s) => [s.lat, s.lon]);
          L.polyline(leg2Coords, {
            color: '#f59e0b',
            weight: 4.5,
            opacity: 0.9,
            dashArray: '8, 6'
          }).addTo(this.markersLayer);

          for (const stop of leg2Stops) {
            boundsPoints.push([stop.lat, stop.lon]);
            const isFinalDest = stop.stop_sequence === activeOpt.dest_stop.stop_sequence;
            L.circleMarker([stop.lat, stop.lon], {
              radius: isFinalDest ? 8 : 4.5,
              color: '#181e24',
              weight: 2,
              fillColor: isFinalDest ? '#ef4444' : '#fde68a',
              fillOpacity: 1
            })
              .bindPopup(
                `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Line ${activeOpt.second_leg.route.short_name} • #${stop.stop_code}`
              )
              .addTo(this.markersLayer);
          }
        }

        if (
          xfer.alight_stop.lat !== xfer.board_stop.lat ||
          xfer.alight_stop.lon !== xfer.board_stop.lon
        ) {
          L.polyline(
            [
              [xfer.alight_stop.lat, xfer.alight_stop.lon],
              [xfer.board_stop.lat, xfer.board_stop.lon]
            ],
            { color: '#fde68a', weight: 3, dashArray: '3, 5' }
          ).addTo(this.markersLayer);
        }

        const hubPos: L.LatLngExpression = [xfer.alight_stop.lat, xfer.alight_stop.lon];
        boundsPoints.push(hubPos);
        const hubIcon = L.divIcon({
          className: '',
          html: '<div class="nb-pin-emoji nb-pin-xfer">🔄</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        const transferPopup =
          lang === 'he'
            ? xfer.instruction_he
            : lang === 'en'
              ? xfer.instruction_en
              : xfer.instruction_ru;
        L.marker(hubPos, { icon: hubIcon })
          .bindPopup(
            `<strong>🔄 ${lang === 'he' ? xfer.alight_stop.stop_name_he : xfer.alight_stop.stop_name}</strong> (#${xfer.alight_stop.stop_code})<br/>${transferPopup}`
          )
          .addTo(this.markersLayer);
      }
    }

    // 2. User GPS Marker (strictly ONE pulsing blue GPS dot)
    if (data.user_location) {
      const userPos: L.LatLngExpression = [data.user_location.lat, data.user_location.lon];
      boundsPoints.push(userPos);
      const userIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-gps"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      L.marker(userPos, { icon: userIcon })
        .bindPopup(
          `<strong>Near You</strong><br/>${data.user_location.lat.toFixed(5)}, ${data.user_location.lon.toFixed(5)}`
        )
        .addTo(this.markersLayer);
    }

    // 3. Destination Marker (strictly ONE 🏁 Finish Pin)
    if (data.destination) {
      const destPos: L.LatLngExpression = [data.destination.lat, data.destination.lon];
      boundsPoints.push(destPos);
      const destIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-dest">🏁</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker(destPos, { icon: destIcon })
        .bindPopup(`<strong>🏁 ${data.destination.place_name}</strong><br/>${data.destination.formatted_address}`)
        .addTo(this.markersLayer);
    }

    // 4. Live Bus Pill Markers
    const activeBusKeys = new Set<string>();
    const busEntries: Array<{
      key: string;
      lat: number;
      lon: number;
      shortName: string;
      color: string;
      isPrimary: boolean;
      popupHtml: string;
    }> = [];

    if (activeOpt) {
      busEntries.push({
        key: `leg1:${activeOpt.route.route_id}:${activeOpt.route.direction_id}`,
        lat: activeOpt.bus.lat,
        lon: activeOpt.bus.lon,
        shortName: activeOpt.route.short_name,
        color: '#3087f6',
        isPrimary: true,
        popupHtml:
          `<strong>Bus ${activeOpt.route.short_name}</strong><br/>` +
          `ETA: ${activeOpt.eta_to_boarding_min} min • Arrive ${activeOpt.estimated_arrival_time}`
      });
      if (activeOpt.is_transfer && activeOpt.second_leg) {
        busEntries.push({
          key: `leg2:${activeOpt.second_leg.route.route_id}:${activeOpt.second_leg.route.direction_id}`,
          lat: activeOpt.second_leg.bus.lat,
          lon: activeOpt.second_leg.bus.lon,
          shortName: `${activeOpt.second_leg.route.short_name} (2)`,
          color: '#f59e0b',
          isPrimary: false,
          popupHtml:
            `<strong>2nd Bus ${activeOpt.second_leg.route.short_name}</strong><br/>` +
            `Board at ${activeOpt.transfer_info?.next_bus_board_time ?? ''}`
        });
      }
      if (activeOpt.third_leg) {
        busEntries.push({
          key: `leg3:${activeOpt.third_leg.route.route_id}:${activeOpt.third_leg.route.direction_id}`,
          lat: activeOpt.third_leg.bus.lat,
          lon: activeOpt.third_leg.bus.lon,
          shortName: `${activeOpt.third_leg.route.short_name} (3)`,
          color: '#10b981',
          isPrimary: false,
          popupHtml:
            `<strong>3rd Bus ${activeOpt.third_leg.route.short_name}</strong><br/>` +
            `Board Line ${activeOpt.third_leg.route.short_name}`
        });
      }
    } else if (data.nearest_bus) {
      busEntries.push({
        key: `line:${data.route.route_id}:${data.route.direction_id}`,
        lat: data.nearest_bus.lat,
        lon: data.nearest_bus.lon,
        shortName: data.route.short_name,
        color: '#3087f6',
        isPrimary: true,
        popupHtml: `<strong>Bus ${data.route.short_name}</strong><br/>ETA: ${data.nearest_bus.eta_minutes} min`
      });
    }

    const tripSpanMeters =
      data.user_location && data.destination
        ? this.approxMeters(
            data.user_location.lat,
            data.user_location.lon,
            data.destination.lat,
            data.destination.lon
          )
        : 2500;
    const maxBusBoundDist = Math.max(2500, tripSpanMeters * 1.5);
    const originAnchor = data.user_location ?? data.user_stop;
    const destAnchor = data.destination;

    for (const item of busEntries) {
      activeBusKeys.add(item.key);
      const busPos: L.LatLngExpression = [item.lat, item.lon];
      const nearOrigin = originAnchor
        ? this.approxMeters(item.lat, item.lon, originAnchor.lat, originAnchor.lon) <= maxBusBoundDist
        : true;
      const nearDest = destAnchor
        ? this.approxMeters(item.lat, item.lon, destAnchor.lat, destAnchor.lon) <= maxBusBoundDist
        : false;
      if (nearOrigin || nearDest) {
        boundsPoints.push(busPos);
      }
      this.upsertBusMarker(
        item.key,
        busPos,
        item.shortName,
        item.color,
        item.isPrimary,
        item.popupHtml
      );
    }

    for (const [key, entry] of this.busMarkers) {
      if (!activeBusKeys.has(key)) {
        entry.marker.remove();
        this.busMarkers.delete(key);
      }
    }

    // 5. Cafes Nearby
    for (const offer of data.nearby_offers) {
      const cafePos: L.LatLngExpression = [offer.lat, offer.lon];
      const cafeIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-cafe">☕</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      L.marker(cafePos, { icon: cafeIcon })
        .bindPopup(
          `<strong>${lang === 'he' ? offer.name_he : offer.name}</strong><br/>${offer.distance_meters} m (${offer.walk_minutes} min walk)<br/>${offer.promo}`
        )
        .addTo(this.markersLayer);
    }

    const userKey = data.user_location
      ? `${data.user_location.lat.toFixed(4)},${data.user_location.lon.toFixed(4)}`
      : `${data.user_stop.lat.toFixed(4)},${data.user_stop.lon.toFixed(4)}`;
    const fitSignature = data.destination
      ? `${userKey}->${data.destination.lat.toFixed(4)},${data.destination.lon.toFixed(4)}:${optionIdx}:${activeOpt?.route.route_id ?? ''}:${activeOpt?.origin_stop.stop_id ?? ''}`
      : `${data.route.route_id}:${data.route.direction_id}`;

    if (this.lastFitSignature !== fitSignature && boundsPoints.length >= 2) {
      this.lastFitSignature = fitSignature;
      this.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 15 });
    }
  }

  private upsertBusMarker(
    key: string,
    busPos: L.LatLngExpression,
    shortName: string,
    color: string,
    isPrimary: boolean,
    popupHtml: string
  ): void {
    if (!this.busLayer) return;
    const iconSig = `${shortName}:${color}:${isPrimary}`;
    const existing = this.busMarkers.get(key);

    if (existing) {
      existing.marker.setLatLng(busPos).setPopupContent(popupHtml);
      if (existing.iconSig !== iconSig) {
        existing.marker.setIcon(this.makeBusDivIcon(shortName, color, isPrimary));
        existing.iconSig = iconSig;
      }
      return;
    }

    const icon = this.makeBusDivIcon(shortName, color, isPrimary);
    const marker = L.marker(busPos, { icon }).bindPopup(popupHtml).addTo(this.busLayer);
    this.busMarkers.set(key, { marker, iconSig });
  }

  private makeBusDivIcon(shortName: string, color: string, isPrimary: boolean): L.DivIcon {
    const width = shortName.length > 4 ? 78 : 58;
    return L.divIcon({
      className: 'nb-smooth-marker',
      html: `<div class="nb-pin-bus-pill ${isPrimary ? 'is-primary' : 'is-secondary'}" style="background:${color}">🚌 ${shortName}</div>`,
      iconSize: [width, 26],
      iconAnchor: [Math.round(width / 2), 13]
    });
  }
}

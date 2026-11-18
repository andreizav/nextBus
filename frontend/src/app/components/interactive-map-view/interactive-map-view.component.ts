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
      class="interactive-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Interactive transit map, fastest A-to-B route, and nearby cafes"
    >
      <header class="interactive-header">
        <div class="interactive-route">
          <div
            class="route-badge-sm"
            [class.is-transfer]="bestOption()?.is_transfer"
            aria-label="Fastest route number"
          >
            @if (bestOption()?.is_transfer && bestOption()?.second_leg; as sec) {
              <span>{{ activeDisplayRoute().short_name }}→{{ sec.route.short_name }}</span>
            } @else {
              <span>{{ activeDisplayRoute().short_name }}</span>
            }
          </div>
          <div class="route-info">
            <span class="interactive-pill">
              <span aria-hidden="true">🗺️</span>
              {{ labels().badge }}
              @if (state().destination; as dest) {
                <span class="dest-tag">→ {{ dest.place_name }}</span>
              }
            </span>
            <h2 class="interactive-title">
              @if (state().destination; as dest) {
                {{ labels().tripTo }} {{ dest.place_name }}
              } @else {
                {{ labels().routeLabel }} {{ activeDisplayRoute().short_name }} —
                {{
                  lang() === 'he'
                    ? activeOriginStop().stop_name_he
                    : activeOriginStop().stop_name
                }}
              }
            </h2>
            @if (activeBus()?.current_stop_name) {
              <p class="bus-current-sub">
                <span aria-hidden="true">🚌</span>
                {{ labels().busNowAt }}:
                {{
                  lang() === 'he'
                    ? activeBus()?.current_stop_name_he
                    : activeBus()?.current_stop_name
                }}
              </p>
            }
          </div>
        </div>

        <div class="header-right">
          <div class="eta-box-interactive" role="status" aria-live="polite">
            <span class="eta-val">{{ etaText() }}</span>
            <span class="eta-sub">{{ stopsAwayText() }}</span>
          </div>

          <div class="zoom-controls">
            <button
              type="button"
              class="ctrl-btn nb-btn"
              (click)="recenterMap()"
              [title]="labels().recenter"
            >
              🎯
            </button>
            @if (!bestOption()) {
              <button
                type="button"
                class="ctrl-btn nb-btn"
                (click)="switchDirection.emit(state().route.direction_id === 0 ? 1 : 0)"
                title="Switch direction"
              >
                ⇄
              </button>
            }
          </div>
        </div>
      </header>

      <div class="map-viewport">
        <div #mapContainer class="leaflet-host" aria-label="OpenStreetMap interactive map"></div>
        <div class="map-hud">
          <span>
            <strong>{{ labels().nearestStop }}:</strong>
            {{
              lang() === 'he'
                ? activeOriginStop().stop_name_he
                : activeOriginStop().stop_name
            }}
            (#{{ activeOriginStop().stop_code }})
          </span>
          <span>{{ etaText() }} • {{ stopsAwayText() }}</span>
        </div>
      </div>

      @if (bestOption(); as best) {
        <div class="best-route-section" role="region" aria-label="Fastest route itinerary">
          <div class="top3-header">
            <h3 class="offers-title">
              <span aria-hidden="true">⚡</span>
              {{ labels().fastestTitle }}
            </h3>
            @if (state().destination; as dest) {
              <span class="dest-addr">{{ dest.formatted_address }}</span>
            }
          </div>

          <div class="single-best-card">
            <div class="top3-card-head">
              <span
                class="line-pill"
                [style.background]="best.is_transfer ? '#f59e0b' : '#10b981'"
              >
                @if (best.is_transfer && best.second_leg) {
                  🚌 {{ best.route.short_name }} ➔ 🚌 {{ best.second_leg.route.short_name }}
                } @else {
                  {{ lang() === 'he' ? 'קו ' + best.route.short_name : labels().lineWord + ' ' + best.route.short_name }}
                }
              </span>
              <div class="head-badges">
                @if (best.is_transfer) {
                  <span class="transfer-badge">⇄ {{ labels().transferBadge }}</span>
                }
                <span class="fastest-badge">{{ labels().fastest }}</span>
              </div>
            </div>

            <div class="top3-boarding">
              @if (best.is_transfer && best.transfer_info && best.second_leg) {
                <span>
                  {{ labels().firstBus }} <strong>№{{ best.route.short_name }}</strong>
                  ({{ lang() === 'he' ? best.origin_stop.stop_name_he : best.origin_stop.stop_name }}, #{{ best.origin_stop.stop_code }}) —
                  <strong>{{ best.eta_to_boarding_min }} {{ labels().min }}</strong>
                </span>
                <div class="transfer-summary">
                  🔄 {{ labels().exitAt }} <strong>{{ best.transfer_info.arrive_at_hub_time }}</strong>
                  {{ labels().atStop }} «{{ lang() === 'he' ? best.transfer_info.alight_stop.stop_name_he : best.transfer_info.alight_stop.stop_name }}»
                  (#{{ best.transfer_info.alight_stop.stop_code }})
                  → {{ labels().boardNewBus }} <strong>🚌 №{{ best.second_leg.route.short_name }}</strong> {{ labels().boardAt }} <strong>{{ best.transfer_info.next_bus_board_time }}</strong>
                </div>
              } @else {
                {{ labels().arrivesIn }}
                <strong>{{ best.eta_to_boarding_min }} {{ labels().min }}</strong>
                ({{ lang() === 'he' ? best.origin_stop.stop_name_he : best.origin_stop.stop_name }}, #{{ best.origin_stop.stop_code }})
              }
            </div>

            <div class="top3-total">
              <span>{{ labels().arriveAt }} <strong>{{ best.estimated_arrival_time }}</strong></span>
              <span class="total-mins">({{ labels().total }} {{ best.total_arrival_min }} {{ labels().min }})</span>
            </div>
          </div>

          <div class="selected-timeline-box">
            @if (best.is_transfer && best.transfer_info && best.second_leg) {
              <div class="transfer-itinerary">
                <div class="itinerary-step">
                  <div class="timeline-head">
                    <strong>
                      🚌 1. {{ labels().routeWord }} {{ best.route.short_name }}:
                      {{ lang() === 'he' ? best.origin_stop.stop_name_he : best.origin_stop.stop_name }}
                      →
                      {{ lang() === 'he' ? best.transfer_info.alight_stop.stop_name_he : best.transfer_info.alight_stop.stop_name }}
                    </strong>
                    <span>{{ labels().arrivesIn }} {{ best.eta_to_boarding_min }} {{ labels().min }}</span>
                  </div>
                  <ul class="mini-stop-list">
                    @for (stop of best.timeline_stops; track stop.stop_id + '-' + stop.stop_sequence) {
                      <li
                        class="mini-stop"
                        [class.is-bus]="stop.stop_sequence === best.bus.current_stop_sequence"
                        [class.is-origin]="stop.stop_sequence === best.origin_stop.stop_sequence"
                        [class.is-xfer]="stop.stop_sequence === best.transfer_info.alight_stop.stop_sequence"
                      >
                        <span class="mini-dot">
                          @if (stop.stop_sequence === best.bus.current_stop_sequence) {
                            🚌
                          } @else if (stop.stop_sequence === best.origin_stop.stop_sequence) {
                            📍
                          } @else if (stop.stop_sequence === best.transfer_info.alight_stop.stop_sequence) {
                            🔄
                          } @else {
                            •
                          }
                        </span>
                        <span class="mini-name">
                          {{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}
                        </span>
                        <span class="mini-bus-tag">№{{ best.route.short_name }}</span>
                        <span class="mini-code">#{{ stop.stop_code }}</span>
                      </li>
                    }
                  </ul>
                </div>

                <div class="transfer-hub-banner" role="note" aria-label="Transfer instructions">
                  <div class="hub-title">
                    <span>🔄 {{ labels().transferHereTitle }}</span>
                    <span class="hub-meta">
                      @if (best.transfer_info.walk_meters > 0) {
                        🚶 {{ best.transfer_info.walk_meters }} m •
                      }
                      ⏱️ {{ labels().waitWord }} {{ best.transfer_info.wait_minutes }} {{ labels().min }}
                    </span>
                  </div>
                  <p class="hub-instruction">{{ transferInstruction(best.transfer_info) }}</p>
                </div>

                <div class="itinerary-step">
                  <div class="timeline-head">
                    <strong>
                      🚌 2. {{ labels().routeWord }} {{ best.second_leg.route.short_name }} ({{ best.transfer_info.next_bus_board_time }}):
                      {{ lang() === 'he' ? best.second_leg.board_stop.stop_name_he : best.second_leg.board_stop.stop_name }}
                      →
                      {{ lang() === 'he' ? best.dest_stop.stop_name_he : best.dest_stop.stop_name }}
                    </strong>
                    <span>{{ best.second_leg.stops_between }} {{ labels().stopsWord }} • ~{{ best.second_leg.ride_duration_min }} {{ labels().min }} • 🏁 {{ best.estimated_arrival_time }}</span>
                  </div>
                  <ul class="mini-stop-list">
                    @for (stop of best.second_leg.timeline_stops; track 'leg2-' + stop.stop_id + '-' + stop.stop_sequence) {
                      <li
                        class="mini-stop"
                        [class.is-bus]="stop.stop_sequence === best.second_leg.bus.current_stop_sequence"
                        [class.is-xfer]="stop.stop_sequence === best.second_leg.board_stop.stop_sequence"
                        [class.is-dest]="stop.stop_sequence === best.dest_stop.stop_sequence"
                      >
                        <span class="mini-dot">
                          @if (stop.stop_sequence === best.second_leg.bus.current_stop_sequence) {
                            🚌
                          } @else if (stop.stop_sequence === best.second_leg.board_stop.stop_sequence) {
                            🔄
                          } @else if (stop.stop_sequence === best.dest_stop.stop_sequence) {
                            🏁
                          } @else {
                            •
                          }
                        </span>
                        <span class="mini-name">
                          {{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}
                        </span>
                        <span class="mini-bus-tag is-leg2">№{{ best.second_leg.route.short_name }}</span>
                        <span class="mini-code">#{{ stop.stop_code }}</span>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            } @else {
              <div class="timeline-head">
                <strong>
                  {{ labels().routeWord }} {{ best.route.short_name }}:
                  {{ lang() === 'he' ? best.origin_stop.stop_name_he : best.origin_stop.stop_name }}
                  →
                  {{ lang() === 'he' ? best.dest_stop.stop_name_he : best.dest_stop.stop_name }}
                </strong>
                <span>{{ best.stops_between }} {{ labels().stopsWord }} • ~{{ best.ride_duration_min }} {{ labels().min }}</span>
              </div>
              <ul class="mini-stop-list">
                @for (stop of best.timeline_stops; track stop.stop_id + '-' + stop.stop_sequence) {
                  <li
                    class="mini-stop"
                    [class.is-bus]="stop.stop_sequence === best.bus.current_stop_sequence"
                    [class.is-origin]="stop.stop_sequence === best.origin_stop.stop_sequence"
                    [class.is-dest]="stop.stop_sequence === best.dest_stop.stop_sequence"
                  >
                    <span class="mini-dot">
                      @if (stop.stop_sequence === best.bus.current_stop_sequence) {
                        🚌
                      } @else if (stop.stop_sequence === best.origin_stop.stop_sequence) {
                        📍
                      } @else if (stop.stop_sequence === best.dest_stop.stop_sequence) {
                        🏁
                      } @else {
                        •
                      }
                    </span>
                    <span class="mini-name">
                      {{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}
                    </span>
                    <span class="mini-bus-tag">№{{ best.route.short_name }}</span>
                    <span class="mini-code">#{{ stop.stop_code }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      } @else if (state().destination; as dest) {
        <div class="intercity-notice-section" role="region" aria-label="Intercity transit note">
          <div class="top3-header">
            <h3 class="offers-title">
              <span aria-hidden="true">🚆</span>
              {{ labels().intercityTitle }}
            </h3>
            <span class="dest-addr">{{ dest.formatted_address }}</span>
          </div>
          <div class="single-best-card">
            <p class="intercity-advice-text">{{ labels().intercityAdvice }}</p>
          </div>
        </div>
      }

      @if (state().nearby_offers.length > 0) {
        <div class="offers-section">
          <h3 class="offers-title">
            <span aria-hidden="true">☕</span>
            {{ labels().offersTitle }} ({{ state().nearby_offers.length }})
          </h3>
          <div class="offers-grid">
            @for (offer of state().nearby_offers; track offer.id) {
              <article class="offer-card nb-offer-card">
                <div class="offer-top">
                  <strong class="offer-name">
                    {{ lang() === 'he' ? offer.name_he : offer.name }}
                  </strong>
                  <span class="offer-dist">
                    {{ offer.walk_minutes }} {{ labels().min }} • {{ offer.distance_meters }} m
                  </span>
                </div>
                <p class="offer-promo">{{ offer.promo }}</p>
                @if (offer.maps_url) {
                  <a
                    class="offer-link"
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
      .interactive-card {
        color-scheme: only dark;
        background: #0b1220;
        color: #f8fafc;
        accent-color: #34d399;
        border: 1px solid #2b3c5d;
        border-radius: 1rem;
        padding-block: 1.15rem;
        padding-inline: 1.15rem;
        display: grid;
        gap: 0.95rem;
        inline-size: 100%;
        min-inline-size: 0;
      }

      .interactive-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .interactive-route {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-inline-size: 0;
        flex: 1 1 260px;
      }

      .route-badge-sm {
        display: grid;
        place-items: center;
        min-inline-size: 3rem;
        padding-inline: 0.45rem;
        block-size: 3rem;
        flex-shrink: 0;
        border-radius: 0.75rem;
        background: #10b981;
        color: #041322;
        font-size: 1.25rem;
        font-weight: 800;
      }

      .route-badge-sm.is-transfer {
        background: #f59e0b;
        font-size: 1rem;
      }

      .route-info {
        min-inline-size: 0;
      }

      .interactive-pill {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.72rem;
        font-weight: 700;
        color: #34d399;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .dest-tag {
        color: #fbbf24;
      }

      .interactive-title {
        margin: 0.15rem 0 0;
        font-size: 1rem;
        font-weight: 700;
      }

      .bus-current-sub {
        margin: 0.15rem 0 0;
        font-size: 0.78rem;
        color: #cbd5e1;
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }

      .eta-box-interactive {
        background: #13223b;
        border: 1.5px solid #38bdf8;
        border-radius: 0.75rem;
        padding-block: 0.45rem;
        padding-inline: 0.85rem;
        text-align: end;
      }

      .eta-val {
        display: block;
        font-size: 1.15rem;
        font-weight: 800;
        color: #38bdf8;
      }

      .eta-sub {
        display: block;
        font-size: 0.72rem;
        color: #cbd5e1;
      }

      .zoom-controls {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }

      .ctrl-btn {
        background: #131e33;
        color: #f8fafc;
        border: 1px solid #38bdf8;
        border-radius: 0.5rem;
        min-inline-size: 2.2rem;
        block-size: 2.2rem;
        font-weight: 700;
        cursor: pointer;
      }

      .map-viewport {
        overflow: hidden;
        border-radius: 0.875rem;
        border: 1px solid #2b3c5d;
        background: #071524;
        inline-size: 100%;
        min-inline-size: 0;
      }

      .leaflet-host {
        inline-size: 100%;
        block-size: 320px;
        z-index: 1;
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
        background: #fbbf24;
        color: #0b1220;
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
        color: #041322;
        font-weight: 800;
        font-size: 12px;
        border: 2px solid #ffffff;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.55);
        white-space: nowrap;
      }

      .nb-pin-bus-pill.is-primary {
        transform: scale(1.08);
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.45), 0 4px 12px rgba(0, 0, 0, 0.6);
      }

      .nb-pin-cafe {
        background: #34d399;
        color: #041322;
      }

      .map-hud {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem;
        padding-block: 0.55rem;
        padding-inline: 0.85rem;
        background: #101b2e;
        border-block-start: 1px solid #24344f;
        font-size: 0.8125rem;
        color: #e2e8f0;
      }

      .best-route-section {
        display: grid;
        gap: 0.7rem;
      }

      .top3-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
      }

      .dest-addr {
        font-size: 0.76rem;
        color: #94a3b8;
      }

      .single-best-card {
        background: #14223a;
        color: #f8fafc;
        border: 1.5px solid #34d399;
        border-radius: 0.85rem;
        padding-block: 0.8rem;
        padding-inline: 0.9rem;
        display: grid;
        gap: 0.45rem;
      }

      .top3-card-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }

      .line-pill {
        color: #041322;
        font-size: 0.88rem;
        font-weight: 800;
        border-radius: 0.45rem;
        padding-block: 0.22rem;
        padding-inline: 0.6rem;
      }

      .head-badges {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .transfer-badge {
        font-size: 0.7rem;
        font-weight: 700;
        color: #fcd34d;
        background: rgba(245, 158, 11, 0.16);
        border: 1px solid #f59e0b;
        border-radius: 999px;
        padding-block: 0.1rem;
        padding-inline: 0.48rem;
      }

      .fastest-badge {
        font-size: 0.7rem;
        font-weight: 700;
        color: #34d399;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid #10b981;
        border-radius: 999px;
        padding-block: 0.12rem;
        padding-inline: 0.5rem;
      }

      .top3-boarding {
        font-size: 0.84rem;
        color: #e2e8f0;
      }

      .transfer-summary {
        margin-block-start: 0.35rem;
        font-size: 0.78rem;
        line-height: 1.4;
        color: #fde68a;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.38);
        border-radius: 0.45rem;
        padding-block: 0.35rem;
        padding-inline: 0.55rem;
      }

      .top3-total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.4rem;
        font-size: 0.82rem;
        color: #7dd3fc;
        border-block-start: 1px solid #24344f;
        padding-block-start: 0.4rem;
      }

      .total-mins {
        color: #34d399;
        font-weight: 700;
      }

      .intercity-notice-section {
        display: grid;
        gap: 0.65rem;
      }

      .intercity-advice-text {
        font-size: 0.88rem;
        line-height: 1.5;
        color: #fde68a;
        margin: 0;
      }

      .selected-timeline-box {
        background: #0e182b;
        border: 1px solid #24344f;
        border-radius: 0.75rem;
        padding-block: 0.7rem;
        padding-inline: 0.85rem;
        display: grid;
        gap: 0.55rem;
      }

      .transfer-itinerary {
        display: grid;
        gap: 0.65rem;
      }

      .itinerary-step {
        display: grid;
        gap: 0.4rem;
      }

      .transfer-hub-banner {
        background: #1d1a0d;
        border: 1px solid #f59e0b;
        border-radius: 0.65rem;
        padding-block: 0.5rem;
        padding-inline: 0.75rem;
        display: grid;
        gap: 0.25rem;
      }

      .hub-title {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        font-weight: 800;
        color: #fcd34d;
      }

      .hub-meta {
        font-size: 0.74rem;
        font-weight: 600;
        color: #fde68a;
      }

      .hub-instruction {
        margin: 0;
        font-size: 0.8rem;
        color: #f8fafc;
      }

      .timeline-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .mini-stop-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .mini-stop {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.74rem;
        color: #cbd5e1;
        background: #131e33;
        border: 1px solid #24344f;
        border-radius: 0.45rem;
        padding-block: 0.22rem;
        padding-inline: 0.48rem;
      }

      .mini-stop.is-bus {
        border-color: #38bdf8;
        color: #7dd3fc;
      }

      .mini-stop.is-origin {
        border-color: #fbbf24;
        color: #fde68a;
      }

      .mini-stop.is-xfer {
        border-color: #f59e0b;
        color: #fde68a;
      }

      .mini-stop.is-dest {
        border-color: #ef4444;
        color: #fca5a5;
      }

      .mini-bus-tag {
        background: #1e3254;
        color: #7dd3fc;
        border-radius: 0.28rem;
        padding-inline: 0.3rem;
        font-size: 0.68rem;
        font-weight: 700;
      }

      .mini-bus-tag.is-leg2 {
        background: #33260f;
        color: #fcd34d;
      }

      .mini-code {
        color: #94a3b8;
        font-size: 0.68rem;
      }

      .offers-section {
        display: grid;
        gap: 0.65rem;
      }

      .offers-title {
        margin: 0;
        font-size: 0.95rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .offers-empty {
        margin: 0;
        font-size: 0.85rem;
        color: #94a3b8;
      }

      .offers-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
        gap: 0.75rem;
      }

      .offer-card {
        background: #131e33;
        border: 1px solid #2b3c5d;
        border-radius: 0.75rem;
        padding-block: 0.75rem;
        padding-inline: 0.875rem;
        display: grid;
        gap: 0.35rem;
      }

      .offer-top {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
      }

      .offer-name {
        font-size: 0.875rem;
        color: #f8fafc;
      }

      .offer-dist {
        font-size: 0.75rem;
        color: #34d399;
        font-weight: 600;
        flex-shrink: 0;
      }

      .offer-promo {
        margin: 0;
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .offer-link {
        font-size: 0.78rem;
        font-weight: 600;
        color: #7dd3fc;
        text-decoration: none;
      }

      .offer-link:hover {
        text-decoration: underline;
      }
    `
  ]
})
export class InteractiveMapViewComponent implements AfterViewInit, OnDestroy {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('ru');

  readonly switchDirection = output<0 | 1>();

  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private busLayer: L.LayerGroup | null = null;
  private busMarkers = new Map<string, { marker: L.Marker; iconSig: string }>();
  private lastFitSignature = '';

  readonly bestOption = computed<RecommendedBusOption | null>(
    () => this.state().recommended_options?.[0] ?? null
  );

  readonly activeDisplayRoute = computed(
    () => this.bestOption()?.route ?? this.state().route
  );

  readonly activeOriginStop = computed(
    () => this.bestOption()?.origin_stop ?? this.state().user_stop
  );

  readonly activeBus = computed(
    () => this.bestOption()?.bus ?? this.state().nearest_bus
  );

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          badge: 'מפה והמסלול המהיר ביותר • @defer',
          routeLabel: 'קו',
          tripTo: 'מסלול ליעד:',
          busNowAt: 'האוטובוס כעת',
          nearestStop: 'תחנת עלייה',
          recenter: 'מרכז מסלול',
          fastestTitle: 'המסלול המהיר ביותר',
          fastest: 'הכי מהיר',
          transferBadge: 'החלפה',
          firstBus: 'אוטובוס ראשון',
          exitAt: 'לרדת ב-',
          atStop: 'בתחנה',
          boardNewBus: 'לאוטובוס החדש',
          boardAt: 'ב-',
          transferHereTitle: 'החלפת אוטובוס (איפה ומתי לרדת)',
          waitWord: 'המתנה',
          lineWord: 'קו',
          routeWord: 'מסלול קו',
          arrivesIn: 'מגיע אליך בעוד',
          arriveAt: 'הגעה ביעד ב-',
          total: 'סה"כ',
          stopsWord: 'תחנות',
          offersTitle: 'בתי קפה אמיתיים בסביבה',
          noOffers: 'לא נמצאו בתי קפה בקרבת מקום.',
          min: 'דק׳',
          openMaps: 'פתח במפות',
          intercityTitle: 'נסיעה בין-עירונית / אזור מרוחק',
          intercityAdvice: 'היעד המבוקש נמצא מחוץ לאזור התחבורה העירונית המקומית. מומלץ לנסוע לקו אקספרס 910/900 או לרכבת ישראל מתחנת מרכזית חוף הכרמל (מת״מ).'
        };
      case 'en':
        return {
          badge: 'Map & Fastest Route • @defer',
          routeLabel: 'Line',
          tripTo: 'Fastest route to',
          busNowAt: 'Bus now at',
          nearestStop: 'Boarding stop',
          recenter: 'Center route',
          fastestTitle: 'Fastest Route',
          fastest: 'Fastest',
          transferBadge: 'Transfer',
          firstBus: '1st Bus',
          exitAt: 'Exit at',
          atStop: 'at',
          boardNewBus: 'new bus',
          boardAt: 'at',
          transferHereTitle: 'Transfer Point (Where & When to Change)',
          waitWord: 'Wait',
          lineWord: 'Line',
          routeWord: 'Line',
          arrivesIn: 'Arrives in',
          arriveAt: 'Arrive at',
          total: 'total',
          stopsWord: 'stops',
          offersTitle: 'Real Cafes Nearby (OpenStreetMap)',
          noOffers: 'No nearby cafes found.',
          min: 'min',
          openMaps: 'Open in Maps',
          intercityTitle: 'Intercity Trip / Destination Outside Area',
          intercityAdvice: 'Destination is outside the local city transit network. We recommend taking Express Line 910/900 or Israel Railways from Hof HaCarmel Central Station.'
        };
      default:
        return {
          badge: 'Карта и самый быстрый маршрут • @defer',
          routeLabel: 'Маршрут',
          tripTo: 'Куда едем:',
          busNowAt: 'Автобус сейчас',
          nearestStop: 'Остановка посадки',
          recenter: 'Центрировать маршрут',
          fastestTitle: 'Самый быстрый маршрут',
          fastest: 'Самый быстрый',
          transferBadge: 'Пересадка',
          firstBus: '1-й авт.',
          exitAt: 'Выйти в',
          atStop: 'на ост.',
          boardNewBus: 'новый авт.',
          boardAt: 'в',
          transferHereTitle: 'Где и когда сделать пересадку',
          waitWord: 'ожидание',
          lineWord: 'Маршрут',
          routeWord: 'Линия',
          arrivesIn: 'Прибудет к вам через',
          arriveAt: 'Будете на месте в',
          total: 'всего',
          stopsWord: 'ост.',
          offersTitle: 'Настоящие кафе рядом (OpenStreetMap)',
          noOffers: 'Кафе поблизости не найдены.',
          min: 'мин',
          openMaps: 'Открыть на карте',
          intercityTitle: 'Междугородний маршрут / Другой регион',
          intercityAdvice: 'Пункт назначения находится за пределами местной городской сети. Рекомендуем сесть на междугородний экспресс №910/900 или поезд со станции Хоф ха-Кармель (МАТАМ).'
        };
    }
  });

  readonly etaText = computed(() => {
    const eta = this.activeBus()?.eta_minutes;
    if (eta === undefined) {
      return this.lang() === 'he' ? 'אין נתונים' : this.lang() === 'en' ? 'No ETA' : 'Нет данных';
    }
    if (eta === 0) {
      return this.lang() === 'he' ? 'בתחנה' : this.lang() === 'en' ? 'Arriving' : 'Прибывает';
    }
    if (this.lang() === 'he') return `בעוד ${eta} דק׳`;
    if (this.lang() === 'en') return `In ${eta} min`;
    return `Через ${eta} мин`;
  });

  readonly stopsAwayText = computed(() => {
    const stops = this.activeBus()?.stops_away ?? 0;
    if (this.lang() === 'he') return `${stops} תחנות ממך`;
    if (this.lang() === 'en') return `${stops} stops away`;
    return `${stops} ост. до вас`;
  });

  constructor() {
    effect(() => {
      const currentState = this.state();
      const currentLang = this.lang();
      if (this.map && this.markersLayer) {
        this.renderMapLayers(currentState, currentLang);
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
    this.renderMapLayers(initial, this.lang());
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

  transferInstruction(
    info: NonNullable<RecommendedBusOption['transfer_info']>
  ): string {
    if (this.lang() === 'he') return info.instruction_he;
    if (this.lang() === 'en') return info.instruction_en;
    return info.instruction_ru;
  }

  recenterMap(): void {
    if (!this.map) return;
    this.lastFitSignature = '';
    this.renderMapLayers(this.state(), this.lang());
  }

  private renderMapLayers(data: LiveBusStatusResponse, lang: WidgetLang): void {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];
    const activeOpt = data.recommended_options?.[0] ?? null;

    // 1. Draw polyline & stop markers for fastest trip (Leg 1 + Leg 2 if transfer)
    const activeTimeline = activeOpt?.timeline_stops ?? data.timeline_stops;
    const originStopSeq = activeOpt?.origin_stop.stop_sequence ?? data.user_stop.stop_sequence;
    const destStopSeq = activeOpt?.is_transfer
      ? activeOpt.transfer_info?.alight_stop.stop_sequence
      : activeOpt?.dest_stop.stop_sequence;
    const activeColor = '#10b981';

    if (activeTimeline.length > 0) {
      const polyCoords: L.LatLngExpression[] = activeTimeline.map((s) => [s.lat, s.lon]);
      L.polyline(polyCoords, { color: activeColor, weight: 4.5, opacity: 0.88 }).addTo(
        this.markersLayer
      );

      for (const stop of activeTimeline) {
        const isOrigin = stop.stop_sequence === originStopSeq;
        const isEnd = destStopSeq !== undefined && stop.stop_sequence === destStopSeq;
        L.circleMarker([stop.lat, stop.lon], {
          radius: isOrigin || isEnd ? 8 : 4.5,
          color: '#041322',
          weight: 2,
          fillColor: isEnd
            ? activeOpt?.is_transfer
              ? '#f59e0b'
              : '#ef4444'
            : isOrigin
              ? '#fbbf24'
              : '#cbd5e1',
          fillOpacity: 1
        })
          .bindPopup(
            `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Line ${activeOpt?.route.short_name ?? data.route.short_name} • Stop #${stop.stop_code}`
          )
          .addTo(this.markersLayer);
      }
    }

    // 1b. If transfer route, draw Leg 2 dashed polyline, Transfer Hub marker (🔄), and walking connector
    if (activeOpt?.is_transfer && activeOpt.transfer_info && activeOpt.second_leg) {
      const xfer = activeOpt.transfer_info;
      const leg2Stops = activeOpt.second_leg.timeline_stops;
      if (leg2Stops.length > 0) {
        const leg2Coords: L.LatLngExpression[] = leg2Stops.map((s) => [s.lat, s.lon]);
        L.polyline(leg2Coords, {
          color: '#f59e0b',
          weight: 4.5,
          opacity: 0.9,
          dashArray: '8, 6'
        }).addTo(this.markersLayer);

        for (const stop of leg2Stops) {
          const isFinalDest = stop.stop_sequence === activeOpt.dest_stop.stop_sequence;
          L.circleMarker([stop.lat, stop.lon], {
            radius: isFinalDest ? 8 : 4.5,
            color: '#041322',
            weight: 2,
            fillColor: isFinalDest ? '#ef4444' : '#fde68a',
            fillOpacity: 1
          })
            .bindPopup(
              `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Line ${activeOpt.second_leg.route.short_name} • Stop #${stop.stop_code}`
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
      L.marker(hubPos, { icon: hubIcon })
        .bindPopup(
          `<strong>🔄 ${lang === 'he' ? xfer.alight_stop.stop_name_he : xfer.alight_stop.stop_name}</strong> (#${xfer.alight_stop.stop_code})<br/>${this.transferInstruction(xfer)}`
        )
        .addTo(this.markersLayer);
    }

    // 2. User Position (Point A)
    if (data.user_location) {
      const userPos: L.LatLngExpression = [data.user_location.lat, data.user_location.lon];
      boundsPoints.push(userPos);
      const userIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-user">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker(userPos, { icon: userIcon })
        .bindPopup(
          `<strong>Point A (Your GPS)</strong><br/>${data.user_location.lat.toFixed(5)}, ${data.user_location.lon.toFixed(5)}`
        )
        .addTo(this.markersLayer);
    }

    // 3. Destination Marker (Point B)
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

    // 4. Live Bus Marker(s) for single fastest route (Leg 1 + Leg 2 if transfer)
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
        key: `${activeOpt.route.route_id}:${activeOpt.bus.vehicle_id}`,
        lat: activeOpt.bus.lat,
        lon: activeOpt.bus.lon,
        shortName: activeOpt.route.short_name,
        color: '#10b981',
        isPrimary: true,
        popupHtml:
          `<strong>Bus ${activeOpt.route.short_name}</strong><br/>` +
          `ETA: ${activeOpt.eta_to_boarding_min} min • Arrive ${activeOpt.estimated_arrival_time}`
      });
      if (activeOpt.is_transfer && activeOpt.second_leg) {
        busEntries.push({
          key: `leg2:${activeOpt.second_leg.route.route_id}:${activeOpt.second_leg.bus.vehicle_id}`,
          lat: activeOpt.second_leg.bus.lat,
          lon: activeOpt.second_leg.bus.lon,
          shortName: `${activeOpt.second_leg.route.short_name} (2)`,
          color: '#f59e0b',
          isPrimary: true,
          popupHtml:
            `<strong>2nd Bus ${activeOpt.second_leg.route.short_name}</strong><br/>` +
            `Board at ${activeOpt.transfer_info?.next_bus_board_time ?? ''}`
        });
      }
    } else if (data.nearest_bus) {
      busEntries.push({
        key: `${data.route.route_id}:${data.nearest_bus.vehicle_id}`,
        lat: data.nearest_bus.lat,
        lon: data.nearest_bus.lon,
        shortName: data.route.short_name,
        color: '#38bdf8',
        isPrimary: true,
        popupHtml: `<strong>Bus ${data.route.short_name}</strong> (${data.nearest_bus.vehicle_id})<br/>ETA: ${data.nearest_bus.eta_minutes} min`
      });
    }

    for (const item of busEntries) {
      activeBusKeys.add(item.key);
      const busPos: L.LatLngExpression = [item.lat, item.lon];
      boundsPoints.push(busPos);
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

    // 5. Real Cafes
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

    const fitSignature = data.destination
      ? `${data.destination.lat.toFixed(4)},${data.destination.lon.toFixed(4)}:${activeOpt?.route.route_id ?? ''}`
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
      html: `<div class="nb-pin-bus-pill ${isPrimary ? 'is-primary' : ''}" style="background:${color}">🚌 ${shortName}</div>`,
      iconSize: [width, 26],
      iconAnchor: [Math.round(width / 2), 13]
    });
  }
}

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal
} from '@angular/core';
import type {
  LineCandidate,
  LiveBusStatusResponse,
  RecommendedBusOption,
  StopTimelineItem,
  TripOption,
  WidgetLang
} from '../../models/bus.models';

@Component({
  selector: 'nb-lite-timeline-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="minimal-card-body"
      [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'"
      aria-label="Minimalist live bus status and stop timeline"
    >
      <!-- 1. Redesigned Unified Route & Arrival Hero Card -->
      <header class="hero-metrics">
        <div class="hero-route-group">
          <div class="hero-line-badge" [class.is-compact]="heroRouteDisplay().length > 4">
            <span aria-hidden="true">🚌</span>
            <span>{{ heroRouteDisplay() }}</span>
          </div>
          <div class="hero-route-meta">
            <span class="metric-caption">{{ labels().busRoute }}</span>
            @if (activeBus()) {
              <div
                class="eta-freshness-pill"
                [class.is-realtime]="!isScheduledEta()"
                [class.is-scheduled]="isScheduledEta()"
              >
                <span class="eta-dot" aria-hidden="true"></span>
                <span>{{ etaStatusText() }}</span>
              </div>
            }
          </div>
        </div>

        <div class="hero-eta-box" role="status" aria-live="polite">
          <div class="metric-main">
            <span>{{ etaDigits() }}</span>
            @if (etaUnit()) {
              <span class="metric-unit">{{ etaUnit() }}</span>
            }
          </div>
          <div class="metric-caption">{{ labels().arrivalCountdown }}</div>
        </div>
      </header>

      <!-- 2. Clear Route Start & End Endpoints Card (Street / City) with Reverse Button -->
      @if (state().destination || activeRoute().available_directions.length > 1 || activeTimelineStops().length > 1) {
        <div class="direction-bar">
          <div class="dir-endpoints">
            <div class="dir-point-row">
              <span class="dir-point-tag is-start">{{ labels().fromWord }}</span>
              <span class="dir-point-text" dir="auto">{{ directionStartText() }}</span>
            </div>
            <div class="dir-point-row">
              <span class="dir-point-tag is-end">{{ labels().toWord }}</span>
              <span class="dir-point-text" dir="auto">{{ directionEndText() }}</span>
            </div>
          </div>
          <button
            type="button"
            class="direction-switch-btn"
            (click)="state().destination ? reverseTrip.emit() : onSwitchDirection()"
            [title]="state().destination ? labels().reverseRoute : labels().switchDir"
            [attr.aria-label]="state().destination ? labels().reverseRoute : labels().switchDir"
          >
            <span aria-hidden="true">⇄</span>
            <span>{{ state().destination ? labels().reverseRoute : labels().switchDir }}</span>
          </button>
        </div>
      }

      <!-- 3. Multi-Stop Trip Variant Switcher (Option 1 / 2 / 3 with boarding stop & walk distance) -->
      @if (state().destination && recommendedOptions().length > 1) {
        <div class="variant-switcher" role="tablist" [attr.aria-label]="labels().variantsAria">
          @for (opt of recommendedOptions(); track opt.route.route_id + '-' + opt.origin_stop.stop_id + '-' + $index; let idx = $index) {
            <button
              type="button"
              role="tab"
              class="variant-tab"
              [class.is-active]="clampedOptionIndex() === idx"
              [attr.aria-selected]="clampedOptionIndex() === idx"
              (click)="selectOptionIndex.emit(idx)"
            >
              <div class="var-top">
                <span class="var-rank">{{ labels().optionWord }} {{ opt.rank }}</span>
                <span class="var-route">🚌 {{ formatOptionRoute(opt) }}</span>
                <span class="var-time">{{ opt.total_arrival_min }} {{ labels().minShort }}</span>
              </div>
              <div class="var-bottom" dir="auto">
                <span class="var-stop">
                  📍 {{ cleanStopName(lang() === 'he' ? opt.origin_stop.stop_name_he : opt.origin_stop.stop_name) }}
                </span>
                @if (opt.origin_stop.distance_meters !== undefined) {
                  <span class="var-walk">• 🚶 {{ opt.origin_stop.distance_meters }} m</span>
                }
              </div>
            </button>
          }
        </div>
      }

      <!-- 3b. Concise Destination & Multi-Leg Transfer Strip -->
      @if (tripOptions().length > 0) {
        @if (activeTripOption(); as trip) {
          @if (trip.transfers_count > 0 || state().destination) {
            <div class="trip-summary-strip">
              <div class="trip-dest-row">
                <span class="dest-label">🏁 {{ state().destination?.place_name }}</span>
                <span class="dest-eta">{{ trip.estimated_arrival_time }}</span>
              </div>

              @if (trip.transfers_count > 0) {
                <ol class="transfer-legs-compact">
                  @for (leg of trip.legs; track leg.route_id + '-' + $index; let idx = $index) {
                    <li class="xfer-row" [class.is-xfer]="leg.leg_type === 'TRANSFER'">
                      <span class="xfer-badge">
                        {{ leg.leg_type === 'TRANSFER' ? '🔄' : '🚌' }} {{ leg.line_number }}
                      </span>
                      <span class="xfer-desc">
                        {{ lang() === 'he' ? leg.board_stop.stop_name_he : leg.board_stop.stop_name }}
                        ➔
                        {{ lang() === 'he' ? leg.alight_stop.stop_name_he : leg.alight_stop.stop_name }}
                        @if (leg.leg_type === 'TRANSFER' && leg.transfer_wait_min !== undefined) {
                          ({{ labels().waitWord }} {{ leg.transfer_wait_min }} {{ labels().minShort }})
                        }
                      </span>
                    </li>
                  }
                </ol>
              }
            </div>
          }
        }
      }

      <!-- 4. Vertical Dashed Blue Timeline with Glowing Active Stop & "Near You" Pin -->
      <div class="timeline-wrapper" role="region" aria-label="Stops progression">
        <!-- Top "Near You" Marker Row -->
        <div class="tl-row tl-pin-row">
          <div class="tl-rail">
            <span class="rail-line rail-top is-faint"></span>
            <span class="dot-muted"></span>
            <span class="rail-line rail-bottom is-blue"></span>
          </div>
          <div class="tl-content pin-content">
            <span class="blue-pin" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="#3b82f6">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/>
              </svg>
            </span>
            <span class="near-you-label">{{ labels().nearYou }}</span>
            @if (activeUserStop().distance_meters !== undefined) {
              <span class="near-dist">{{ activeUserStop().distance_meters }} m</span>
            }
          </div>
        </div>

        <!-- Stop Nodes -->
        @for (stop of visibleTimelineStops(); track stop.stop_id + '-' + stop.stop_sequence; let idx = $index; let last = $last) {
          @let tier = stopTier(idx, stop);
          <div class="tl-row" [class.is-focus-row]="tier === 'active'">
            <div class="tl-rail">
              <span class="rail-line rail-top" [class.is-blue]="!isTopFade(idx)" [class.is-faint]="isTopFade(idx)"></span>
              <span
                class="tl-node"
                [class.node-muted]="tier === 'outer'"
                [class.node-white]="tier === 'adjacent'"
                [class.node-active]="tier === 'active'"
              ></span>
              <span
                class="rail-line rail-bottom"
                [class.is-blue]="!last && !isBottomFade(idx)"
                [class.is-faint]="last || isBottomFade(idx)"
              ></span>
            </div>

            <div class="tl-content">
              <span
                class="stop-label"
                [class.text-muted]="tier === 'outer'"
                [class.text-adjacent]="tier === 'adjacent'"
                [class.text-active]="tier === 'active'"
                dir="auto"
              >
                {{ cleanStopName(lang() === 'he' ? stop.stop_name_he : stop.stop_name) }}
              </span>

              @if (activeBusSequence() !== undefined && stop.stop_sequence === activeBusSequence()) {
                <span class="live-bus-tag" [title]="labels().busHere">🚌</span>
              }
            </div>
          </div>
        }

        <!-- Bottom subtle fade cap row -->
        <div class="tl-row tl-cap-row">
          <div class="tl-rail">
            <span class="rail-line rail-top is-faint"></span>
            <span class="dot-muted"></span>
          </div>
          <div class="tl-content cap-content">
            @if (canExpandStops()) {
              <button
                type="button"
                class="expand-link"
                (click)="showAllStops.set(!showAllStops())"
              >
                {{
                  showAllStops()
                    ? labels().collapse
                    : labels().moreStops + ' (' + totalStopsCount() + ')'
                }}
              </button>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .minimal-card-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 1.15rem;
        padding-block: 0.35rem 0.25rem;
      }

      /* 1. Unified Hero Summary Card */
      .hero-metrics {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        padding: 0.75rem 0.9rem;
        border-radius: 1.15rem;
        background: linear-gradient(135deg, rgba(30, 41, 59, 0.78), rgba(15, 23, 34, 0.88));
        border: 1px solid rgba(96, 165, 250, 0.24);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }

      .hero-route-group {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        flex: 1 1 auto;
        min-inline-size: 0;
      }

      .hero-line-badge {
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

      .hero-line-badge.is-compact {
        font-size: clamp(1rem, 4.2vw, 1.3rem);
        padding: 0.45rem 0.6rem;
      }

      .hero-route-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
        min-inline-size: 0;
      }

      .hero-eta-box {
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

      .metric-main {
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

      .metric-unit {
        font-size: clamp(0.78rem, 3vw, 0.96rem);
        font-weight: 700;
        margin-inline-start: 0.2rem;
        color: #93c5fd;
        letter-spacing: 0.02em;
      }

      .metric-caption {
        font-size: 0.72rem;
        color: #94a3b8;
        font-weight: 500;
        max-inline-size: 100%;
        white-space: nowrap;
      }

      .eta-freshness-pill {
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

      .eta-freshness-pill.is-realtime {
        background: rgba(34, 197, 94, 0.14);
        color: #86efac;
        border: 1px solid rgba(34, 197, 94, 0.35);
      }

      .eta-freshness-pill.is-scheduled {
        background: rgba(245, 158, 11, 0.14);
        color: #fde68a;
        border: 1px solid rgba(245, 158, 11, 0.35);
      }

      .eta-dot {
        inline-size: 6px;
        block-size: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        background: currentColor;
      }

      /* 2. Clear Route Start / End Card */
      .direction-bar {
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

      .dir-endpoints {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.28rem;
        flex: 1 1 180px;
        min-inline-size: 0;
      }

      .dir-point-row {
        display: flex;
        align-items: baseline;
        gap: 0.4rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .dir-point-tag {
        font-size: 0.66rem;
        font-weight: 700;
        padding: 0.08rem 0.42rem;
        border-radius: 999px;
        flex-shrink: 0;
        letter-spacing: 0.02em;
      }

      .dir-point-tag.is-start {
        background: rgba(59, 130, 246, 0.18);
        color: #93c5fd;
        border: 1px solid rgba(59, 130, 246, 0.35);
      }

      .dir-point-tag.is-end {
        background: rgba(16, 185, 129, 0.16);
        color: #6ee7b7;
        border: 1px solid rgba(16, 185, 129, 0.35);
      }

      .dir-point-text {
        font-size: 0.78rem;
        font-weight: 600;
        color: #e2e8f0;
        line-height: 1.25;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .direction-switch-btn {
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

      .direction-switch-btn:hover {
        background: #3087f6;
        border-color: #3087f6;
        color: #ffffff;
      }

      /* 3. Multi-Stop Trip Variant Switcher (Option 1 / 2 / 3) */
      .variant-switcher {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.4rem;
      }

      .variant-tab {
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

      .variant-tab:hover {
        border-color: rgba(59, 130, 246, 0.55);
        background: rgba(48, 135, 246, 0.1);
      }

      .variant-tab.is-active {
        background: rgba(48, 135, 246, 0.2);
        border-color: #3087f6;
        color: #ffffff;
        box-shadow: 0 0 0 1px rgba(48, 135, 246, 0.25);
      }

      .var-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.4rem;
        min-inline-size: 0;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .var-rank {
        color: #93c5fd;
      }

      .variant-tab.is-active .var-rank {
        color: #ffffff;
      }

      .var-route {
        background: rgba(255, 255, 255, 0.08);
        padding: 0.08rem 0.45rem;
        border-radius: 999px;
        font-size: 0.73rem;
      }

      .variant-tab.is-active .var-route {
        background: #3087f6;
        color: #ffffff;
      }

      .var-time {
        color: #7dd3fc;
        font-weight: 700;
        margin-inline-start: auto;
      }

      .var-bottom {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        font-size: 0.72rem;
        color: #9aa6b4;
      }

      .variant-tab.is-active .var-bottom {
        color: #dbeafe;
      }

      .var-stop {
        flex: 1 1 auto;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .var-walk {
        color: #93c5fd;
        flex-shrink: 0;
      }

      /* 3. Compact Transfer / Destination Strip */
      .trip-summary-strip {
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

      .trip-dest-row {
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

      .dest-eta {
        color: #60a5fa;
        font-weight: 700;
        flex-shrink: 0;
      }

      .transfer-legs-compact {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0.32rem;
      }

      .xfer-row {
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        min-inline-size: 0;
        font-size: 0.75rem;
        color: #cbd5e1;
      }

      .xfer-desc {
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }

      .xfer-badge {
        background: rgba(59, 130, 246, 0.18);
        color: #93c5fd;
        border-radius: 0.4rem;
        padding: 0.08rem 0.4rem;
        font-weight: 700;
        flex-shrink: 0;
      }

      .xfer-row.is-xfer .xfer-badge {
        background: rgba(245, 158, 11, 0.2);
        color: #fcd34d;
      }

      /* 4. Minimalist Dashed Blue Vertical Timeline */
      .timeline-wrapper {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        padding-inline-start: 0.25rem;
      }

      .tl-row {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        align-items: center;
        min-block-size: 2.35rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.65rem;
      }

      .tl-row.is-focus-row {
        min-block-size: 2.85rem;
      }

      .tl-pin-row {
        min-block-size: 2.1rem;
      }

      .tl-cap-row {
        min-block-size: 1.5rem;
      }

      .tl-rail {
        position: relative;
        align-self: stretch;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .rail-line {
        position: absolute;
        inset-inline-start: 50%;
        transform: translateX(-50%);
        inline-size: 0;
        border-inline-start: 2.5px dashed #3b82f6;
      }

      [dir='rtl'] .rail-line {
        transform: translateX(50%);
      }

      .rail-top {
        top: 0;
        bottom: 50%;
      }

      .rail-bottom {
        top: 50%;
        bottom: 0;
      }

      .rail-line.is-faint {
        border-inline-start-color: rgba(120, 134, 150, 0.45);
      }

      .rail-line.is-blue {
        border-inline-start-color: #2d7ff9;
      }

      .tl-node,
      .dot-muted {
        position: relative;
        z-index: 2;
        border-radius: 50%;
        display: block;
      }

      .dot-muted,
      .node-muted {
        inline-size: 8px;
        block-size: 8px;
        background: #5c6674;
      }

      .node-white {
        inline-size: 10px;
        block-size: 10px;
        background: #f1f5f9;
      }

      .node-active {
        inline-size: 17px;
        block-size: 17px;
        background: #ffffff;
        box-shadow:
          0 0 0 6px rgba(59, 130, 246, 0.25),
          0 0 18px rgba(59, 130, 246, 0.72);
      }

      .tl-content {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
      }

      .pin-content {
        gap: 0.45rem;
      }

      .blue-pin {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
      }

      .near-you-label {
        font-size: 0.96rem;
        font-weight: 600;
        color: #f8fafc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .near-dist {
        font-size: 0.74rem;
        color: #8b96a5;
        flex-shrink: 0;
      }

      .dir-mini-btn {
        margin-inline-start: auto;
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        padding: 0.15rem 0.5rem;
        font-size: 0.75rem;
        cursor: pointer;
      }

      .dir-mini-btn:hover {
        background: rgba(59, 130, 246, 0.25);
        color: #ffffff;
      }

      .stop-label {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stop-label::-webkit-scrollbar {
        display: none;
      }

      .text-muted {
        font-size: clamp(0.86rem, 3.5vw, 0.96rem);
        color: #7c8796;
        font-weight: 400;
      }

      .text-adjacent {
        font-size: clamp(0.92rem, 3.8vw, 1.03rem);
        color: #dbe2ea;
        font-weight: 500;
      }

      .text-active {
        font-size: clamp(1.05rem, 4.5vw, 1.24rem);
        color: #ffffff;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .live-bus-tag {
        font-size: 0.95rem;
        flex-shrink: 0;
      }

      .expand-link {
        background: transparent;
        border: none;
        padding: 0.1rem 0;
        color: #60a5fa;
        font-size: 0.76rem;
        font-weight: 600;
        cursor: pointer;
      }

      .expand-link:hover {
        text-decoration: underline;
      }
    `
  ]
})
export class LiteTimelineViewComponent {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('he');
  readonly selectedOptionIndex = input<number>(0);
  readonly isTripReversed = input<boolean>(false);
  readonly originLabel = input<string>('');
  readonly targetLabel = input<string>('');
  readonly selectOptionIndex = output<number>();
  readonly switchDirection = output<0 | 1>();
  readonly reverseTrip = output<void>();
  readonly selectCandidate = output<LineCandidate>();
  readonly openMap = output<void>();

  readonly showAllStops = signal<boolean>(false);

  constructor() {
    effect(() => {
      void this.state().route.route_id;
      void this.state().destination?.place_name;
      this.showAllStops.set(false);
    });
  }

  readonly tripOptions = computed<TripOption[]>(() => this.state().trip_options ?? []);
  readonly recommendedOptions = computed<RecommendedBusOption[]>(
    () => this.state().recommended_options ?? []
  );

  readonly clampedOptionIndex = computed(() => {
    const len = Math.max(this.recommendedOptions().length, this.tripOptions().length);
    if (len === 0) return 0;
    return Math.min(Math.max(0, this.selectedOptionIndex()), len - 1);
  });

  readonly activeTripOption = computed<TripOption | null>(() => {
    const opts = this.tripOptions();
    if (opts.length === 0) return null;
    return opts[this.clampedOptionIndex()] ?? opts[0];
  });

  readonly activeRecOption = computed(() => {
    const opts = this.recommendedOptions();
    if (opts.length === 0) return null;
    return opts[this.clampedOptionIndex()] ?? opts[0];
  });

  readonly activeRoute = computed(() => this.activeRecOption()?.route ?? this.state().route);
  readonly activeUserStop = computed(() => this.activeRecOption()?.origin_stop ?? this.state().user_stop);
  readonly activeBus = computed(() => this.activeRecOption()?.bus ?? this.state().nearest_bus);

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
        ? this.activeUserStop().stop_name_he
        : this.activeUserStop().stop_name;
      const startPoint =
        this.formatClearEndpoint(stopRaw) || this.cleanStopName(this.originLabel() || '📍');
      const destStop = this.activeRecOption()?.dest_stop;
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

    const stops = this.activeTimelineStops();
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

    const route = this.activeRoute();
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

  formatOptionRoute(opt: RecommendedBusOption): string {
    if (opt.is_transfer && opt.second_leg) {
      if (opt.third_leg) {
        return `${opt.route.short_name}→${opt.second_leg.route.short_name}→${opt.third_leg.route.short_name}`;
      }
      return `${opt.route.short_name}→${opt.second_leg.route.short_name}`;
    }
    return opt.route.short_name;
  }

  readonly heroRouteDisplay = computed(() => {
    const base = this.activeRoute().short_name || '—';
    const trip = this.activeTripOption();
    if (trip && trip.transfers_count > 0 && trip.legs.length > 1) {
      return trip.legs.map((l) => l.line_number).join('→');
    }
    const rec = this.activeRecOption();
    if (rec?.is_transfer && rec.second_leg) {
      return this.formatOptionRoute(rec);
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

  readonly activeTimelineStops = computed<StopTimelineItem[]>(
    () => this.activeRecOption()?.timeline_stops ?? this.state().timeline_stops
  );

  readonly activeTimelineWindow = computed(
    () => this.activeRecOption()?.timeline_window ?? this.state().timeline_window ?? null
  );

  readonly activeBusSequence = computed(() => this.activeBus()?.current_stop_sequence);

  readonly visibleTimelineStops = computed<StopTimelineItem[]>(() => {
    const full = this.activeTimelineStops();
    if (this.showAllStops()) return full;
    const win = this.activeTimelineWindow();
    if (win && win.compact_stops.length > 0) {
      // Keep window tight around 5 stops for the minimalist card look
      return win.compact_stops.slice(0, 6);
    }
    return full.slice(0, 5);
  });

  readonly focusIndex = computed(() => {
    const stops = this.visibleTimelineStops();
    const userSeq = this.activeUserStop().stop_sequence;
    const idx = stops.findIndex((s) => s.stop_sequence === userSeq);
    if (idx !== -1) return idx;
    const busSeq = this.activeBusSequence();
    if (busSeq !== undefined) {
      const bIdx = stops.findIndex((s) => s.stop_sequence === busSeq);
      if (bIdx !== -1) return bIdx;
    }
    return Math.floor(stops.length / 2);
  });

  readonly totalStopsCount = computed(
    () => this.activeTimelineWindow()?.total_stops_count ?? this.activeTimelineStops().length
  );

  readonly canExpandStops = computed(
    () =>
      this.totalStopsCount() >
      (this.showAllStops() ? 0 : this.visibleTimelineStops().length)
  );

  stopTier(idx: number, stop: StopTimelineItem): 'active' | 'adjacent' | 'outer' {
    const fIdx = this.focusIndex();
    if (stop.stop_sequence === this.activeUserStop().stop_sequence || idx === fIdx) {
      return 'active';
    }
    if (Math.abs(idx - fIdx) === 1) {
      return 'adjacent';
    }
    return 'outer';
  }

  isTopFade(idx: number): boolean {
    return idx === 0;
  }

  isBottomFade(idx: number): boolean {
    return idx >= this.visibleTimelineStops().length - 1;
  }

  cleanStopName(name: string): string {
    return name.replace(/\s*\([^)]+\)\s*$/, '').trim() || name;
  }

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          busRoute: 'קו אוטובוס',
          arrivalCountdown: 'זמן הגעה',
          nearYou: 'קרוב אליך',
          switchDir: 'החלף כיוון',
          reverseRoute: 'מסלול הפוך',
          optionWord: 'אפשרות',
          variantsAria: 'בחר אפשרות נסיעה',
          minShort: 'דק׳',
          waitWord: 'המתנה',
          moreStops: 'כל התחנות',
          collapse: 'צמצם',
          busHere: 'האוטובוס כאן',
          scheduledEta: 'לפי לו״ז',
          secShort: 'ש׳',
          fromWord: 'מוצא',
          toWord: 'יעד'
        };
      case 'ar':
        return {
          busRoute: 'خط الحافلة',
          arrivalCountdown: 'الوقت المتبقي',
          nearYou: 'بالقرب منك',
          switchDir: 'تبديل الاتجاه',
          reverseRoute: 'المسار العكسي',
          optionWord: 'خيار',
          variantsAria: 'اختر خيار الرحلة',
          minShort: 'د',
          waitWord: 'انتظار',
          moreStops: 'كل المحطات',
          collapse: 'تصغير',
          busHere: 'الحافلة هنا الآن',
          scheduledEta: 'حسب الجدول',
          secShort: 'ث',
          fromWord: 'من',
          toWord: 'إلى'
        };
      case 'uk':
        return {
          busRoute: 'маршрут',
          arrivalCountdown: 'до прибуття',
          nearYou: 'Поруч із вами',
          switchDir: 'Змінити напрямок',
          reverseRoute: 'Зворотний маршрут',
          optionWord: 'Варіант',
          variantsAria: 'Вибір варіанта маршруту',
          minShort: 'хв',
          waitWord: 'очік.',
          moreStops: 'Усі зупинки',
          collapse: 'Згорнути',
          busHere: 'Автобус зараз тут',
          scheduledEta: 'За розкладом',
          secShort: 'с',
          fromWord: 'Звідки',
          toWord: 'Куди'
        };
      case 'ru':
        return {
          busRoute: 'маршрут',
          arrivalCountdown: 'до прибытия',
          nearYou: 'Рядом с вами',
          switchDir: 'Сменить направление',
          reverseRoute: 'Обратный маршрут',
          optionWord: 'Вариант',
          variantsAria: 'Выбор варианта маршрута',
          minShort: 'мин',
          waitWord: 'ожид.',
          moreStops: 'Все остановки',
          collapse: 'Свернуть',
          busHere: 'Автобус сейчас здесь',
          scheduledEta: 'По расписанию',
          secShort: 'с',
          fromWord: 'Откуда',
          toWord: 'Куда'
        };
      default:
        return {
          busRoute: 'bus route',
          arrivalCountdown: 'arrival countdown',
          nearYou: 'Near You',
          switchDir: 'Switch direction',
          reverseRoute: 'Reverse route',
          optionWord: 'Option',
          variantsAria: 'Select trip option',
          minShort: 'min',
          waitWord: 'wait',
          moreStops: 'All stops',
          collapse: 'Compact',
          busHere: 'Bus is here',
          scheduledEta: 'Scheduled',
          secShort: 's',
          fromWord: 'From',
          toWord: 'To'
        };
    }
  });

  onSwitchDirection(): void {
    const nextDir: 0 | 1 = this.activeRoute().direction_id === 0 ? 1 : 0;
    this.switchDirection.emit(nextDir);
  }
}

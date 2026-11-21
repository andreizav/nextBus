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
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Minimalist live bus status and stop timeline"
    >
      <!-- 1. Hero Metrics Row (Route Number & Arrival Countdown) -->
      <header class="hero-metrics">
        <div class="metric-col">
          <div class="metric-main" [class.is-compact]="heroRouteDisplay().length > 4">
            {{ heroRouteDisplay() }}
          </div>
          <div class="metric-caption">{{ labels().busRoute }}</div>
        </div>

        <div class="metric-col" role="status" aria-live="polite">
          <div class="metric-main">
            <span>{{ etaDigits() }}</span>
            @if (etaUnit()) {
              <span class="metric-unit">{{ etaUnit() }}</span>
            }
          </div>
          <div class="metric-caption">{{ labels().arrivalCountdown }}</div>
        </div>
      </header>

      <!-- 2. Line Disambiguation Chips (only if multiple nearby lines/directions match) -->
      @if (state().candidates; as candidates) {
        @if (candidates.length > 1) {
          <div class="context-pills" role="region" aria-label="Choose matching line or direction">
            @for (cand of candidates; track cand.route_id + '-' + cand.direction_id) {
              <button
                type="button"
                class="pill-chip"
                [class.is-active]="
                  cand.route_id === state().route.route_id &&
                  cand.direction_id === state().route.direction_id
                "
                (click)="selectCandidate.emit(cand)"
              >
                <span>{{ cand.line_number }}</span>
                <span class="chip-arrow">→</span>
                <span class="chip-dest">{{ cand.destination_he }}</span>
              </button>
            }
          </div>
        }
      }

      <!-- 3. Concise Direction / Trip Plan Selector & Multi-Leg Transfers -->
      @if (tripOptions().length > 0) {
        @if (tripOptions().length > 1) {
          <div class="context-pills" role="tablist">
            @for (opt of tripOptions(); track opt.rank; let idx = $index) {
              <button
                type="button"
                role="tab"
                class="pill-chip"
                [class.is-active]="selectedTripIndex() === idx"
                (click)="selectedTripIndex.set(idx)"
              >
                <span>#{{ opt.rank }} • {{ opt.total_duration_min }} {{ labels().minShort }}</span>
                @if (opt.transfers_count > 0) {
                  <span>🔄{{ opt.transfers_count }}</span>
                }
              </button>
            }
          </div>
        }

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
            @if (!state().destination && state().route.available_directions.length > 1) {
              <button
                type="button"
                class="dir-mini-btn"
                (click)="onSwitchDirection()"
                [title]="labels().switchDir"
                [attr.aria-label]="labels().switchDir"
              >
                ⇄
              </button>
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
        gap: 1.15rem;
        padding-block: 0.35rem 0.25rem;
      }

      /* 1. Hero Metrics */
      .hero-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-items: end;
        text-align: center;
        gap: 0.5rem;
        padding-block: 0.35rem 0.15rem;
      }

      .metric-col {
        display: grid;
        gap: 0.2rem;
        justify-items: center;
      }

      .metric-main {
        color: #ffffff;
        font-size: 3.1rem;
        font-weight: 700;
        line-height: 1;
        letter-spacing: -0.03em;
        white-space: nowrap;
      }

      .metric-main.is-compact {
        font-size: 2.05rem;
      }

      .metric-unit {
        font-size: 1.35rem;
        font-weight: 700;
        margin-inline-start: 0.25rem;
        letter-spacing: 0.02em;
      }

      .metric-caption {
        font-size: 0.85rem;
        color: #8b96a5;
        font-weight: 400;
      }

      /* 2. Context Disambiguation & Option Pills */
      .context-pills {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.38rem;
      }

      .pill-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        background: rgba(255, 255, 255, 0.06);
        color: #cbd5e1;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 999px;
        padding: 0.3rem 0.65rem;
        font-size: 0.74rem;
        font-weight: 600;
        cursor: pointer;
        max-inline-size: 100%;
        transition: all 0.15s ease;
      }

      .pill-chip.is-active {
        background: rgba(59, 130, 246, 0.22);
        border-color: #3b82f6;
        color: #ffffff;
      }

      .chip-dest {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-inline-size: 150px;
      }

      /* 3. Compact Transfer / Destination Strip */
      .trip-summary-strip {
        background: rgba(15, 23, 34, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.85rem;
        padding: 0.55rem 0.75rem;
        display: grid;
        gap: 0.4rem;
      }

      .trip-dest-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.8rem;
        font-weight: 600;
        color: #e2e8f0;
      }

      .dest-eta {
        color: #60a5fa;
        font-weight: 700;
      }

      .transfer-legs-compact {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.32rem;
      }

      .xfer-row {
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        font-size: 0.75rem;
        color: #cbd5e1;
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
        padding-inline-start: 0.5rem;
      }

      .tl-row {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        align-items: center;
        min-block-size: 2.35rem;
        gap: 0.75rem;
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
        font-size: 1rem;
        font-weight: 600;
        color: #f8fafc;
      }

      .near-dist {
        font-size: 0.76rem;
        color: #8b96a5;
      }

      .dir-mini-btn {
        margin-inline-start: auto;
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .text-muted {
        font-size: 0.96rem;
        color: #7c8796;
        font-weight: 400;
      }

      .text-adjacent {
        font-size: 1.03rem;
        color: #dbe2ea;
        font-weight: 500;
      }

      .text-active {
        font-size: 1.24rem;
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
  readonly lang = input<WidgetLang>('ru');
  readonly switchDirection = output<0 | 1>();
  readonly selectCandidate = output<LineCandidate>();
  readonly openMap = output<void>();

  readonly showAllStops = signal<boolean>(false);
  readonly selectedTripIndex = signal<number>(0);

  constructor() {
    effect(() => {
      void this.state().route.route_id;
      void this.state().destination?.place_name;
      this.showAllStops.set(false);
      this.selectedTripIndex.set(0);
    });
  }

  readonly tripOptions = computed<TripOption[]>(() => this.state().trip_options ?? []);

  readonly activeTripOption = computed<TripOption | null>(() => {
    const opts = this.tripOptions();
    if (opts.length === 0) return null;
    const idx = Math.min(this.selectedTripIndex(), opts.length - 1);
    return opts[idx] ?? opts[0];
  });

  readonly activeRecOption = computed(() => {
    const opts = this.state().recommended_options ?? [];
    if (opts.length === 0) return null;
    const idx = Math.min(this.selectedTripIndex(), opts.length - 1);
    return opts[idx] ?? opts[0];
  });

  readonly activeRoute = computed(() => this.activeRecOption()?.route ?? this.state().route);
  readonly activeUserStop = computed(() => this.activeRecOption()?.origin_stop ?? this.state().user_stop);
  readonly activeBus = computed(() => this.activeRecOption()?.bus ?? this.state().nearest_bus);

  readonly heroRouteDisplay = computed(() => {
    const base = this.activeRoute().short_name || '—';
    const trip = this.activeTripOption();
    if (trip && trip.transfers_count > 0 && trip.legs.length > 1) {
      return trip.legs.map((l) => l.line_number).join('→');
    }
    if (this.activeRecOption()?.is_transfer && this.activeRecOption()?.second_leg) {
      return `${base}→${this.activeRecOption()!.second_leg!.route.short_name}`;
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
    if (this.lang() === 'ru') return 'МИН';
    return 'MIN';
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
          minShort: 'דק׳',
          waitWord: 'המתנה',
          moreStops: 'כל התחנות',
          collapse: 'צמצם',
          busHere: 'האוטובוס כאן'
        };
      case 'ru':
        return {
          busRoute: 'маршрут',
          arrivalCountdown: 'до прибытия',
          nearYou: 'Рядом с вами',
          switchDir: 'Сменить направление',
          minShort: 'мин',
          waitWord: 'ожид.',
          moreStops: 'Все остановки',
          collapse: 'Свернуть',
          busHere: 'Автобус сейчас здесь'
        };
      default:
        return {
          busRoute: 'bus route',
          arrivalCountdown: 'arrival countdown',
          nearYou: 'Near You',
          switchDir: 'Switch direction',
          minShort: 'min',
          waitWord: 'wait',
          moreStops: 'All stops',
          collapse: 'Compact',
          busHere: 'Bus is here'
        };
    }
  });

  onSwitchDirection(): void {
    const nextDir: 0 | 1 = this.activeRoute().direction_id === 0 ? 1 : 0;
    this.switchDirection.emit(nextDir);
  }
}

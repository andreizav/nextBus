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
      class="lite-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Mobile transit card with arrival time, location pin, and stop window"
    >
      <!-- 1. Hero Header: Route # + ETA Countdown + Map Toggle -->
      <header class="hero-header">
        <div class="hero-left">
          <div
            class="route-badge"
            [class.is-transfer]="isTransferTrip()"
            aria-label="Route number"
          >
            @if (isTransferTrip() && secondLegShortName()) {
              <span>{{ activeRoute().short_name }}→{{ secondLegShortName() }}</span>
            } @else {
              <span>{{ activeRoute().short_name || '?' }}</span>
            }
          </div>

          <div class="hero-meta">
            <h2 class="hero-title">
              @if (state().destination; as dest) {
                {{ dest.place_name }}
              } @else {
                {{ currentDirectionLabel() || activeRoute().long_name }}
              }
            </h2>
            <p class="hero-sub">
              @if (activeTripOption(); as trip) {
                🏁 {{ labels().arriveAt }} <strong>{{ trip.estimated_arrival_time }}</strong>
                • {{ trip.total_duration_min }} {{ labels().min }}
              } @else {
                {{ labels().busNowAt }}:
                <strong>{{ currentBusStopName() }}</strong>
              }
            </p>
          </div>
        </div>

        <div class="hero-right">
          <div class="eta-pill" role="status" aria-live="polite">
            <span class="eta-value">{{ etaText() }}</span>
            <span class="eta-sub">{{ stopsAwayText() }}</span>
          </div>
          <button
            type="button"
            class="map-toggle-btn nb-btn"
            (click)="openMap.emit()"
            [title]="labels().showMap"
          >
            🗺️ {{ labels().showMap }}
          </button>
        </div>
      </header>

      <!-- 2. Clear User Location Anchor Pin -->
      <div class="user-pin-banner" role="region" aria-label="Your current stop">
        <div class="pin-main">
          <span class="pin-badge">📍 {{ labels().youAreHere }}</span>
          <strong class="pin-stop-name">
            «{{ lang() === 'he' ? activeUserStop().stop_name_he : activeUserStop().stop_name }}»
          </strong>
          @if (activeUserStop().stop_code) {
            <span class="pin-code">#{{ activeUserStop().stop_code }}</span>
          }
          @if (activeUserStop().distance_meters !== undefined) {
            <span class="pin-dist">({{ activeUserStop().distance_meters }} m)</span>
          }
        </div>

        @if (!state().destination && state().route.available_directions.length > 1) {
          <button
            type="button"
            class="dir-switch-btn nb-btn"
            (click)="onSwitchDirection()"
          >
            ⇄ {{ labels().switchDir }}
          </button>
        }
      </div>

      <!-- 3. Line Disambiguation Selector (when multiple matching lines/directions nearby) -->
      @if (state().candidates; as candidates) {
        @if (candidates.length > 1) {
          <div class="disambiguation-box" role="region" aria-label="Choose matching line">
            <span class="section-caption">🚌 {{ labels().chooseLine }}</span>
            <div class="cand-list">
              @for (cand of candidates; track cand.route_id + '-' + cand.direction_id) {
                <button
                  type="button"
                  class="cand-btn nb-btn"
                  [class.is-active]="
                    cand.route_id === state().route.route_id &&
                    cand.direction_id === state().route.direction_id
                  "
                  (click)="selectCandidate.emit(cand)"
                >
                  <span class="cand-num">№{{ cand.line_number }}</span>
                  <span class="cand-dest">→ {{ cand.destination_he }}</span>
                  <span class="cand-eta">{{ cand.eta_minutes }} {{ labels().min }}</span>
                </button>
              }
            </div>
          </div>
        }
      }

      <!-- 4. Step-by-Step Trip Options (up to 3 options, ordered legs) -->
      @if (tripOptions().length > 0) {
        <div class="trip-section" role="region" aria-label="Trip plan">
          @if (tripOptions().length > 1) {
            <div class="trip-tabs" role="tablist">
              @for (opt of tripOptions(); track opt.rank; let idx = $index) {
                <button
                  type="button"
                  role="tab"
                  class="trip-tab-btn nb-btn"
                  [class.is-active]="selectedTripIndex() === idx"
                  (click)="selectedTripIndex.set(idx)"
                >
                  {{ labels().optionWord }} {{ opt.rank }} • {{ opt.total_duration_min }} {{ labels().min }}
                  @if (opt.transfers_count === 0) {
                    ⚡
                  } @else {
                    🔄{{ opt.transfers_count }}
                  }
                </button>
              }
            </div>
          }

          @if (activeTripOption(); as trip) {
            <ol class="legs-list">
              @for (leg of trip.legs; track leg.route_id + '-' + $index; let idx = $index) {
                <li class="leg-card" [class.is-transfer-leg]="leg.leg_type === 'TRANSFER'">
                  <div class="leg-head">
                    <span class="leg-line-chip" [class.is-xfer]="leg.leg_type === 'TRANSFER'">
                      {{ idx + 1 }}.
                      @if (leg.leg_type === 'TRANSFER') {
                        🔄 {{ labels().transferTo }}
                      } @else {
                        🚌 {{ labels().boardWord }}
                      }
                      №{{ leg.line_number }}
                    </span>
                    <span class="leg-timing">
                      @if (leg.leg_type === 'TRANSFER' && leg.transfer_wait_min !== undefined) {
                        ⏱️ {{ labels().waitWord }} {{ leg.transfer_wait_min }} {{ labels().min }}
                        @if (leg.transfer_walk_meters && leg.transfer_walk_meters > 15) {
                          • 🚶 {{ leg.transfer_walk_meters }} m
                        }
                      } @else {
                        ⏰ {{ leg.board_stop.scheduled_time }} ({{ leg.board_stop.eta_minutes }} {{ labels().min }})
                      }
                    </span>
                  </div>
                  <p class="leg-stops-desc">
                    <span class="leg-action">
                      «{{ lang() === 'he' ? leg.board_stop.stop_name_he : leg.board_stop.stop_name }}»
                      (#{{ leg.board_stop.stop_code }})
                    </span>
                    <span class="leg-arrow">➔</span>
                    <span class="leg-action">
                      {{ labels().exitAt }} «{{ lang() === 'he' ? leg.alight_stop.stop_name_he : leg.alight_stop.stop_name }}»
                      ({{ leg.alight_stop.stops_count }} {{ labels().stopsWord }}, ~{{ leg.ride_duration_min }} {{ labels().min }})
                    </span>
                  </p>
                </li>
              }
            </ol>
          }
        </div>
      }

      <!-- 5. Compact Stop Window ("back & ahead") -->
      @if (visibleTimelineStops().length > 0) {
        <div class="window-box" role="region" aria-label="Stops window">
          @if (!showAllStops() && hiddenPastCount() > 0) {
            <div class="hidden-stops-hint">
              ↑ {{ labels().moreBefore }} {{ hiddenPastCount() }} {{ labels().stopsShort }}
            </div>
          }

          <ul class="stop-list">
            @for (stop of visibleTimelineStops(); track stop.stop_id + '-' + stop.stop_sequence) {
              <li
                class="stop-row"
                [class.is-passed]="stop.status === 'passed'"
                [class.is-user]="stop.stop_sequence === activeUserStop().stop_sequence"
                [class.is-bus]="activeBusSequence() !== undefined && stop.stop_sequence === activeBusSequence()"
              >
                <span class="stop-dot" aria-hidden="true">
                  @if (activeBusSequence() !== undefined && stop.stop_sequence === activeBusSequence()) {
                    🚌
                  } @else if (stop.stop_sequence === activeUserStop().stop_sequence) {
                    📍
                  } @else if (stop.status === 'passed') {
                    ✓
                  } @else {
                    ○
                  }
                </span>

                <span class="stop-name" dir="auto">
                  {{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}
                </span>

                @if (stop.stop_sequence === activeUserStop().stop_sequence) {
                  <span class="stop-tag tag-user">{{ labels().youTag }}</span>
                } @else if (activeBusSequence() !== undefined && stop.stop_sequence === activeBusSequence()) {
                  <span class="stop-tag tag-bus">{{ labels().busTag }}</span>
                }

                <span class="stop-code">#{{ stop.stop_code }}</span>
              </li>
            }
          </ul>

          @if (!showAllStops() && hiddenUpcomingCount() > 0) {
            <div class="hidden-stops-hint">
              ↓ {{ labels().moreAhead }} {{ hiddenUpcomingCount() }} {{ labels().stopsShort }}
            </div>
          }

          @if (canExpandStops()) {
            <button
              type="button"
              class="expand-stops-btn nb-btn"
              (click)="showAllStops.set(!showAllStops())"
            >
              {{ showAllStops() ? labels().collapseStops : labels().showAllStops + ' (' + totalStopsCount() + ')' }}
            </button>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .lite-card {
        color-scheme: only dark;
        background: #0b1220;
        color: #f8fafc;
        border: 1px solid #2b3c5d;
        border-radius: 1rem;
        padding: 1rem;
        display: grid;
        gap: 0.75rem;
      }

      .hero-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .hero-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex: 1 1 210px;
        min-inline-size: 0;
      }

      .route-badge {
        display: grid;
        place-items: center;
        min-inline-size: 3.4rem;
        block-size: 3.4rem;
        padding-inline: 0.5rem;
        border-radius: 0.85rem;
        background: #38bdf8;
        color: #041322;
        font-size: 1.45rem;
        font-weight: 800;
        flex-shrink: 0;
      }

      .route-badge.is-transfer {
        background: #f59e0b;
        font-size: 1.05rem;
      }

      .hero-meta {
        min-inline-size: 0;
      }

      .hero-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        color: #f8fafc;
        line-height: 1.25;
      }

      .hero-sub {
        margin: 0.2rem 0 0;
        font-size: 0.78rem;
        color: #cbd5e1;
      }

      .hero-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .eta-pill {
        background: #13223b;
        border: 1.5px solid #38bdf8;
        border-radius: 0.75rem;
        padding: 0.4rem 0.75rem;
        text-align: end;
      }

      .eta-value {
        display: block;
        font-size: 1.25rem;
        font-weight: 800;
        color: #38bdf8;
        line-height: 1.1;
      }

      .eta-sub {
        display: block;
        font-size: 0.72rem;
        color: #cbd5e1;
      }

      .map-toggle-btn {
        background: #132924;
        color: #6ee7b7;
        border: 1px solid #34d399;
        border-radius: 0.65rem;
        padding: 0.5rem 0.7rem;
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }

      .user-pin-banner {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        background: rgba(251, 191, 36, 0.08);
        border: 1px solid rgba(251, 191, 36, 0.38);
        border-radius: 0.75rem;
        padding: 0.55rem 0.75rem;
      }

      .pin-main {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.8rem;
      }

      .pin-badge {
        color: #fbbf24;
        font-weight: 800;
      }

      .pin-stop-name {
        color: #f8fafc;
      }

      .pin-code,
      .pin-dist {
        color: #cbd5e1;
        font-size: 0.74rem;
      }

      .dir-switch-btn {
        background: #172540;
        color: #f8fafc;
        border: 1px solid #38bdf8;
        border-radius: 0.5rem;
        padding: 0.3rem 0.65rem;
        font-size: 0.74rem;
        font-weight: 600;
        cursor: pointer;
      }

      .disambiguation-box,
      .trip-section,
      .window-box {
        background: #10192b;
        border: 1px solid #24344f;
        border-radius: 0.75rem;
        padding: 0.7rem;
        display: grid;
        gap: 0.5rem;
      }

      .section-caption {
        font-size: 0.75rem;
        font-weight: 700;
        color: #7dd3fc;
      }

      .cand-list,
      .trip-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .cand-btn,
      .trip-tab-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: #172540;
        color: #e2e8f0;
        border: 1px solid #2b3c5d;
        border-radius: 0.6rem;
        padding: 0.38rem 0.6rem;
        font-size: 0.76rem;
        font-weight: 600;
        cursor: pointer;
      }

      .cand-btn.is-active,
      .trip-tab-btn.is-active {
        background: #38bdf8;
        color: #041322;
        border-color: #38bdf8;
      }

      .cand-eta {
        opacity: 0.85;
        font-weight: 700;
      }

      .legs-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.45rem;
      }

      .leg-card {
        background: #0b1220;
        border: 1px solid #24385b;
        border-radius: 0.6rem;
        padding: 0.55rem 0.7rem;
        display: grid;
        gap: 0.25rem;
      }

      .leg-card.is-transfer-leg {
        border-color: #f59e0b;
        background: #19140b;
      }

      .leg-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.78rem;
      }

      .leg-line-chip {
        font-weight: 800;
        color: #38bdf8;
      }

      .leg-line-chip.is-xfer {
        color: #fbbf24;
      }

      .leg-timing {
        font-size: 0.74rem;
        color: #cbd5e1;
      }

      .leg-stops-desc {
        margin: 0;
        font-size: 0.77rem;
        color: #e2e8f0;
        line-height: 1.35;
      }

      .leg-arrow {
        color: #38bdf8;
        margin-inline: 0.3rem;
        font-weight: 700;
      }

      .hidden-stops-hint {
        text-align: center;
        font-size: 0.72rem;
        color: #94a3b8;
        padding-block: 0.15rem;
      }

      .stop-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.42rem;
      }

      .stop-row {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .stop-row.is-passed {
        color: #64748b;
      }

      .stop-row.is-user {
        color: #fbbf24;
        font-weight: 700;
      }

      .stop-row.is-bus {
        color: #38bdf8;
        font-weight: 700;
      }

      .stop-dot {
        inline-size: 1.1rem;
        text-align: center;
        flex-shrink: 0;
      }

      .stop-name {
        flex: 1 1 auto;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stop-tag {
        font-size: 0.68rem;
        font-weight: 700;
        border-radius: 999px;
        padding: 0.08rem 0.45rem;
        flex-shrink: 0;
      }

      .tag-user {
        background: rgba(251, 191, 36, 0.16);
        color: #fbbf24;
      }

      .tag-bus {
        background: rgba(56, 189, 248, 0.16);
        color: #38bdf8;
      }

      .stop-code {
        font-size: 0.72rem;
        color: #94a3b8;
        flex-shrink: 0;
      }

      .expand-stops-btn {
        background: #172540;
        color: #7dd3fc;
        border: 1px dashed #33486e;
        border-radius: 0.5rem;
        padding: 0.35rem 0.65rem;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
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
      // Reset view expansion & selected tab when a new route or destination loads
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

  readonly isTransferTrip = computed(() => {
    const trip = this.activeTripOption();
    if (trip) return trip.transfers_count > 0;
    return Boolean(this.activeRecOption()?.is_transfer);
  });

  readonly secondLegShortName = computed(() => {
    const trip = this.activeTripOption();
    if (trip && trip.legs.length > 1) {
      return trip.legs.slice(1).map((l) => l.line_number).join('→');
    }
    return this.activeRecOption()?.second_leg?.route.short_name ?? '';
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
    if (win && win.compact_stops.length > 0) return win.compact_stops;
    return full.slice(0, 6);
  });

  readonly hiddenPastCount = computed(
    () => this.activeTimelineWindow()?.hidden_past_count ?? 0
  );

  readonly hiddenUpcomingCount = computed(
    () => this.activeTimelineWindow()?.hidden_upcoming_count ?? 0
  );

  readonly totalStopsCount = computed(
    () => this.activeTimelineWindow()?.total_stops_count ?? this.activeTimelineStops().length
  );

  readonly canExpandStops = computed(
    () => this.totalStopsCount() > (this.activeTimelineWindow()?.compact_stops.length ?? 6)
  );

  readonly currentBusStopName = computed(() => {
    const bus = this.activeBus();
    if (!bus) return this.labels().noBusYet;
    if (bus.current_stop_name) {
      return this.lang() === 'he'
        ? (bus.current_stop_name_he ?? bus.current_stop_name)
        : bus.current_stop_name;
    }
    return `#${bus.current_stop_sequence}`;
  });

  readonly currentDirectionLabel = computed(() => {
    const dir = this.activeRoute().direction_id;
    const match = this.activeRoute().available_directions.find((d) => d.direction_id === dir);
    if (!match) return this.activeRoute().direction_label;
    return this.lang() === 'he' ? match.label_he : match.label;
  });

  readonly etaText = computed(() => {
    const eta = this.activeBus()?.eta_minutes;
    if (eta === undefined) {
      return this.lang() === 'he' ? 'אין נתונים' : this.lang() === 'en' ? 'No ETA' : 'Нет данных';
    }
    if (eta === 0) {
      return this.lang() === 'he' ? 'בתחנה' : this.lang() === 'en' ? 'Arriving' : 'На ост.';
    }
    if (this.lang() === 'he') return `בעוד ${eta} דק׳`;
    if (this.lang() === 'en') return `${eta} min`;
    return `Через ${eta} мин`;
  });

  readonly stopsAwayText = computed(() => {
    const stops = this.activeBus()?.stops_away ?? 0;
    if (this.lang() === 'he') return `${stops} תחנות`;
    if (this.lang() === 'en') return `${stops} stops`;
    return `${stops} ост.`;
  });

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          showMap: 'מפה',
          youAreHere: 'אתם כאן:',
          switchDir: 'החלף כיוון',
          chooseLine: 'נמצאו מספר קווים/כיוונים בסביבתך:',
          optionWord: 'אפשרות',
          boardWord: 'עלייה לקו',
          transferTo: 'החלפה לקו',
          exitAt: 'ירידה ב-',
          waitWord: 'המתנה',
          stopsWord: 'תחנות',
          min: 'דק׳',
          arriveAt: 'הגעה',
          busNowAt: 'מיקום נוכחי',
          noBusYet: 'ממתין לנתונים',
          moreBefore: 'עוד',
          moreAhead: 'עוד',
          stopsShort: 'תחנות',
          showAllStops: 'כל התחנות',
          collapseStops: 'צמצם לחלון תחנות',
          youTag: 'אתם',
          busTag: 'אוטובוס'
        };
      case 'en':
        return {
          showMap: 'Map',
          youAreHere: 'You are here:',
          switchDir: 'Switch Dir',
          chooseLine: 'Multiple lines/directions near you:',
          optionWord: 'Option',
          boardWord: 'Board Line',
          transferTo: 'Transfer to',
          exitAt: 'Exit at',
          waitWord: 'wait',
          stopsWord: 'stops',
          min: 'min',
          arriveAt: 'Arrive',
          busNowAt: 'Now at',
          noBusYet: 'Awaiting telemetry',
          moreBefore: 'Earlier:',
          moreAhead: 'Ahead:',
          stopsShort: 'stops',
          showAllStops: 'All stops',
          collapseStops: 'Compact view',
          youTag: 'You',
          busTag: 'Bus'
        };
      default:
        return {
          showMap: 'На карте',
          youAreHere: 'Вы здесь:',
          switchDir: 'Сменить',
          chooseLine: 'Выберите маршрут или направление рядом:',
          optionWord: 'Вариант',
          boardWord: 'Сесть на',
          transferTo: 'Пересадка на',
          exitAt: 'выйти на',
          waitWord: 'ожидание',
          stopsWord: 'ост.',
          min: 'мин',
          arriveAt: 'Прибытие',
          busNowAt: 'Сейчас',
          noBusYet: 'Ожидание сигнала',
          moreBefore: 'Пройдено ещё',
          moreAhead: 'Ещё дальше',
          stopsShort: 'ост.',
          showAllStops: 'Все остановки',
          collapseStops: 'Свернуть список',
          youTag: 'Вы',
          busTag: 'Автобус'
        };
    }
  });

  onSwitchDirection(): void {
    const nextDir: 0 | 1 = this.activeRoute().direction_id === 0 ? 1 : 0;
    this.switchDirection.emit(nextDir);
  }
}

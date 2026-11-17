import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { LiveBusStatusResponse, WidgetLang } from '../../models/bus.models';

@Component({
  selector: 'nb-lite-timeline-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="lite-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Live bus arrival status without map"
    >
      <header class="lite-header">
        <div class="route-identity">
          <div
            class="route-badge"
            [class.is-transfer]="activeOption()?.is_transfer"
            aria-label="Route number"
          >
            @if (activeOption()?.is_transfer && activeOption()?.second_leg; as sec) {
              <span>{{ state().route.short_name }}→{{ sec.route.short_name }}</span>
            } @else {
              <span>{{ state().route.short_name }}</span>
            }
          </div>

          <div class="route-meta">
            <span class="route-tag">
              <span aria-hidden="true">⚡</span>
              {{ labels().liteBadge }}
            </span>
            <h2 class="stop-heading">
              @if (state().destination; as dest) {
                {{ labels().tripTo }} {{ dest.place_name }}
              } @else {
                {{ lang() === 'he' ? state().user_stop.stop_name_he : state().user_stop.stop_name }}
              }
            </h2>
            <p class="stop-code-meta">
              @if (activeOption(); as opt) {
                {{ labels().boardAtStop }}
                «{{ lang() === 'he' ? state().user_stop.stop_name_he : state().user_stop.stop_name }}»
                (#{{ state().user_stop.stop_code }})
                • 🏁 {{ labels().arriveAt }} <strong>{{ opt.estimated_arrival_time }}</strong>
                ({{ labels().total }} {{ opt.total_arrival_min }} {{ labels().min }})
              } @else {
                #{{ state().user_stop.stop_code }}
              }
            </p>
          </div>
        </div>

        <div class="eta-box" role="status" aria-live="polite">
          <span class="eta-value">{{ etaText() }}</span>
          <span class="eta-stops">{{ stopsAwayText() }}</span>
        </div>
      </header>

      @if (!state().destination) {
        <div class="direction-bar">
          <span class="direction-label">
            <span aria-hidden="true">⇄</span>
            {{ currentDirectionLabel() }}
          </span>
          <button
            type="button"
            class="switch-btn nb-btn"
            (click)="onSwitchDirection()"
          >
            {{ labels().switchDir }}
          </button>
        </div>
      }

      @if (activeOption(); as opt) {
        @if (opt.is_transfer && opt.transfer_info && opt.second_leg) {
          <div class="transfer-alert-box" role="region" aria-label="Bus transfer instructions">
            <div class="transfer-alert-title">
              <span>🔄 {{ labels().transferGuideTitle }}</span>
              <span class="transfer-wait-pill">
                @if (opt.transfer_info.walk_meters > 0) {
                  🚶 {{ opt.transfer_info.walk_meters }} m •
                }
                ⏱️ {{ labels().waitWord }} {{ opt.transfer_info.wait_minutes }} {{ labels().min }}
              </span>
            </div>

            <div class="transfer-steps-grid">
              <div class="xfer-step">
                <span class="xfer-badge bus1">🚌 №{{ opt.route.short_name }}</span>
                <span>
                  {{ labels().step1Board }}
                  «{{ lang() === 'he' ? opt.origin_stop.stop_name_he : opt.origin_stop.stop_name }}»
                  (#{{ opt.origin_stop.stop_code }}) — {{ etaText() }}
                </span>
              </div>
              <div class="xfer-step is-highlight">
                <span class="xfer-badge hub">🔄 {{ opt.transfer_info.arrive_at_hub_time }}</span>
                <span>
                  {{ labels().step2Exit }}
                  <strong>«{{ lang() === 'he' ? opt.transfer_info.alight_stop.stop_name_he : opt.transfer_info.alight_stop.stop_name }}» (#{{ opt.transfer_info.alight_stop.stop_code }})</strong>
                  → {{ labels().step2BoardNew }}
                  <strong class="new-bus-pill">🚌 №{{ opt.second_leg.route.short_name }}</strong>
                  {{ labels().atTime }} <strong>{{ opt.transfer_info.next_bus_board_time }}</strong>
                  @if (opt.transfer_info.board_stop.stop_code !== opt.transfer_info.alight_stop.stop_code) {
                    ({{ labels().atStop }} «{{ lang() === 'he' ? opt.transfer_info.board_stop.stop_name_he : opt.transfer_info.board_stop.stop_name }}» #{{ opt.transfer_info.board_stop.stop_code }})
                  }
                </span>
              </div>
              <div class="xfer-step">
                <span class="xfer-badge dest">🏁 {{ opt.estimated_arrival_time }}</span>
                <span>
                  {{ labels().step3Dest }}
                  «{{ lang() === 'he' ? opt.dest_stop.stop_name_he : opt.dest_stop.stop_name }}»
                  (#{{ opt.dest_stop.stop_code }})
                </span>
              </div>
            </div>
          </div>
        }
      }

      <div class="bus-status-banner" role="region" aria-label="Current bus location">
        <div class="status-metric">
          <span class="metric-label">
            {{ labels().busNowAt }} (🚌 №{{ state().route.short_name }})
          </span>
          @if (currentBusStop(); as busStop) {
            <strong class="metric-stop" [attr.dir]="lang() === 'he' ? 'rtl' : 'auto'">
              <span aria-hidden="true">🚌</span>
              {{ lang() === 'he' ? busStop.name_he : busStop.name }}
            </strong>
            <span class="metric-sub">
              @if (busStop.code) {
                #{{ busStop.code }} •
              }
              {{ labels().stopOrder }} {{ busStop.seq }}
            </span>
          } @else {
            <strong class="metric-stop">{{ labels().noBusYet }}</strong>
          }
        </div>

        <div class="status-count">
          <span class="count-number">{{ state().nearest_bus?.stops_away ?? '-' }}</span>
          <span class="count-label">{{ labels().stopsRemaining }}</span>
        </div>
      </div>

      <div class="timeline-panel">
        <div class="timeline-track">
          <div
            class="timeline-fill"
            [style.transform]="'scaleY(' + progressScale() + ')'"
          ></div>
          <div
            class="timeline-bus-dot"
            [style.top.%]="busProgressPercent()"
            aria-hidden="true"
          >
            🚌
          </div>
        </div>

        <div class="timeline-stages">
          <ul class="stop-list">
            @for (stop of state().timeline_stops; track stop.stop_id + '-' + stop.stop_sequence) {
              <li
                class="stop-row"
                [class.is-passed]="stop.status === 'passed'"
                [class.is-user]="stop.stop_sequence === state().user_stop.stop_sequence"
                [class.is-bus]="
                  state().nearest_bus &&
                  stop.stop_sequence === state().nearest_bus?.current_stop_sequence
                "
                [class.is-xfer-exit]="
                  activeOption()?.is_transfer &&
                  stop.stop_sequence === activeOption()?.transfer_info?.alight_stop?.stop_sequence
                "
              >
                <span class="stop-marker" aria-hidden="true">
                  @if (
                    activeOption()?.is_transfer &&
                    stop.stop_sequence === activeOption()?.transfer_info?.alight_stop?.stop_sequence
                  ) {
                    🔄
                  } @else if (stop.stop_sequence === state().user_stop.stop_sequence) {
                    📍
                  } @else if (
                    state().nearest_bus &&
                    stop.stop_sequence === state().nearest_bus?.current_stop_sequence
                  ) {
                    ●
                  } @else {
                    ○
                  }
                </span>

                <div class="stop-names">
                  <span class="stop-primary" dir="auto">
                    @if (lang() === 'he') {
                      {{ stop.stop_name_he }}
                    } @else {
                      {{ stop.stop_name }}
                    }
                  </span>
                  @if (stop.stop_sequence === state().user_stop.stop_sequence) {
                    <span class="stop-role-note is-board">
                      {{ labels().roleBoard }} №{{ state().route.short_name }}
                    </span>
                  } @else if (
                    state().nearest_bus &&
                    stop.stop_sequence === state().nearest_bus?.current_stop_sequence
                  ) {
                    <span class="stop-role-note is-live">
                      {{ labels().roleBusHere }} №{{ state().route.short_name }}
                    </span>
                  } @else if (
                    activeOption()?.is_transfer &&
                    activeOption()?.second_leg &&
                    stop.stop_sequence === activeOption()?.transfer_info?.alight_stop?.stop_sequence
                  ) {
                    <span class="stop-role-note is-xfer">
                      {{ labels().roleExitTransfer }} №{{ state().route.short_name }} → №{{ activeOption()!.second_leg!.route.short_name }}
                    </span>
                  }
                </div>

                <div class="stop-badges">
                  <span class="stop-bus-chip">🚌 №{{ state().route.short_name }}</span>
                  <span class="stop-code">#{{ stop.stop_code }}</span>
                </div>
              </li>
            }
          </ul>

          @if (activeOption(); as opt) {
            @if (opt.is_transfer && opt.transfer_info && opt.second_leg) {
              <div class="transfer-divider">
                <span>
                  🔄 {{ labels().step2Exit }} №{{ opt.route.short_name }} ({{ opt.transfer_info.arrive_at_hub_time }}) →
                  <strong>🚌 №{{ opt.second_leg.route.short_name }} ({{ opt.transfer_info.next_bus_board_time }})</strong>
                </span>
              </div>

              <ul class="stop-list">
                @for (stop of opt.second_leg.timeline_stops; track 'leg2-' + stop.stop_id + '-' + stop.stop_sequence) {
                  <li
                    class="stop-row"
                    [class.is-xfer-board]="stop.stop_sequence === opt.second_leg.board_stop.stop_sequence"
                    [class.is-bus]="stop.stop_sequence === opt.second_leg.bus.current_stop_sequence"
                    [class.is-dest-end]="stop.stop_sequence === opt.dest_stop.stop_sequence"
                  >
                    <span class="stop-marker" aria-hidden="true">
                      @if (stop.stop_sequence === opt.second_leg.board_stop.stop_sequence) {
                        🔄
                      } @else if (stop.stop_sequence === opt.dest_stop.stop_sequence) {
                        🏁
                      } @else if (stop.stop_sequence === opt.second_leg.bus.current_stop_sequence) {
                        ●
                      } @else {
                        ○
                      }
                    </span>

                    <div class="stop-names">
                      <span class="stop-primary" dir="auto">
                        @if (lang() === 'he') {
                          {{ stop.stop_name_he }}
                        } @else {
                          {{ stop.stop_name }}
                        }
                      </span>
                      @if (stop.stop_sequence === opt.second_leg.board_stop.stop_sequence) {
                        <span class="stop-role-note is-xfer">
                          {{ labels().roleBoardNew }} №{{ opt.second_leg.route.short_name }} ({{ opt.transfer_info.next_bus_board_time }})
                        </span>
                      } @else if (stop.stop_sequence === opt.second_leg.bus.current_stop_sequence) {
                        <span class="stop-role-note is-live">
                          {{ labels().roleBusHere }} №{{ opt.second_leg.route.short_name }}
                        </span>
                      } @else if (stop.stop_sequence === opt.dest_stop.stop_sequence) {
                        <span class="stop-role-note is-final">
                          {{ labels().roleFinalExit }} ({{ opt.estimated_arrival_time }})
                        </span>
                      }
                    </div>

                    <div class="stop-badges">
                      <span class="stop-bus-chip is-leg2">🚌 №{{ opt.second_leg.route.short_name }}</span>
                      <span class="stop-code">#{{ stop.stop_code }}</span>
                    </div>
                  </li>
                }
              </ul>
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .lite-card {
        color-scheme: only dark;
        background: #0b1220;
        color: #f8fafc;
        accent-color: #38bdf8;
        border: 1px solid #2b3c5d;
        border-radius: 1rem;
        padding-block: 1.25rem;
        padding-inline: 1.25rem;
        display: grid;
        gap: 1rem;
        inline-size: 100%;
        min-inline-size: 0;
      }

      .lite-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
      }

      .route-identity {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        min-inline-size: 0;
        flex: 1 1 240px;
      }

      .route-badge {
        display: grid;
        place-items: center;
        min-inline-size: 3.75rem;
        padding-inline: 0.5rem;
        block-size: 3.75rem;
        flex-shrink: 0;
        border-radius: 0.875rem;
        background: #38bdf8;
        color: #041322;
        font-size: 1.55rem;
        font-weight: 800;
        letter-spacing: -0.02em;
      }

      .route-badge.is-transfer {
        background: #f59e0b;
        font-size: 1.15rem;
      }

      .route-meta {
        min-inline-size: 0;
      }

      .route-tag {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: #7dd3fc;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .stop-heading {
        margin-block: 0.15rem 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .stop-code-meta {
        margin: 0.2rem 0 0;
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .eta-box {
        background: #13223b;
        border: 1.5px solid #38bdf8;
        border-radius: 0.875rem;
        padding-block: 0.65rem;
        padding-inline: 1.1rem;
        text-align: end;
      }

      .eta-value {
        display: block;
        font-size: 1.5rem;
        font-weight: 800;
        color: #38bdf8;
      }

      .eta-stops {
        display: block;
        font-size: 0.8125rem;
        color: #cbd5e1;
      }

      .direction-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        background: #131e33;
        border: 1px solid #2b3c5d;
        border-radius: 0.75rem;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
      }

      .direction-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: #e2e8f0;
      }

      .switch-btn {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #38bdf8;
        border-radius: 0.5rem;
        padding-block: 0.45rem;
        padding-inline: 0.85rem;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
      }

      .switch-btn:hover {
        background: #273751;
      }

      .transfer-alert-box {
        background: #1d180c;
        border: 1.5px solid #f59e0b;
        border-radius: 0.875rem;
        padding-block: 0.8rem;
        padding-inline: 0.95rem;
        display: grid;
        gap: 0.55rem;
      }

      .transfer-alert-title {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        font-weight: 800;
        color: #fcd34d;
      }

      .transfer-wait-pill {
        font-size: 0.75rem;
        font-weight: 600;
        color: #fde68a;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(245, 158, 11, 0.4);
        border-radius: 999px;
        padding-block: 0.15rem;
        padding-inline: 0.55rem;
      }

      .transfer-steps-grid {
        display: grid;
        gap: 0.42rem;
      }

      .xfer-step {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.45rem;
        font-size: 0.82rem;
        color: #e2e8f0;
        line-height: 1.4;
      }

      .xfer-step.is-highlight {
        background: rgba(245, 158, 11, 0.12);
        border-radius: 0.5rem;
        padding-block: 0.35rem;
        padding-inline: 0.5rem;
        color: #fef3c7;
      }

      .xfer-badge {
        display: inline-block;
        font-size: 0.75rem;
        font-weight: 800;
        border-radius: 0.375rem;
        padding-block: 0.1rem;
        padding-inline: 0.4rem;
        flex-shrink: 0;
      }

      .xfer-badge.bus1 {
        background: #10b981;
        color: #041322;
      }

      .xfer-badge.hub {
        background: #f59e0b;
        color: #041322;
      }

      .xfer-badge.dest {
        background: #ef4444;
        color: #ffffff;
      }

      .new-bus-pill {
        color: #041322;
        background: #f59e0b;
        border-radius: 0.35rem;
        padding-block: 0.05rem;
        padding-inline: 0.35rem;
      }

      .bus-status-banner {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        background: #0f1d33;
        border: 1px solid #2f4b75;
        border-radius: 0.875rem;
        padding-block: 0.875rem;
        padding-inline: 1rem;
      }

      .status-metric {
        display: grid;
        gap: 0.2rem;
        min-inline-size: 0;
        flex: 1 1 220px;
      }

      .metric-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #7dd3fc;
      }

      .metric-stop {
        font-size: 1.05rem;
        color: #f8fafc;
      }

      .metric-sub {
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .status-count {
        display: grid;
        place-items: center;
        background: #13223b;
        border: 1px solid #2b3c5d;
        border-radius: 0.75rem;
        padding-block: 0.5rem;
        padding-inline: 0.9rem;
        min-inline-size: 6.5rem;
      }

      .count-number {
        font-size: 1.45rem;
        font-weight: 800;
        color: #34d399;
        line-height: 1.1;
      }

      .count-label {
        font-size: 0.72rem;
        color: #cbd5e1;
      }

      .timeline-panel {
        position: relative;
        display: flex;
        gap: 0.875rem;
        background: #10192b;
        border: 1px solid #24344f;
        border-radius: 0.75rem;
        padding-block: 0.875rem;
        padding-inline: 0.875rem;
      }

      .timeline-track {
        position: relative;
        inline-size: 6px;
        flex-shrink: 0;
        background: #24344f;
        border-radius: 999px;
        margin-block: 0.5rem;
      }

      .timeline-fill {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, #38bdf8, #34d399);
        border-radius: 999px;
        transform-origin: top center;
        transition: transform 1.5s linear;
      }

      .timeline-bus-dot {
        position: absolute;
        inset-inline-start: -9px;
        transform: translateY(-50%);
        font-size: 0.95rem;
        transition: top 1.5s linear;
      }

      .timeline-stages {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: grid;
        gap: 0.75rem;
      }

      .stop-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.625rem;
      }

      .stop-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: #cbd5e1;
      }

      .stop-row.is-passed {
        color: #94a3b8;
        opacity: 0.72;
      }

      .stop-row.is-user {
        color: #fbbf24;
        font-weight: 700;
      }

      .stop-row.is-bus {
        color: #38bdf8;
        font-weight: 700;
      }

      .stop-row.is-xfer-exit,
      .stop-row.is-xfer-board {
        color: #fcd34d;
        font-weight: 700;
      }

      .stop-row.is-dest-end {
        color: #f87171;
        font-weight: 700;
      }

      .stop-marker {
        inline-size: 1.15rem;
        flex-shrink: 0;
        text-align: center;
      }

      .stop-names {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: grid;
        gap: 0.1rem;
      }

      .stop-primary {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stop-role-note {
        font-size: 0.72rem;
        font-weight: 600;
      }

      .stop-role-note.is-board {
        color: #fbbf24;
      }

      .stop-role-note.is-live {
        color: #38bdf8;
      }

      .stop-role-note.is-xfer {
        color: #fcd34d;
      }

      .stop-role-note.is-final {
        color: #f87171;
      }

      .stop-badges {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        flex-shrink: 0;
      }

      .stop-bus-chip {
        background: #172844;
        color: #7dd3fc;
        border: 1px solid #2b456f;
        border-radius: 0.375rem;
        padding-block: 0.1rem;
        padding-inline: 0.4rem;
        font-size: 0.72rem;
        font-weight: 700;
      }

      .stop-bus-chip.is-leg2 {
        background: #2b210e;
        color: #fcd34d;
        border-color: #b45309;
      }

      .stop-code {
        font-size: 0.75rem;
        color: #94a3b8;
        flex-shrink: 0;
      }

      .transfer-divider {
        background: #261f0e;
        border: 1px dashed #f59e0b;
        border-radius: 0.5rem;
        padding-block: 0.45rem;
        padding-inline: 0.65rem;
        font-size: 0.78rem;
        color: #fde68a;
      }
    `
  ]
})
export class LiteTimelineViewComponent {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('ru');
  readonly switchDirection = output<0 | 1>();

  readonly activeOption = computed(() => this.state().recommended_options?.[0] ?? null);

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          liteBadge: 'מצב Lite • ללא מפה',
          tripTo: 'מסלול ליעד:',
          boardAtStop: 'עלייה בתחנה',
          arriveAt: 'הגעה ב-',
          total: 'סה״כ',
          min: 'דק׳',
          switchDir: 'החלף כיוון',
          transferGuideTitle: 'הוראות החלפת אוטובוס (מאיפה ומתי)',
          waitWord: 'המתנה',
          step1Board: 'עולה בתחנה',
          step2Exit: 'יורד בתחנת',
          step2BoardNew: 'עולה לאוטובוס החדש',
          atTime: 'בשעה',
          atStop: 'בתחנה',
          step3Dest: 'יורד ביעד:',
          roleBoard: 'עלייה לקו',
          roleBusHere: 'כאן כעת קו',
          roleExitTransfer: 'ירידה מקו',
          roleBoardNew: 'עלייה לקו החדש',
          roleFinalExit: 'ירידה ביעד',
          busNowAt: 'האוטובוס נמצא כעת בתחנה',
          stopOrder: 'תחנה מס׳',
          stopsRemaining: 'תחנות ממך',
          noBusYet: 'אין מידע על מיקום האוטובוס'
        };
      case 'en':
        return {
          liteBadge: 'Lite Mode • Map-Free ETA',
          tripTo: 'Route to',
          boardAtStop: 'Board at',
          arriveAt: 'Arrive',
          total: 'total',
          min: 'min',
          switchDir: 'Switch Direction',
          transferGuideTitle: 'Transfer Instructions (Where & New Bus #)',
          waitWord: 'Wait',
          step1Board: 'Board at',
          step2Exit: 'Exit at',
          step2BoardNew: 'board new bus',
          atTime: 'at',
          atStop: 'at stop',
          step3Dest: 'Arrive at destination:',
          roleBoard: 'Board Line',
          roleBusHere: 'Now here: Line',
          roleExitTransfer: 'Exit Line',
          roleBoardNew: 'Board new Line',
          roleFinalExit: 'Final destination',
          busNowAt: 'Bus is currently at stop',
          stopOrder: 'Stop seq',
          stopsRemaining: 'stops away',
          noBusYet: 'Waiting for bus telemetry'
        };
      default:
        return {
          liteBadge: 'Режим Lite • Без карты',
          tripTo: 'Маршрут до:',
          boardAtStop: 'Посадка на ост.',
          arriveAt: 'Прибытие в',
          total: 'всего',
          min: 'мин',
          switchDir: 'Сменить направление',
          transferGuideTitle: 'Где выйти и на какой автобус пересесть',
          waitWord: 'ожидание',
          step1Board: 'Садитесь на ост.',
          step2Exit: 'Выйти на ост.',
          step2BoardNew: 'пересесть на новый автобус',
          atTime: 'в',
          atStop: 'на ост.',
          step3Dest: 'Выйти на конечной:',
          roleBoard: 'Посадка на авт.',
          roleBusHere: 'Сейчас здесь авт.',
          roleExitTransfer: 'Выход из авт.',
          roleBoardNew: 'Посадка на новый авт.',
          roleFinalExit: 'Выход на конечной',
          busNowAt: 'Автобус сейчас на остановке',
          stopOrder: 'Остановка №',
          stopsRemaining: 'остановок до вас',
          noBusYet: 'Ожидание телеметрии'
        };
    }
  });

  readonly currentBusStop = computed(() => {
    const bus = this.state().nearest_bus;
    if (!bus) return null;

    if (bus.current_stop_name) {
      return {
        name: bus.current_stop_name,
        name_he: bus.current_stop_name_he ?? bus.current_stop_name,
        code: bus.current_stop_code ?? '',
        seq: bus.current_stop_sequence
      };
    }

    const fromTimeline = this.state().timeline_stops.find(
      (s) => s.stop_sequence === bus.current_stop_sequence
    );
    if (fromTimeline) {
      return {
        name: fromTimeline.stop_name,
        name_he: fromTimeline.stop_name_he,
        code: fromTimeline.stop_code,
        seq: fromTimeline.stop_sequence
      };
    }

    return {
      name: `#${bus.current_stop_sequence}`,
      name_he: `#${bus.current_stop_sequence}`,
      code: '',
      seq: bus.current_stop_sequence
    };
  });

  readonly etaText = computed(() => {
    const eta = this.state().nearest_bus?.eta_minutes;
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
    const stops = this.state().nearest_bus?.stops_away ?? 0;
    if (this.lang() === 'he') return `${stops} תחנות ממך`;
    if (this.lang() === 'en') return `${stops} stops away`;
    return `${stops} ост. до вас`;
  });

  readonly currentDirectionLabel = computed(() => {
    const dir = this.state().route.direction_id;
    const match = this.state().route.available_directions.find((d) => d.direction_id === dir);
    if (!match) return this.state().route.direction_label;
    return this.lang() === 'he' ? match.label_he : match.label;
  });

  readonly busProgressPercent = computed(() => {
    const stops = this.state().timeline_stops;
    const busSeq = this.state().nearest_bus?.current_stop_sequence;
    if (!stops.length || busSeq === undefined) return 15;
    const idx = stops.findIndex((s) => s.stop_sequence >= busSeq);
    const resolvedIdx = idx === -1 ? stops.length - 1 : idx;
    const pct = (resolvedIdx / Math.max(1, stops.length - 1)) * 100;
    return Math.min(96, Math.max(4, Math.round(pct)));
  });

  readonly progressScale = computed(() => {
    return Math.max(0.08, Number((this.busProgressPercent() / 100).toFixed(2)));
  });

  onSwitchDirection(): void {
    const nextDir: 0 | 1 = this.state().route.direction_id === 0 ? 1 : 0;
    this.switchDirection.emit(nextDir);
  }
}

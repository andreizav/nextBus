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
      aria-label="Live bus arrival status"
    >
      <header class="lite-header">
        <div class="route-identity">
          <div class="route-badge" aria-label="Route number">
            {{ state().route.short_name }}
          </div>
          <div class="route-meta">
            <span class="route-tag">
              <span aria-hidden="true">⚡</span>
              {{ labels().liteBadge }}
            </span>
            <h2 class="stop-heading">
              @if (lang() === 'he') {
                {{ state().user_stop.stop_name_he }}
              } @else {
                {{ state().user_stop.stop_name }}
              }
            </h2>
            <p class="stop-code-meta">#{{ state().user_stop.stop_code }}</p>
          </div>
        </div>

        <div class="eta-box" role="status" aria-live="polite">
          <span class="eta-value">{{ etaText() }}</span>
          <span class="eta-stops">{{ stopsAwayText() }}</span>
        </div>
      </header>

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

      <div class="bus-status-banner" role="region" aria-label="Current bus location">
        <div class="status-metric">
          <span class="metric-label">{{ labels().busNowAt }}</span>
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

        <ul class="stop-list">
          @for (stop of state().timeline_stops; track stop.stop_id) {
            <li
              class="stop-row"
              [class.is-passed]="stop.status === 'passed'"
              [class.is-user]="stop.stop_sequence === state().user_stop.stop_sequence"
              [class.is-bus]="
                state().nearest_bus &&
                stop.stop_sequence === state().nearest_bus?.current_stop_sequence
              "
            >
              <span class="stop-marker" aria-hidden="true">
                @if (stop.stop_sequence === state().user_stop.stop_sequence) {
                  ★
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
              </div>
              <span class="stop-code">#{{ stop.stop_code }}</span>
            </li>
          }
        </ul>
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
        inline-size: 3.75rem;
        block-size: 3.75rem;
        flex-shrink: 0;
        border-radius: 0.875rem;
        background: #38bdf8;
        color: #041322;
        font-size: 1.75rem;
        font-weight: 800;
        letter-spacing: -0.02em;
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
        margin: 0.15rem 0 0;
        font-size: 0.8rem;
        color: #94a3b8;
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

      .stop-list {
        list-style: none;
        margin: 0;
        padding: 0;
        flex: 1 1 auto;
        min-inline-size: 0;
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

      .stop-marker {
        inline-size: 1rem;
        flex-shrink: 0;
        text-align: center;
      }

      .stop-names {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: grid;
      }

      .stop-primary {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stop-code {
        font-size: 0.75rem;
        color: #94a3b8;
        flex-shrink: 0;
      }
    `
  ]
})
export class LiteTimelineViewComponent {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('ru');
  readonly switchDirection = output<0 | 1>();

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          liteBadge: 'מצב Lite • ללא מפה',
          switchDir: 'החלף כיוון',
          busNowAt: 'האוטובוס נמצא כעת בתחנה',
          stopOrder: 'תחנה מס׳',
          stopsRemaining: 'תחנות ממך',
          noBusYet: 'אין מידע על מיקום האוטובוס'
        };
      case 'en':
        return {
          liteBadge: 'Lite Mode • Map-Free ETA',
          switchDir: 'Switch Direction',
          busNowAt: 'Bus is currently at stop',
          stopOrder: 'Stop seq',
          stopsRemaining: 'stops away',
          noBusYet: 'Waiting for bus telemetry'
        };
      default:
        return {
          liteBadge: 'Режим Lite • Без карты',
          switchDir: 'Сменить направление',
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

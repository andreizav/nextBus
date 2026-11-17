import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type {
  BoundingBox,
  LiveBusStatusResponse,
  MapProjection,
  WidgetLang
} from '../../models/bus.models';

function projectCoord(lat: number, lon: number, bbox: BoundingBox): MapProjection {
  const lonSpan = bbox.maxLon - bbox.minLon;
  const latSpan = bbox.maxLat - bbox.minLat;
  if (lonSpan <= 0 || latSpan <= 0) {
    return { xPercent: 50, yPercent: 50 };
  }
  const rawX = ((lon - bbox.minLon) / lonSpan) * 100;
  const rawY = ((bbox.maxLat - lat) / latSpan) * 100;
  return {
    xPercent: Math.min(98, Math.max(2, Number(rawX.toFixed(2)))),
    yPercent: Math.min(98, Math.max(2, Number(rawY.toFixed(2))))
  };
}

@Component({
  selector: 'nb-lite-timeline-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="lite-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Live bus arrival timeline"
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
            @if (lang() !== 'he') {
              <p class="stop-hebrew" dir="rtl">{{ state().user_stop.stop_name_he }}</p>
            }
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

      <div class="lite-grid">
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
                  <span class="stop-primary">
                    @if (lang() === 'he') {
                      {{ stop.stop_name_he }}
                    } @else {
                      {{ stop.stop_name }}
                    }
                  </span>
                  @if (lang() !== 'he') {
                    <span class="stop-secondary" dir="rtl">{{ stop.stop_name_he }}</span>
                  }
                </div>
                <span class="stop-code">#{{ stop.stop_code }}</span>
              </li>
            }
          </ul>
        </div>

        <figure class="static-map-frame">
          <div class="static-map-canvas">
            <img
              class="static-map-img"
              [src]="state().lite_map.static_image_url"
              alt="Street map showing Route 49 corridor, stop location, and live bus position"
              width="600"
              height="320"
              loading="eager"
            />

            @if (gpsProjection(); as gps) {
              <div
                class="projected-pin gps-pin"
                [style.left.%]="gps.xPercent"
                [style.top.%]="gps.yPercent"
                [title]="labels().legendUser"
              >
                <span class="pin-circle gps-circle" aria-hidden="true">📍</span>
              </div>
            }

            <div
              class="projected-pin stop-pin"
              [style.left.%]="userProjection().xPercent"
              [style.top.%]="userProjection().yPercent"
              [title]="state().user_stop.stop_name"
            >
              <span class="pin-circle stop-circle" aria-hidden="true">🚏</span>
              <span class="pin-badge stop-badge">#{{ state().user_stop.stop_code }}</span>
            </div>

            @if (state().nearest_bus; as bus) {
              <div
                class="projected-pin bus-pin"
                [style.left.%]="busProjection().xPercent"
                [style.top.%]="busProjection().yPercent"
                [title]="'Bus ' + state().route.short_name + ' (' + bus.vehicle_id + ')'"
              >
                <span class="pin-circle bus-circle" aria-hidden="true">🚌</span>
                <span class="pin-badge bus-badge">
                  {{ state().route.short_name }} • {{ etaText() }}
                </span>
              </div>
            }
          </div>

          <figcaption class="map-legend">
            <span class="legend-item">
              <span class="legend-swatch bus-swatch" aria-hidden="true"></span>
              {{ labels().legendBus }}
            </span>
            <span class="legend-item">
              <span class="legend-swatch stop-swatch" aria-hidden="true"></span>
              {{ labels().legendStop }}
            </span>
            <span class="legend-item">
              <span class="legend-swatch gps-swatch" aria-hidden="true"></span>
              {{ labels().legendUser }}
            </span>
            <span class="legend-item">
              <span class="legend-line" aria-hidden="true"></span>
              {{ labels().legendRoute }}
            </span>
          </figcaption>
        </figure>
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

      .stop-hebrew {
        margin: 0.15rem 0 0;
        font-size: 0.875rem;
        color: #cbd5e1;
      }

      .eta-box {
        background: #13223b;
        border: 1px solid #38bdf8;
        border-radius: 0.875rem;
        padding-block: 0.625rem;
        padding-inline: 1rem;
        text-align: end;
      }

      .eta-value {
        display: block;
        font-size: 1.375rem;
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

      .lite-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 1rem;
        align-items: start;
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

      .stop-secondary {
        font-size: 0.75rem;
        color: #94a3b8;
      }

      .stop-code {
        font-size: 0.75rem;
        color: #94a3b8;
        flex-shrink: 0;
      }

      .static-map-frame {
        margin: 0;
        border-radius: 0.75rem;
        overflow: hidden;
        border: 1px solid #2b3c5d;
        background: #0d1726;
      }

      .static-map-canvas {
        position: relative;
        overflow: hidden;
        background: #e2e8f0;
      }

      .static-map-img {
        display: block;
        inline-size: 100%;
        block-size: auto;
        aspect-ratio: 15 / 8;
        object-fit: fill;
      }

      .projected-pin {
        position: absolute;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        pointer-events: none;
        transition: left 1.5s linear, top 1.5s linear;
      }

      .gps-pin {
        z-index: 2;
      }

      .stop-pin {
        z-index: 3;
      }

      .bus-pin {
        z-index: 4;
      }

      .pin-circle {
        inline-size: 1.75rem;
        block-size: 1.75rem;
        border-radius: 999px;
        display: grid;
        place-items: center;
        font-size: 0.9rem;
        border: 2px solid #ffffff;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.55);
      }

      .gps-circle {
        inline-size: 1.5rem;
        block-size: 1.5rem;
        background: #34d399;
        color: #041322;
      }

      .stop-circle {
        background: #fbbf24;
        color: #0b1220;
      }

      .bus-circle {
        background: #0284c7;
        color: #ffffff;
        box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.45), 0 3px 10px rgba(0, 0, 0, 0.55);
      }

      .pin-badge {
        font-size: 0.7rem;
        font-weight: 800;
        padding-block: 0.12rem;
        padding-inline: 0.4rem;
        border-radius: 999px;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
      }

      .stop-badge {
        background: rgba(11, 18, 32, 0.92);
        color: #fde68a;
        border: 1px solid #fbbf24;
      }

      .bus-badge {
        background: rgba(11, 18, 32, 0.94);
        color: #7dd3fc;
        border: 1px solid #38bdf8;
      }

      .map-legend {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem 0.75rem;
        padding-block: 0.55rem;
        padding-inline: 0.75rem;
        font-size: 0.73rem;
        color: #cbd5e1;
        background: #0d1726;
        border-block-start: 1px solid #24344f;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .legend-swatch {
        inline-size: 0.65rem;
        block-size: 0.65rem;
        border-radius: 999px;
        border: 1px solid #ffffff;
      }

      .bus-swatch {
        background: #0284c7;
      }

      .stop-swatch {
        background: #fbbf24;
      }

      .gps-swatch {
        background: #34d399;
      }

      .legend-line {
        inline-size: 0.95rem;
        block-size: 3px;
        border-radius: 999px;
        background: #0284c7;
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
          liteBadge: 'מצב Lite • ללא SDK כבד',
          switchDir: 'החלף כיוון',
          legendBus: 'אוטובוס',
          legendStop: 'התחנה שלך',
          legendUser: 'המיקום שלך',
          legendRoute: 'מסלול הקו'
        };
      case 'en':
        return {
          liteBadge: 'Lite Mode • Zero Heavy SDK',
          switchDir: 'Switch Direction',
          legendBus: 'Bus',
          legendStop: 'Your Stop',
          legendUser: 'You',
          legendRoute: 'Route Path'
        };
      default:
        return {
          liteBadge: 'Режим Lite • Без тяжелых SDK',
          switchDir: 'Сменить направление',
          legendBus: 'Автобус',
          legendStop: 'Остановка',
          legendUser: 'Вы',
          legendRoute: 'Маршрут'
        };
    }
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

  readonly busProjection = computed(() => {
    const bus = this.state().nearest_bus;
    if (!bus) return this.state().lite_map.bus_projection;
    return projectCoord(bus.lat, bus.lon, this.state().lite_map.bbox);
  });

  readonly userProjection = computed(() => {
    const stop = this.state().user_stop;
    return projectCoord(stop.lat, stop.lon, this.state().lite_map.bbox);
  });

  readonly gpsProjection = computed(() => {
    const loc = this.state().user_location;
    if (!loc) return null;
    return projectCoord(loc.lat, loc.lon, this.state().lite_map.bbox);
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

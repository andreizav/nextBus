import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { LiveBusStatusResponse, WidgetLang } from '../../models/bus.models';

@Component({
  selector: 'nb-interactive-map-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="interactive-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Interactive transit map and nearby partner offers"
    >
      <header class="interactive-header">
        <div>
          <span class="interactive-pill">
            <span aria-hidden="true">🗺️</span>
            {{ labels().badge }}
          </span>
          <h2 class="interactive-title">
            {{ labels().routeLabel }} {{ state().route.short_name }} —
            @if (lang() === 'he') {
              {{ state().user_stop.stop_name_he }}
            } @else {
              {{ state().user_stop.stop_name }}
            }
          </h2>
        </div>

        <div class="zoom-controls">
          <button
            type="button"
            class="ctrl-btn nb-btn"
            (click)="adjustZoom(-0.25)"
            [disabled]="zoom() <= 1"
          >
            -
          </button>
          <span class="zoom-readout">{{ zoom().toFixed(2) }}x</span>
          <button
            type="button"
            class="ctrl-btn nb-btn"
            (click)="adjustZoom(0.25)"
            [disabled]="zoom() >= 2"
          >
            +
          </button>
          <button
            type="button"
            class="ctrl-btn nb-btn"
            (click)="switchDirection.emit(state().route.direction_id === 0 ? 1 : 0)"
          >
            ⇄
          </button>
        </div>
      </header>

      <div class="map-viewport">
        <div
          class="map-canvas"
          [style.transform]="'scale(' + zoom() + ')'"
        >
          <svg
            viewBox="0 0 600 320"
            class="interactive-svg"
            role="img"
            aria-label="Interactive vector route map"
          >
            <rect width="600" height="320" fill="#091524" />
            <path
              d="M0,0 L215,0 C205,70 198,135 210,205 C218,248 232,285 250,320 L0,320 Z"
              fill="#072138"
            />
            <path
              d="M404,288 C398,240 390,192 365,148 C344,110 315,72 288,34"
              fill="none"
              stroke="#38bdf8"
              stroke-width="4"
              stroke-linecap="round"
            />
            @for (stop of projectedStops(); track stop.stop_id) {
              <g
                class="svg-stop"
                (click)="selectedStopId.set(stop.stop_id)"
              >
                <circle
                  [attr.cx]="stop.x"
                  [attr.cy]="stop.y"
                  [attr.r]="stop.isUserStop ? 8 : 5"
                  [attr.fill]="stop.isUserStop ? '#fbbf24' : '#cbd5e1'"
                  stroke="#041322"
                  stroke-width="2"
                />
              </g>
            }
            @for (offer of projectedOffers(); track offer.id) {
              <g>
                <rect
                  [attr.x]="offer.x - 8"
                  [attr.y]="offer.y - 8"
                  width="16"
                  height="16"
                  rx="4"
                  fill="#34d399"
                  stroke="#041322"
                  stroke-width="2"
                />
              </g>
            }
            @if (projectedBus(); as bus) {
              <g>
                <circle
                  [attr.cx]="bus.x"
                  [attr.cy]="bus.y"
                  r="12"
                  fill="#38bdf8"
                  stroke="#ffffff"
                  stroke-width="2.5"
                />
              </g>
            }
          </svg>
        </div>

        @if (activeStop(); as stop) {
          <div class="map-hud">
            <strong>{{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}</strong>
            <span>#{{ stop.stop_code }} • ETA: {{ state().nearest_bus?.eta_minutes ?? '-' }} min</span>
          </div>
        }
      </div>

      <div class="offers-section">
        <h3 class="offers-title">
          <span aria-hidden="true">☕</span>
          {{ labels().offersTitle }}
        </h3>
        @if (state().nearby_offers.length === 0) {
          <p class="offers-empty">{{ labels().noOffers }}</p>
        } @else {
          <div class="offers-grid">
            @for (offer of state().nearby_offers; track offer.id) {
              <article class="offer-card nb-offer-card">
                <div class="offer-top">
                  <strong class="offer-name">
                    {{ lang() === 'he' ? offer.name_he : offer.name }}
                  </strong>
                  <span class="offer-dist">{{ offer.walk_minutes }} min • {{ offer.distance_meters }}m</span>
                </div>
                <p class="offer-promo">{{ offer.promo }}</p>
              </article>
            }
          </div>
        }
      </div>
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
        padding-block: 1.25rem;
        padding-inline: 1.25rem;
        display: grid;
        gap: 1rem;
      }

      .interactive-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .interactive-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        font-weight: 700;
        color: #34d399;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .interactive-title {
        margin: 0.25rem 0 0;
        font-size: 1.05rem;
        font-weight: 700;
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
        min-inline-size: 2.1rem;
        block-size: 2.1rem;
        font-weight: 700;
        cursor: pointer;
      }

      .ctrl-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .zoom-readout {
        font-size: 0.8rem;
        color: #cbd5e1;
        min-inline-size: 2.75rem;
        text-align: center;
      }

      .map-viewport {
        position: relative;
        overflow: hidden;
        border-radius: 0.875rem;
        border: 1px solid #2b3c5d;
        background: #071524;
      }

      .map-canvas {
        transform-origin: center center;
        transition: transform 0.25s ease-out;
      }

      .interactive-svg {
        display: block;
        inline-size: 100%;
        block-size: auto;
        aspect-ratio: 15 / 8;
      }

      .svg-stop {
        cursor: pointer;
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
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
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
    `
  ]
})
export class InteractiveMapViewComponent {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('ru');
  readonly switchDirection = output<0 | 1>();

  readonly zoom = signal(1);
  readonly selectedStopId = signal<string | null>(null);

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          badge: 'מצב Interactive • טעינה עצלה (@defer)',
          routeLabel: 'קו',
          offersTitle: 'בתי קפה קרובים לתחנה',
          noOffers: 'אין הצעות זמינות כרגע.'
        };
      case 'en':
        return {
          badge: 'Interactive Mode • Lazy @defer Chunk',
          routeLabel: 'Line',
          offersTitle: 'Partner Coffee Shops Nearby',
          noOffers: 'No nearby offers available.'
        };
      default:
        return {
          badge: 'Режим Interactive • Загружен через @defer',
          routeLabel: 'Маршрут',
          offersTitle: 'Кофейни рядом с остановкой',
          noOffers: 'Нет доступных предложений поблизости.'
        };
    }
  });

  private toSvgPoint(lat: number, lon: number): { x: number; y: number } {
    const bbox = this.state().lite_map.bbox;
    const lonSpan = Math.max(0.0001, bbox.maxLon - bbox.minLon);
    const latSpan = Math.max(0.0001, bbox.maxLat - bbox.minLat);
    const x = Math.min(580, Math.max(20, ((lon - bbox.minLon) / lonSpan) * 600));
    const y = Math.min(300, Math.max(20, ((bbox.maxLat - lat) / latSpan) * 320));
    return { x: Math.round(x), y: Math.round(y) };
  }

  readonly projectedStops = computed(() =>
    this.state().timeline_stops.map((s) => ({
      ...s,
      ...this.toSvgPoint(s.lat, s.lon),
      isUserStop: s.stop_sequence === this.state().user_stop.stop_sequence
    }))
  );

  readonly projectedOffers = computed(() =>
    this.state().nearby_offers.map((o) => ({
      ...o,
      ...this.toSvgPoint(o.lat, o.lon)
    }))
  );

  readonly projectedBus = computed(() => {
    const bus = this.state().nearest_bus;
    if (!bus) return null;
    return this.toSvgPoint(bus.lat, bus.lon);
  });

  readonly activeStop = computed(() => {
    const selectedId = this.selectedStopId();
    if (!selectedId) return this.state().user_stop;
    return (
      this.state().timeline_stops.find((s) => s.stop_id === selectedId) ??
      this.state().user_stop
    );
  });

  adjustZoom(delta: number): void {
    this.zoom.update((z) => Math.min(2, Math.max(1, Number((z + delta).toFixed(2)))));
  }
}

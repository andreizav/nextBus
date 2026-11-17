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
  LiveBusStatusResponse,
  RenderMode,
  WidgetLang
} from '../../models/bus.models';
import { InteractiveMapViewComponent } from '../interactive-map-view/interactive-map-view.component';
import { LiteTimelineViewComponent } from '../lite-timeline-view/lite-timeline-view.component';

const POLL_INTERVAL_MS = 15_000;

const DEFAULT_FALLBACK_STATE: LiveBusStatusResponse = {
  render_mode: 'lite',
  updated_at: new Date().toISOString(),
  cache_hit: false,
  route: {
    route_id: 'route-49-haifa',
    short_name: '49',
    long_name: 'Tirat Carmel -> Haifa Hof HaCarmel',
    direction_id: 0,
    direction_label: 'Tirat Carmel -> Hof HaCarmel',
    available_directions: [
      {
        direction_id: 0,
        label: 'Tirat Carmel -> Hof HaCarmel',
        label_he: 'טירת כרמל -> חוף הכרמל'
      },
      {
        direction_id: 1,
        label: 'Hof HaCarmel -> Tirat Carmel',
        label_he: 'חוף הכרמל -> טירת כרמל'
      }
    ]
  },
  user_stop: {
    stop_id: 'stop-41005',
    stop_code: '41005',
    stop_name: 'MATAM High-Tech Park',
    stop_name_he: 'פארק מת״ם / מבוא כרמל',
    stop_sequence: 5,
    lat: 32.7804,
    lon: 34.9658,
    distance_meters: 120
  },
  nearest_bus: {
    vehicle_id: 'egged-49-101',
    lat: 32.7668,
    lon: 34.9729,
    bearing: 348,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: 3,
    speed_kmh: 26,
    stops_away: 2,
    eta_minutes: 4
  },
  timeline_stops: [
    {
      stop_id: 'stop-41001',
      stop_code: '41001',
      stop_name: 'Tirat Carmel / HaAtzmaut',
      stop_name_he: 'העצמאות / טירת כרמל',
      stop_sequence: 1,
      lat: 32.7585,
      lon: 34.9721,
      status: 'passed'
    },
    {
      stop_id: 'stop-41002',
      stop_code: '41002',
      stop_name: 'Herzl / Tirat Carmel Mall',
      stop_name_he: 'הרצל / קניון טירת כרמל',
      stop_sequence: 2,
      lat: 32.7618,
      lon: 34.9726,
      status: 'passed'
    },
    {
      stop_id: 'stop-41003',
      stop_code: '41003',
      stop_name: 'Rambam / HaGalil',
      stop_name_he: 'רמב״ם / הגליל',
      stop_sequence: 3,
      lat: 32.7659,
      lon: 34.973,
      status: 'approaching'
    },
    {
      stop_id: 'stop-41004',
      stop_code: '41004',
      stop_name: 'HaHagana / Kfar Galim',
      stop_name_he: 'ההגנה / כפר גלים',
      stop_sequence: 4,
      lat: 32.7712,
      lon: 34.9718,
      status: 'approaching'
    },
    {
      stop_id: 'stop-41005',
      stop_code: '41005',
      stop_name: 'MATAM High-Tech Park',
      stop_name_he: 'פארק מת״ם / מבוא כרמל',
      stop_sequence: 5,
      lat: 32.7804,
      lon: 34.9658,
      status: 'user_stop'
    },
    {
      stop_id: 'stop-41006',
      stop_code: '41006',
      stop_name: 'Haifa Mall / Fliman',
      stop_name_he: 'קניון חיפה / פלימן',
      stop_sequence: 6,
      lat: 32.7876,
      lon: 34.9622,
      status: 'upcoming'
    },
    {
      stop_id: 'stop-41007',
      stop_code: '41007',
      stop_name: 'Hof HaCarmel Central Station',
      stop_name_he: 'מרכזית חוף הכרמל',
      stop_sequence: 7,
      lat: 32.7938,
      lon: 34.9591,
      status: 'upcoming'
    }
  ],
  lite_map: {
    static_image_url: '/assets/haifa-route-49-static.svg',
    bbox: {
      minLat: 32.755,
      maxLat: 32.798,
      minLon: 34.955,
      maxLon: 34.98
    },
    bus_projection: { xPercent: 71.6, yPercent: 72.56 },
    user_projection: { xPercent: 43.2, yPercent: 40.93 }
  },
  nearby_offers: []
};

@Component({
  selector: 'nb-next-bus-widget',
  standalone: true,
  imports: [CommonModule, LiteTimelineViewComponent, InteractiveMapViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="widget-shell nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
    >
      <div class="widget-toolbar">
        <div class="brand">
          <span class="brand-dot" aria-hidden="true">●</span>
          <strong>nextBus</strong>
          <span class="poll-pill">
            {{ isPollingPaused() ? labels().paused : labels().live }}
          </span>
        </div>

        <div class="toolbar-actions">
          <div class="lang-group" role="group" aria-label="Language selection">
            <button
              type="button"
              class="pill-btn nb-btn"
              [class.is-active]="lang() === 'ru'"
              (click)="lang.set('ru')"
            >
              RU
            </button>
            <button
              type="button"
              class="pill-btn nb-btn"
              [class.is-active]="lang() === 'en'"
              (click)="lang.set('en')"
            >
              EN
            </button>
            <button
              type="button"
              class="pill-btn nb-btn"
              [class.is-active]="lang() === 'he'"
              (click)="lang.set('he')"
            >
              HE
            </button>
          </div>

          <button
            type="button"
            class="mode-btn nb-btn"
            (click)="toggleInteractiveMode()"
          >
            {{ viewMode() === 'lite' ? labels().openInteractive : labels().backToLite }}
          </button>
        </div>
      </div>

      @if (viewMode() === 'lite') {
        <nb-lite-timeline-view
          [state]="busState()"
          [lang]="lang()"
          (switchDirection)="onDirectionSwitch($event)"
        />
      }

      @defer (when viewMode() === 'interactive') {
        <nb-interactive-map-view
          [state]="busState()"
          [lang]="lang()"
          (switchDirection)="onDirectionSwitch($event)"
        />
      } @placeholder {
        @if (viewMode() === 'interactive') {
          <div class="defer-status">{{ labels().loadingMap }}</div>
        }
      } @loading (minimum 120ms) {
        <div class="defer-status">{{ labels().loadingMap }}</div>
      }
    </main>
  `,
  styles: [
    `
      .widget-shell {
        color-scheme: only dark;
        background: #070d18;
        color: #f8fafc;
        accent-color: #38bdf8;
        inline-size: min(100%, 720px);
        border: 1px solid #2b3c5d;
        border-radius: 1.25rem;
        padding-block: 1rem;
        padding-inline: 1rem;
        display: grid;
        gap: 0.875rem;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }

      .widget-toolbar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.95rem;
      }

      .brand-dot {
        color: #34d399;
        font-size: 0.75rem;
      }

      .poll-pill {
        font-size: 0.75rem;
        color: #cbd5e1;
        background: #131e33;
        border: 1px solid #2b3c5d;
        border-radius: 999px;
        padding-block: 0.15rem;
        padding-inline: 0.55rem;
      }

      .toolbar-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }

      .lang-group {
        display: inline-flex;
        gap: 0.25rem;
      }

      .pill-btn,
      .mode-btn {
        background: #131e33;
        color: #e2e8f0;
        border: 1px solid #2b3c5d;
        border-radius: 0.5rem;
        padding-block: 0.35rem;
        padding-inline: 0.65rem;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
      }

      .pill-btn.is-active {
        background: #38bdf8;
        color: #041322;
        border-color: #38bdf8;
      }

      .mode-btn {
        border-color: #34d399;
        color: #6ee7b7;
      }

      .defer-status {
        padding-block: 1.5rem;
        text-align: center;
        font-size: 0.875rem;
        color: #cbd5e1;
        background: #0b1220;
        border-radius: 1rem;
        border: 1px dashed #2b3c5d;
      }
    `
  ]
})
export class NextBusWidgetComponent implements OnInit, OnDestroy {
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  readonly initialState = input<LiveBusStatusResponse | null>(null);

  readonly busState = signal<LiveBusStatusResponse>(DEFAULT_FALLBACK_STATE);
  readonly selectedDirection = signal<0 | 1>(0);
  readonly lang = signal<WidgetLang>('ru');
  private readonly modeOverride = signal<RenderMode | null>(null);
  private readonly isTabHidden = signal(false);
  private readonly isInViewport = signal(true);

  readonly viewMode = computed<RenderMode>(
    () => this.modeOverride() ?? this.busState().render_mode
  );

  readonly isPollingPaused = computed(
    () => this.isTabHidden() || !this.isInViewport()
  );

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          live: 'חי • 15 שניות',
          paused: 'מושהה ברקע',
          openInteractive: 'מפה ובתי קפה',
          backToLite: 'חזרה למצב Lite',
          loadingMap: 'טוען מפה אינטראקטיבית...'
        };
      case 'en':
        return {
          live: 'Live • 15s',
          paused: 'Polling paused',
          openInteractive: 'Interactive & Cafes',
          backToLite: 'Back to Lite',
          loadingMap: 'Loading interactive map module...'
        };
      default:
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (не видим)',
          openInteractive: 'Карта и кофейни',
          backToLite: 'Назад в Lite',
          loadingMap: 'Загрузка интерактивной карты...'
        };
    }
  });

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private observer: IntersectionObserver | null = null;

  private readonly onVisibilityChange = () => {
    this.isTabHidden.set(document.visibilityState === 'hidden');
  };

  ngOnInit(): void {
    const injected = this.initialState() ?? window.__NEXTBUS_STATE__ ?? null;
    if (injected) {
      this.busState.set(injected);
      this.selectedDirection.set(injected.route.direction_id);
    }

    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'lite' || modeParam === 'interactive') {
      this.modeOverride.set(modeParam);
    }
    const langParam = params.get('lang');
    if (langParam === 'ru' || langParam === 'en' || langParam === 'he') {
      this.lang.set(langParam);
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

    void this.fetchLatestStatus();
    this.pollTimer = setInterval(() => {
      if (!this.isPollingPaused()) {
        void this.fetchLatestStatus();
      }
    }, POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  onDirectionSwitch(directionId: 0 | 1): void {
    this.selectedDirection.set(directionId);
    void this.fetchLatestStatus();
  }

  toggleInteractiveMode(): void {
    const nextMode: RenderMode = this.viewMode() === 'lite' ? 'interactive' : 'lite';
    this.modeOverride.set(nextMode);
    void this.fetchLatestStatus();
  }

  private async fetchLatestStatus(): Promise<void> {
    try {
      const params = new URLSearchParams(window.location.search);
      const line = params.get('line') ?? this.busState().route.short_name ?? '49';
      const lat = params.get('lat') ?? String(this.busState().user_stop.lat);
      const lon = params.get('lon') ?? String(this.busState().user_stop.lon);
      const includeNearby = this.viewMode() === 'interactive';

      const url = `/api/live-status?line_number=${encodeURIComponent(
        line
      )}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
        lon
      )}&direction_id=${this.selectedDirection()}&include_nearby_places=${includeNearby}`;

      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as LiveBusStatusResponse;
      this.busState.set(data);
    } catch {
      // Keep current signal snapshot if network temporarily fails
    }
  }
}

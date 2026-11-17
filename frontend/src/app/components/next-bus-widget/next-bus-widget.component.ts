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
  EntryContext,
  LiveBusStatusResponse,
  RenderMode,
  WidgetLang
} from '../../models/bus.models';
import { InteractiveMapViewComponent } from '../interactive-map-view/interactive-map-view.component';
import { LiteTimelineViewComponent } from '../lite-timeline-view/lite-timeline-view.component';
import { SearchBarComponent } from '../search-bar/search-bar.component';

const POLL_INTERVAL_MS = 15_000;

const DEFAULT_COORDS = {
  lat: 32.7895,
  lon: 34.9640
};

const DEFAULT_FALLBACK_STATE: LiveBusStatusResponse = {
  render_mode: 'lite',
  updated_at: new Date().toISOString(),
  cache_hit: false,
  user_location: DEFAULT_COORDS,
  route: {
    route_id: 'stride-10049',
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
    stop_id: 'stop-42656',
    stop_code: '42656',
    stop_name: "מת''מ (חיפה)",
    stop_name_he: "מת''מ (חיפה)",
    stop_sequence: 34,
    lat: 32.790385,
    lon: 34.96134,
    distance_meters: 268
  },
  nearest_bus: {
    vehicle_id: 'egged-49-init',
    lat: 32.7795,
    lon: 34.9665,
    bearing: 345,
    recorded_at_time: new Date().toISOString(),
    current_stop_sequence: 29,
    speed_kmh: 25,
    stops_away: 5,
    eta_minutes: 4
  },
  timeline_stops: [],
  lite_map: {
    static_image_url:
      '/api/static-map?minLat=32.76&maxLat=32.796&minLon=34.95&maxLon=34.99&route_id=stride-10049&direction_id=0',
    bbox: {
      minLat: 32.76,
      maxLat: 32.796,
      minLon: 34.95,
      maxLon: 34.99
    },
    bus_projection: { xPercent: 52, yPercent: 45 },
    user_projection: { xPercent: 45, yPercent: 32 }
  },
  nearby_offers: []
};

@Component({
  selector: 'nb-next-bus-widget',
  standalone: true,
  imports: [
    CommonModule,
    LiteTimelineViewComponent,
    InteractiveMapViewComponent,
    SearchBarComponent
  ],
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
          <button
            type="button"
            class="geo-btn nb-btn"
            [class.is-granted]="geoStatus() === 'granted'"
            (click)="requestUserGeolocation()"
            [disabled]="geoStatus() === 'locating'"
          >
            <span aria-hidden="true">📍</span>
            {{
              geoStatus() === 'locating'
                ? labels().locating
                : labels().locateMe
            }}
          </button>

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

      <div class="geo-status-strip">
        <span class="geo-coords">
          @if (userCoords(); as coords) {
            <span aria-hidden="true">🛰️</span>
            {{ coords.lat.toFixed(5) }}, {{ coords.lon.toFixed(5) }}
            @if (coords.accuracy) {
              (±{{ coords.accuracy }}m)
            }
          } @else {
            <span aria-hidden="true">🌐</span>
            {{ labels().defaultArea }}
          }
        </span>
        @if (busState().user_stop.distance_meters !== undefined) {
          <span class="geo-dist">
            {{ labels().toStop }}: {{ busState().user_stop.distance_meters }} m
          </span>
        }
      </div>

      @if (entryContext() === 'standalone') {
        <nb-search-bar
          [lang]="lang()"
          [isSearching]="isSearching()"
          (searchSubmitted)="onSearchDestination($event)"
        />
      }

      @if (viewMode() === 'lite') {
        <nb-lite-timeline-view
          [state]="busState()"
          [lang]="lang()"
          (switchDirection)="onDirectionSwitch($event)"
        />
      } @else {
        @defer {
          <nb-interactive-map-view
            [state]="busState()"
            [lang]="lang()"
            (switchDirection)="onDirectionSwitch($event)"
          />
        } @loading (minimum 120ms) {
          <div class="defer-status">{{ labels().loadingMap }}</div>
        }
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
        inline-size: 100%;
        max-inline-size: 760px;
        margin-inline: auto;
        min-inline-size: 0;
        border: 1px solid #2b3c5d;
        border-radius: 1.25rem;
        padding-block: 1rem;
        padding-inline: 1rem;
        display: grid;
        gap: 0.75rem;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }

      .widget-toolbar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.65rem;
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
        gap: 0.45rem;
      }

      .lang-group {
        display: inline-flex;
        gap: 0.25rem;
      }

      .pill-btn,
      .mode-btn,
      .geo-btn {
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

      .geo-btn.is-granted {
        border-color: #fbbf24;
        color: #fde68a;
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

      .geo-status-strip {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.78rem;
        color: #cbd5e1;
        background: #0d1627;
        border: 1px solid #1e2d48;
        border-radius: 0.625rem;
        padding-block: 0.4rem;
        padding-inline: 0.75rem;
      }

      .geo-coords {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .geo-dist {
        color: #38bdf8;
        font-weight: 600;
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
  readonly entryContext = signal<EntryContext>('standalone');
  readonly isSearching = signal<boolean>(false);
  readonly selectedDirection = signal<0 | 1>(0);
  readonly hasExplicitDirection = signal(false);
  readonly lang = signal<WidgetLang>('ru');
  readonly userCoords = signal<{ lat: number; lon: number; accuracy?: number } | null>(null);
  readonly geoStatus = signal<'idle' | 'locating' | 'granted' | 'denied'>('idle');
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
          locateMe: 'המיקום שלי',
          locating: 'מאתר...',
          defaultArea: 'חיפה (ברירת מחדל)',
          toStop: 'מרחק לתחנה',
          openInteractive: 'מפה ובתי קפה',
          backToLite: 'חזרה למצב Lite',
          loadingMap: 'טוען מפה אינטראקטיבית...'
        };
      case 'en':
        return {
          live: 'Live • 15s',
          paused: 'Polling paused',
          locateMe: 'My Location',
          locating: 'Locating...',
          defaultArea: 'Haifa (default coords)',
          toStop: 'To nearest stop',
          openInteractive: 'Interactive & Cafes',
          backToLite: 'Back to Lite',
          loadingMap: 'Loading interactive map module...'
        };
      default:
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (не видим)',
          locateMe: 'Моя геопозиция',
          locating: 'Поиск GPS...',
          defaultArea: 'Хайфа (координаты по умолчанию)',
          toStop: 'До остановки',
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
    const params = new URLSearchParams(window.location.search);
    const injected =
      this.initialState() ??
      window.mcpInitialState ??
      window.__NEXTBUS_STATE__ ??
      null;

    const isMcp =
      Boolean(this.initialState()) ||
      Boolean(window.mcpInitialState) ||
      injected?.entry_context === 'mcp' ||
      params.get('entry_context') === 'mcp';

    if (isMcp) {
      this.entryContext.set('mcp');
      if (injected) {
        this.busState.set(injected);
        this.selectedDirection.set(injected.route.direction_id);
        this.modeOverride.set(injected.render_mode);
      } else {
        this.modeOverride.set('interactive');
      }
    } else {
      this.entryContext.set('standalone');
      if (injected) {
        this.busState.set(injected);
        this.selectedDirection.set(injected.route.direction_id);
      }
      // Standalone web/mobile defaults to interactive map + search bar unless ?mode=lite
      this.modeOverride.set('interactive');
    }

    const modeParam = params.get('mode');
    if (modeParam === 'lite' || modeParam === 'interactive') {
      this.modeOverride.set(modeParam);
    }
    const langParam = params.get('lang');
    if (langParam === 'ru' || langParam === 'en' || langParam === 'he') {
      this.lang.set(langParam);
    }

    const latParam = params.get('lat');
    const lonParam = params.get('lon');
    if (latParam && lonParam && !Number.isNaN(Number(latParam)) && !Number.isNaN(Number(lonParam))) {
      this.userCoords.set({ lat: Number(latParam), lon: Number(lonParam) });
      this.geoStatus.set('granted');
    } else {
      this.requestUserGeolocation();
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

  requestUserGeolocation(): void {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.geoStatus.set('denied');
      return;
    }

    this.geoStatus.set('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.userCoords.set({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy)
        });
        this.geoStatus.set('granted');
        void this.fetchLatestStatus();
      },
      () => {
        this.geoStatus.set('denied');
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 15000
      }
    );
  }

  onDirectionSwitch(directionId: 0 | 1): void {
    this.hasExplicitDirection.set(true);
    this.selectedDirection.set(directionId);
    void this.fetchLatestStatus();
  }

  toggleInteractiveMode(): void {
    const nextMode: RenderMode = this.viewMode() === 'lite' ? 'interactive' : 'lite';
    this.modeOverride.set(nextMode);
    void this.fetchLatestStatus();
  }

  async onSearchDestination(query: string): Promise<void> {
    const cleaned = query.trim();
    if (!cleaned) return;

    this.isSearching.set(true);
    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cleaned,
          user_location: { lat: coords.lat, lon: coords.lon }
        })
      });
      if (!response.ok) return;

      const data = (await response.json()) as LiveBusStatusResponse;
      this.busState.set(data);
    } catch {
      // Keep current state on temporary failure
    } finally {
      this.isSearching.set(false);
    }
  }

  private async fetchLatestStatus(): Promise<void> {
    try {
      const params = new URLSearchParams(window.location.search);
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const current = this.busState();

      const urlDestLat = params.get('dest_lat');
      const urlDestLon = params.get('dest_lon');
      const urlDestLabel = params.get('dest_label');

      const destLat =
        current.destination?.lat ??
        (urlDestLat && !Number.isNaN(Number(urlDestLat)) ? Number(urlDestLat) : undefined);
      const destLon =
        current.destination?.lon ??
        (urlDestLon && !Number.isNaN(Number(urlDestLon)) ? Number(urlDestLon) : undefined);

      if (destLat !== undefined && destLon !== undefined) {
        const destLabel = current.destination?.place_name ?? urlDestLabel ?? 'Destination';
        const routeIds = (current.recommended_options ?? [])
          .map((opt) => opt.route.route_id)
          .join(',');
        const routeIdsParam = routeIds ? `&route_ids=${encodeURIComponent(routeIds)}` : '';
        const bootstrapParam = !current.destination ? '&bootstrap=true' : '';

        const tripUrl = `/api/live-status?lat=${encodeURIComponent(
          coords.lat
        )}&lon=${encodeURIComponent(coords.lon)}&dest_lat=${encodeURIComponent(
          destLat
        )}&dest_lon=${encodeURIComponent(destLon)}&dest_label=${encodeURIComponent(
          destLabel
        )}&entry_context=${encodeURIComponent(this.entryContext())}${routeIdsParam}${bootstrapParam}`;

        const response = await fetch(tripUrl);
        if (!response.ok) return;
        const data = (await response.json()) as LiveBusStatusResponse;
        this.busState.set(data);
        return;
      }

      const line = params.get('line') ?? current.route.short_name ?? '49';
      const includeNearby = this.viewMode() === 'interactive';
      const dirParam = this.hasExplicitDirection()
        ? `&direction_id=${this.selectedDirection()}`
        : '';

      const url = `/api/live-status?line_number=${encodeURIComponent(
        line
      )}&lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(
        coords.lon
      )}${dirParam}&include_nearby_places=${includeNearby}&entry_context=${encodeURIComponent(
        this.entryContext()
      )}`;

      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as LiveBusStatusResponse;
      this.busState.set(data);
      if (!this.hasExplicitDirection()) {
        this.selectedDirection.set(data.route.direction_id);
      }
    } catch {
      // Keep current signal snapshot if network temporarily fails
    }
  }
}

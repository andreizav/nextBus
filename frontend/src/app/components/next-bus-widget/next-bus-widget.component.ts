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
  LineCandidate,
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

const EMPTY_INITIAL_STATE: LiveBusStatusResponse = {
  render_mode: 'lite',
  updated_at: new Date().toISOString(),
  cache_hit: true,
  user_location: DEFAULT_COORDS,
  route: {
    route_id: '',
    short_name: '',
    long_name: '',
    direction_id: 0,
    direction_label: '',
    available_directions: []
  },
  user_stop: {
    stop_id: '',
    stop_code: '',
    stop_name: '',
    stop_name_he: '',
    stop_sequence: 0,
    lat: DEFAULT_COORDS.lat,
    lon: DEFAULT_COORDS.lon,
    distance_meters: 0
  },
  nearest_bus: null,
  timeline_stops: [],
  lite_map: {
    static_image_url: '',
    bbox: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    bus_projection: { xPercent: 0, yPercent: 0 },
    user_projection: { xPercent: 0, yPercent: 0 }
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
            <strong>{{ detectedCityName() }}</strong>: {{ coords.lat.toFixed(4) }}, {{ coords.lon.toFixed(4) }}
            @if (coords.accuracy) {
              (±{{ coords.accuracy }}m)
            }
          } @else {
            <span aria-hidden="true">🌐</span>
            {{ labels().defaultArea }}
          }
        </span>
        @if (busState().user_stop.distance_meters !== undefined && hasActiveSearch()) {
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

      @if (!hasActiveSearch()) {
        <section class="welcome-ready-card" role="region" aria-label="Welcome and search suggestions">
          <div class="welcome-hero">
            <div class="welcome-icon">🚏</div>
            <h2 class="welcome-title">{{ welcomeLabels().title }}</h2>
            <p class="welcome-desc">{{ welcomeLabels().subtitle }}</p>
          </div>

          <div class="quick-chips-group">
            <span class="chips-label">{{ welcomeLabels().popularLabel }}:</span>
            <div class="chips-list">
              @for (chip of quickChips(); track chip.query) {
                <button
                  type="button"
                  class="quick-chip-btn nb-btn"
                  (click)="onSearchDestination(chip.query)"
                >
                  <span class="chip-icon">{{ chip.icon }}</span>
                  <span class="chip-text">{{ chip.label }}</span>
                </button>
              }
            </div>
          </div>

          <div class="search-tips-box">
            <p class="search-tip">
              💡 {{ welcomeLabels().tip }}
            </p>
          </div>
        </section>
      } @else {
        <div class="active-trip-bar">
          <div class="active-trip-info">
            <span class="active-pulse">●</span>
            <span class="active-trip-label">
              @if (activeSearchLabel()) {
                {{ activeSearchLabel() }}
              } @else if (busState().destination; as dest) {
                {{ dest.place_name }}
              } @else if (busState().route.short_name) {
                {{ labels().lineWord }} {{ busState().route.short_name }}
              } @else {
                nextBus
              }
            </span>
          </div>
          <button
            type="button"
            class="reset-btn nb-btn"
            (click)="resetSearch()"
            [title]="welcomeLabels().resetTitle"
          >
            ✕ {{ welcomeLabels().resetBtn }}
          </button>
        </div>

        @if (viewMode() === 'lite') {
          <nb-lite-timeline-view
            [state]="busState()"
            [lang]="lang()"
            (switchDirection)="onDirectionSwitch($event)"
            (selectCandidate)="onSelectCandidate($event)"
            (openMap)="toggleInteractiveMode()"
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

      .welcome-ready-card {
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 1rem;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }

      .welcome-hero {
        text-align: center;
        padding-block: 0.5rem;
      }

      .welcome-icon {
        font-size: 2.25rem;
        margin-block-end: 0.35rem;
      }

      .welcome-title {
        font-size: 1.15rem;
        font-weight: 700;
        color: #f1f5f9;
        margin: 0;
      }

      .welcome-desc {
        font-size: 0.825rem;
        color: #94a3b8;
        margin: 0.25rem 0 0 0;
      }

      .quick-chips-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .chips-label {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #64748b;
      }

      .chips-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .quick-chip-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 9999px;
        padding-block: 0.4rem;
        padding-inline: 0.75rem;
        color: #e2e8f0;
        font-size: 0.78rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .quick-chip-btn:hover {
        background: #334155;
        border-color: #38bdf8;
        color: #38bdf8;
        transform: translateY(-1px);
      }

      .search-tips-box {
        background: #020617;
        border: 1px dashed #334155;
        border-radius: 0.625rem;
        padding: 0.65rem 0.85rem;
      }

      .search-tip {
        margin: 0;
        font-size: 0.76rem;
        color: #94a3b8;
        line-height: 1.4;
      }

      .active-trip-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #0f172a;
        border: 1px solid #38bdf8;
        border-radius: 0.75rem;
        padding: 0.5rem 0.75rem;
        gap: 0.5rem;
      }

      .active-trip-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
      }

      .active-pulse {
        color: #10b981;
        font-size: 0.75rem;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .active-trip-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: #f8fafc;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .reset-btn {
        background: #1e293b;
        color: #f87171;
        border: 1px solid #ef4444;
        border-radius: 0.5rem;
        padding: 0.3rem 0.65rem;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.15s ease;
      }

      .reset-btn:hover {
        background: #7f1d1d;
        color: #fef2f2;
      }
    `
  ]
})
export class NextBusWidgetComponent implements OnInit, OnDestroy {
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  readonly initialState = input<LiveBusStatusResponse | null>(null);

  readonly busState = signal<LiveBusStatusResponse>(EMPTY_INITIAL_STATE);
  readonly hasActiveSearch = signal<boolean>(false);
  readonly activeSearchLabel = signal<string>('');
  readonly entryContext = signal<EntryContext>('standalone');
  readonly isSearching = signal<boolean>(false);
  readonly selectedDirection = signal<0 | 1>(0);
  readonly selectedRouteId = signal<string | null>(null);
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
          openInteractive: '🗺️ מפה',
          backToLite: '⚡ כרטיס',
          loadingMap: 'טוען מפה אינטראקטיבית...',
          lineWord: 'קו'
        };
      case 'en':
        return {
          live: 'Live • 15s',
          paused: 'Polling paused',
          locateMe: 'My Location',
          locating: 'Locating...',
          defaultArea: 'Haifa (default coords)',
          toStop: 'To nearest stop',
          openInteractive: '🗺️ Map',
          backToLite: '⚡ Card',
          loadingMap: 'Loading interactive map module...',
          lineWord: 'Line'
        };
      default:
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (не видим)',
          locateMe: 'Моя геопозиция',
          locating: 'Поиск GPS...',
          defaultArea: 'Хайфа (координаты по умолчанию)',
          toStop: 'До остановки',
          openInteractive: '🗺️ Карта',
          backToLite: '⚡ Карточка',
          loadingMap: 'Загрузка интерактивной карты...',
          lineWord: 'Автобус'
        };
    }
  });

  readonly welcomeLabels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          title: 'לאן תרצו להגיע היום?',
          subtitle: 'חיפוש חכם של אוטובוסים בזמן אמת, קווים ישירים ומסלולי החלפה מהירים.',
          popularLabel: 'קווים ויעדים פופולריים',
          tip: 'הזינו מספר קו (למשל 49 או 910) או כתובת יעד. ניתן להשתמש במיקרופון לחיפוש קולי.',
          resetBtn: 'חיפוש חדש',
          resetTitle: 'איפוס וחזרה למסך הראשי'
        };
      case 'en':
        return {
          title: 'Where would you like to go?',
          subtitle: 'Smart real-time search for direct buses, connections, and seamless transfers.',
          popularLabel: 'Popular routes & destinations',
          tip: 'Enter a bus line number (e.g. 49 or 910) or destination place. Voice search is also available.',
          resetBtn: 'New search',
          resetTitle: 'Clear and return to start screen'
        };
      default:
        return {
          title: 'Куда вы хотите поехать?',
          subtitle: 'Умный поиск автобусов в реальном времени с прямыми рейсами и быстрыми пересадками.',
          popularLabel: 'Популярные маршруты и направления',
          tip: 'Введите номер автобуса (например, 49 или 910) или адрес/город назначения. Нажмите микрофон для голосового поиска.',
          resetBtn: 'Новый поиск',
          resetTitle: 'Сбросить и вернуться на главный экран'
        };
    }
  });

  readonly detectedCityName = computed(() => {
    const c = this.userCoords();
    if (!c) return this.labels().defaultArea;
    if (c.lat >= 32.74 && c.lat <= 32.785 && c.lon >= 34.95 && c.lon <= 34.995) {
      return this.lang() === 'he' ? 'טירת כרמל' : this.lang() === 'en' ? 'Tirat Carmel' : 'Тират-Кармель';
    }
    if (c.lat >= 32.0 && c.lat <= 32.15 && c.lon >= 34.74 && c.lon <= 34.85) {
      return this.lang() === 'he' ? 'תל אביב' : this.lang() === 'en' ? 'Tel Aviv' : 'Тель-Авив';
    }
    if (c.lat >= 31.74 && c.lat <= 31.85 && c.lon >= 35.15 && c.lon <= 35.25) {
      return this.lang() === 'he' ? 'ירושלים' : this.lang() === 'en' ? 'Jerusalem' : 'Иерусалим';
    }
    return this.lang() === 'he' ? 'חיפה' : this.lang() === 'en' ? 'Haifa' : 'Хайфа';
  });

  readonly quickChips = computed(() => {
    switch (this.lang()) {
      case 'he':
        return [
          { icon: '🚌', label: 'קו 49 (טירת כרמל)', query: '49' },
          { icon: '🏥', label: 'בית חולים רמב"ם', query: 'בית חולים רמב"ם' },
          { icon: '📍', label: 'ירושלים (תחנה מרכזית)', query: 'ירושלים' },
          { icon: '📍', label: 'תל אביב (עזריאלי)', query: 'תל אביב עזריאלי' },
          { icon: '📍', label: 'מרכז חורב, חיפה', query: 'מרכז חורב חיפה' }
        ];
      case 'en':
        return [
          { icon: '🚌', label: 'Line 49 (Tirat Carmel)', query: '49' },
          { icon: '🏥', label: 'Rambam Hospital', query: 'Rambam Hospital' },
          { icon: '📍', label: 'Jerusalem Central', query: 'Jerusalem' },
          { icon: '📍', label: 'Tel Aviv (Azrieli)', query: 'Tel Aviv Azrieli' },
          { icon: '📍', label: 'Horev Center, Haifa', query: 'Horev Center Haifa' }
        ];
      default:
        return [
          { icon: '🚌', label: 'Сорок девятый автобус', query: 'Сорок девятый автобус' },
          { icon: '🏥', label: 'Больница Рамбам', query: 'Хочу поехать в больницу Рамбам' },
          { icon: '📍', label: 'Иерусалим', query: 'Иерусалим' },
          { icon: '📍', label: 'Тель-Авив (Азриэли)', query: 'Тель-Авив Азриэли' },
          { icon: '📍', label: 'Центр Хорев, Хайфа', query: 'Центр Хорев Хайфа' }
        ];
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
        this.selectedRouteId.set(injected.route.route_id || null);
        this.modeOverride.set(injected.render_mode);
      } else {
        this.modeOverride.set('lite');
      }
    } else {
      this.entryContext.set('standalone');
      if (injected) {
        this.busState.set(injected);
        this.selectedDirection.set(injected.route.direction_id);
        this.selectedRouteId.set(injected.route.route_id || null);
      }
      // Standalone web/mobile defaults to uncluttered lightweight card view with @defer map toggle
      this.modeOverride.set('lite');
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

    const qParam = params.get('q');
    const hasExplicitQuery =
      Boolean(params.get('line')) ||
      Boolean(params.get('dest_lat')) ||
      Boolean(qParam);

    if (qParam) {
      void this.onSearchDestination(qParam);
    } else if (isMcp || hasExplicitQuery || injected) {
      this.hasActiveSearch.set(true);
      if (params.get('line')) {
        this.activeSearchLabel.set(params.get('line') ?? '');
      } else if (params.get('dest_label')) {
        this.activeSearchLabel.set(params.get('dest_label') ?? '');
      }
      void this.fetchLatestStatus();
      this.startPolling();
    } else {
      this.hasActiveSearch.set(false);
      this.stopPolling();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.stopPolling();
  }

  startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.isPollingPaused() && this.hasActiveSearch()) {
        void this.fetchLatestStatus();
      }
    }, POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  resetSearch(): void {
    this.stopPolling();
    this.hasActiveSearch.set(false);
    this.activeSearchLabel.set('');
    this.selectedRouteId.set(null);
    this.hasExplicitDirection.set(false);
    this.busState.set(EMPTY_INITIAL_STATE);
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
        if (this.hasActiveSearch()) {
          if (this.activeSearchLabel()) {
            void this.onSearchDestination(this.activeSearchLabel());
          } else {
            void this.fetchLatestStatus();
          }
        }
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
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus();
    }
  }

  toggleInteractiveMode(): void {
    const nextMode: RenderMode = this.viewMode() === 'lite' ? 'interactive' : 'lite';
    this.modeOverride.set(nextMode);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus();
    }
  }

  async onSelectCandidate(candidate: LineCandidate): Promise<void> {
    this.isSearching.set(true);
    this.selectedRouteId.set(candidate.route_id);
    this.selectedDirection.set(candidate.direction_id);
    this.hasExplicitDirection.set(true);
    this.activeSearchLabel.set(candidate.line_number);

    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const existingCandidates = this.busState().candidates;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: candidate.line_number,
          user_location: { lat: coords.lat, lon: coords.lon },
          route_id: candidate.route_id,
          direction_id: candidate.direction_id,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        this.busState.set({
          ...data,
          candidates: existingCandidates ?? data.candidates
        });
        this.startPolling();
      }
    } catch {
      // Keep current state on temporary failure
    } finally {
      this.isSearching.set(false);
    }
  }

  async onSearchDestination(query: string): Promise<void> {
    const cleaned = query.trim();
    if (!cleaned) return;

    this.isSearching.set(true);
    this.hasActiveSearch.set(true);
    this.activeSearchLabel.set(cleaned);
    this.hasExplicitDirection.set(false);
    this.selectedRouteId.set(null);

    try {
      let coords = this.userCoords();
      if (!coords && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        coords = await new Promise<{ lat: number; lon: number; accuracy?: number } | null>(
          (resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const c = {
                  lat: pos.coords.latitude,
                  lon: pos.coords.longitude,
                  accuracy: Math.round(pos.coords.accuracy)
                };
                this.userCoords.set(c);
                this.geoStatus.set('granted');
                resolve(c);
              },
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 2000 }
            );
          }
        );
      }

      const finalCoords = coords ?? this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cleaned,
          user_location: { lat: finalCoords.lat, lon: finalCoords.lon },
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        this.busState.set(data);
        this.selectedRouteId.set(data.route.route_id || null);
        this.selectedDirection.set(data.route.direction_id);
        this.startPolling();
      }
    } catch {
      // Keep current state on temporary failure
    } finally {
      this.isSearching.set(false);
    }
  }

  private async fetchLatestStatus(): Promise<void> {
    if (!this.hasActiveSearch()) return;

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

      const line = params.get('line') ?? current.route.short_name;
      if (!line) return;

      const includeNearby = this.viewMode() === 'interactive';
      const dirParam = this.hasExplicitDirection()
        ? `&direction_id=${this.selectedDirection()}`
        : '';
      const routeId = this.selectedRouteId() ?? current.route.route_id;
      const routeParam = routeId ? `&route_id=${encodeURIComponent(routeId)}` : '';

      const url = `/api/live-status?line_number=${encodeURIComponent(
        line
      )}&lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(
        coords.lon
      )}${dirParam}${routeParam}&include_nearby_places=${includeNearby}&entry_context=${encodeURIComponent(
        this.entryContext()
      )}`;

      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as LiveBusStatusResponse;
      this.busState.set({
        ...data,
        candidates: current.candidates ?? data.candidates
      });
      if (!this.hasExplicitDirection()) {
        this.selectedDirection.set(data.route.direction_id);
      }
    } catch {
      // Keep current signal snapshot if network temporarily fails
    }
  }
}

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
  GeocodedDestination,
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
      [class.is-map-mode]="hasActiveSearch() && viewMode() === 'interactive'"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
    >
      <!-- Subtle top micro utility strip (location + language + reset) -->
      <div class="micro-top-bar">
        <button
          type="button"
          class="micro-geo-btn"
          [class.is-granted]="geoStatus() === 'granted'"
          (click)="requestUserGeolocation()"
          [disabled]="geoStatus() === 'locating'"
          [title]="labels().locateMe"
        >
          <span aria-hidden="true">📍</span>
          <span>{{ geoStatus() === 'locating' ? labels().locating : detectedCityName() }}</span>
        </button>

        <div class="micro-right">
          @if (hasActiveSearch()) {
            <button
              type="button"
              class="micro-reset-btn"
              (click)="resetSearch()"
              [title]="welcomeLabels().resetTitle"
              [attr.aria-label]="welcomeLabels().resetTitle"
            >
              ✕
            </button>
          }

          <div class="micro-langs" role="group" aria-label="Language selection">
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'ru'"
              (click)="lang.set('ru')"
            >
              RU
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'en'"
              (click)="lang.set('en')"
            >
              EN
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'he'"
              (click)="lang.set('he')"
            >
              HE
            </button>
          </div>
        </div>
      </div>

      <!-- Minimalist pill search bar (strictly hidden in MCP / Gemini embed mode) -->
      @if (entryContext() === 'standalone') {
        <nb-search-bar
          [lang]="lang()"
          [isSearching]="isSearching()"
          (searchSubmitted)="onSearchDestination($event)"
        />
      }

      @if (!hasActiveSearch()) {
        <section class="minimal-ready" role="region" aria-label="Quick route selection">
          <div class="ready-head">
            <h2 class="ready-title">{{ welcomeLabels().title }}</h2>
            <p class="ready-sub">{{ welcomeLabels().tip }}</p>
          </div>

          <div class="ready-chips">
            @for (chip of quickChips(); track chip.query) {
              <button
                type="button"
                class="ready-chip-btn nb-btn"
                (click)="onSearchDestination(chip.query)"
              >
                <span aria-hidden="true">{{ chip.icon }}</span>
                <span>{{ chip.label }}</span>
              </button>
            }
          </div>
        </section>
      } @else {
        @if (viewMode() === 'lite') {
          <nb-lite-timeline-view
            [state]="busState()"
            [lang]="lang()"
            [selectedOptionIndex]="selectedOptionIndex()"
            [isTripReversed]="isTripReversed()"
            [originLabel]="detectedCityName()"
            [targetLabel]="originalDestination()?.place_name ?? busState().destination?.place_name ?? ''"
            (selectOptionIndex)="selectedOptionIndex.set($event)"
            (switchDirection)="onDirectionSwitch($event)"
            (reverseTrip)="onReverseTrip()"
            (selectCandidate)="onSelectCandidate($event)"
            (openMap)="setViewMode('interactive')"
          />
        } @else {
          @defer {
            <nb-interactive-map-view
              [state]="busState()"
              [lang]="lang()"
              [selectedOptionIndex]="selectedOptionIndex()"
              [isTripReversed]="isTripReversed()"
              [originLabel]="detectedCityName()"
              [targetLabel]="originalDestination()?.place_name ?? busState().destination?.place_name ?? ''"
              (selectOptionIndex)="selectedOptionIndex.set($event)"
              (switchDirection)="onDirectionSwitch($event)"
              (reverseTrip)="onReverseTrip()"
            />
          } @loading (minimum 120ms) {
            <div class="defer-status">{{ labels().loadingMap }}</div>
          }
        }

        <!-- Bottom segmented pill bar matching reference UI -->
        <div class="bottom-pill-bar" role="tablist" aria-label="View mode switch">
          <button
            type="button"
            role="tab"
            class="seg-btn"
            [class.is-selected]="viewMode() === 'interactive'"
            (click)="setViewMode('interactive')"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
              <line x1="9" y1="3" x2="9" y2="18"/>
              <line x1="15" y1="6" x2="15" y2="21"/>
            </svg>
            <span>{{ labels().viewMap }}</span>
          </button>

          <button
            type="button"
            role="tab"
            class="seg-btn"
            [class.is-selected]="viewMode() === 'lite'"
            (click)="setViewMode('lite')"
          >
            <span>{{ labels().liveTrack }}</span>
            <span class="live-dot" [class.is-paused]="isPollingPaused()" aria-hidden="true">●</span>
          </button>
        </div>
      }
    </main>
  `,
  styles: [
    `
      .widget-shell {
        color-scheme: only dark;
        background: linear-gradient(180deg, #222931 0%, #1d232b 100%);
        color: #f8fafc;
        inline-size: 100%;
        max-inline-size: 420px;
        margin-inline: auto;
        min-inline-size: 0;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 1.75rem;
        padding-block: 1.15rem 1.2rem;
        padding-inline: 1.15rem;
        display: grid;
        gap: 1rem;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        transition: max-inline-size 0.2s ease;
      }

      .widget-shell.is-map-mode {
        max-inline-size: 480px;
      }

      /* Subtle Micro Header */
      .micro-top-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-block: -0.25rem -0.35rem;
      }

      .micro-geo-btn {
        background: transparent;
        border: none;
        padding: 0.2rem 0.35rem;
        border-radius: 999px;
        color: #8b96a5;
        font-size: 0.72rem;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        cursor: pointer;
      }

      .micro-geo-btn.is-granted,
      .micro-geo-btn:hover {
        color: #cbd5e1;
      }

      .micro-right {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }

      .micro-langs {
        display: inline-flex;
        gap: 0.15rem;
      }

      .micro-lang-btn,
      .micro-reset-btn {
        background: transparent;
        border: none;
        color: #7c8796;
        font-size: 0.68rem;
        font-weight: 700;
        padding: 0.18rem 0.35rem;
        border-radius: 0.4rem;
        cursor: pointer;
      }

      .micro-lang-btn.is-active {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.09);
      }

      .micro-reset-btn:hover {
        color: #f87171;
        background: rgba(239, 68, 68, 0.12);
      }

      /* Minimalist Empty Ready State */
      .minimal-ready {
        display: grid;
        gap: 1rem;
        padding-block: 0.75rem 0.35rem;
      }

      .ready-head {
        text-align: center;
        display: grid;
        gap: 0.35rem;
      }

      .ready-title {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .ready-sub {
        margin: 0;
        font-size: 0.78rem;
        color: #8b96a5;
        line-height: 1.4;
      }

      .ready-chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.45rem;
      }

      .ready-chip-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 999px;
        padding: 0.42rem 0.78rem;
        color: #e2e8f0;
        font-size: 0.78rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .ready-chip-btn:hover {
        background: rgba(59, 130, 246, 0.22);
        border-color: #3b82f6;
        color: #ffffff;
      }

      .defer-status {
        padding-block: 2rem;
        text-align: center;
        font-size: 0.85rem;
        color: #9aa6b4;
      }

      /* Bottom Segmented Blue Pill Bar */
      .bottom-pill-bar {
        display: grid;
        grid-template-columns: 1fr 1fr;
        background: #1a54a6;
        border-radius: 999px;
        padding: 0.22rem;
        margin-block-start: 0.25rem;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35);
      }

      .seg-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        background: transparent;
        border: none;
        border-radius: 999px;
        padding-block: 0.62rem;
        padding-inline: 0.75rem;
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
      }

      .seg-btn.is-selected {
        background: #3087f6;
        color: #ffffff;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
      }

      .live-dot {
        font-size: 0.62rem;
        color: #7dd3fc;
      }

      .live-dot.is-paused {
        color: #94a3b8;
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
  readonly selectedOptionIndex = signal<number>(0);
  readonly isTripReversed = signal<boolean>(false);
  readonly originalDestination = signal<GeocodedDestination | null>(null);
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
          viewMap: 'צפה במפה',
          liveTrack: 'מעקב חי',
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
          viewMap: 'View Map',
          liveTrack: 'Live Track',
          loadingMap: 'Loading interactive map module...',
          lineWord: 'Line'
        };
      default:
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (не видим)',
          locateMe: 'Моя геопозиция',
          locating: 'Поиск GPS...',
          defaultArea: 'Хайфа (по умолчанию)',
          toStop: 'До остановки',
          viewMap: 'Карта',
          liveTrack: 'Live Track',
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
        if (injected.destination) {
          this.originalDestination.set(injected.destination);
        }
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
        if (injected.destination) {
          this.originalDestination.set(injected.destination);
        }
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
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
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
      void this.fetchLatestStatus(true);
    }
  }

  onReverseTrip(): void {
    if (!this.busState().destination && !this.originalDestination()) {
      const nextDir: 0 | 1 = this.selectedDirection() === 0 ? 1 : 0;
      this.onDirectionSwitch(nextDir);
      return;
    }

    this.isTripReversed.set(!this.isTripReversed());
    this.selectedOptionIndex.set(0);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus(true);
    }
  }

  setViewMode(nextMode: RenderMode): void {
    if (this.viewMode() === nextMode) return;
    this.modeOverride.set(nextMode);
    if (this.hasActiveSearch()) {
      void this.fetchLatestStatus();
    }
  }

  toggleInteractiveMode(): void {
    const nextMode: RenderMode = this.viewMode() === 'lite' ? 'interactive' : 'lite';
    this.setViewMode(nextMode);
  }

  async onSelectCandidate(candidate: LineCandidate): Promise<void> {
    this.isSearching.set(true);
    this.selectedRouteId.set(candidate.route_id);
    this.selectedDirection.set(candidate.direction_id);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
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
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);

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
        if (data.destination) {
          this.originalDestination.set(data.destination);
        }
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

  private async fetchLatestStatus(bootstrapLine = false): Promise<void> {
    if (!this.hasActiveSearch()) return;

    try {
      const params = new URLSearchParams(window.location.search);
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const current = this.busState();

      const urlDestLat = params.get('dest_lat');
      const urlDestLon = params.get('dest_lon');
      const urlDestLabel = params.get('dest_label');

      const origDest = this.originalDestination() ?? current.destination;
      const destLat =
        origDest?.lat ??
        (urlDestLat && !Number.isNaN(Number(urlDestLat)) ? Number(urlDestLat) : undefined);
      const destLon =
        origDest?.lon ??
        (urlDestLon && !Number.isNaN(Number(urlDestLon)) ? Number(urlDestLon) : undefined);

      if (destLat !== undefined && destLon !== undefined) {
        const destLabel = origDest?.place_name ?? urlDestLabel ?? 'Destination';
        const reversed = this.isTripReversed();
        const fromLat = reversed ? destLat : coords.lat;
        const fromLon = reversed ? destLon : coords.lon;
        const toLat = reversed ? coords.lat : destLat;
        const toLon = reversed ? coords.lon : destLon;
        const toLabel = reversed ? this.detectedCityName() : destLabel;

        const routeIds = reversed
          ? ''
          : (current.recommended_options ?? []).map((opt) => opt.route.route_id).join(',');
        const routeIdsParam = routeIds ? `&route_ids=${encodeURIComponent(routeIds)}` : '';
        const bootstrapParam = !current.destination || bootstrapLine ? '&bootstrap=true' : '';

        const tripUrl = `/api/live-status?lat=${encodeURIComponent(
          fromLat
        )}&lon=${encodeURIComponent(fromLon)}&dest_lat=${encodeURIComponent(
          toLat
        )}&dest_lon=${encodeURIComponent(toLon)}&dest_label=${encodeURIComponent(
          toLabel
        )}&entry_context=${encodeURIComponent(this.entryContext())}${routeIdsParam}${bootstrapParam}`;

        const response = await fetch(tripUrl);
        if (!response.ok) return;
        const data = (await response.json()) as LiveBusStatusResponse;
        this.busState.set(data);
        if (!reversed && data.destination && !this.originalDestination()) {
          this.originalDestination.set(data.destination);
        }
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
      const bootstrapParam = bootstrapLine ? '&bootstrap=true' : '';

      const url = `/api/live-status?line_number=${encodeURIComponent(
        line
      )}&lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(
        coords.lon
      )}${dirParam}${routeParam}&include_nearby_places=${includeNearby}&entry_context=${encodeURIComponent(
        this.entryContext()
      )}${bootstrapParam}`;

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

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
  LocalLineSuggestion,
  LocalSuggestionsResponse,
  RenderMode,
  ReturningRouteSuggestion,
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
      [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'"
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
              [class.is-active]="lang() === 'he'"
              (click)="selectLang('he')"
              title="עברית"
            >
              HE
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'en'"
              (click)="selectLang('en')"
              title="English"
            >
              EN
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'ar'"
              (click)="selectLang('ar')"
              title="العربية"
            >
              AR
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'ru'"
              (click)="selectLang('ru')"
              title="Русский"
            >
              RU
            </button>
            <button
              type="button"
              class="micro-lang-btn"
              [class.is-active]="lang() === 'uk'"
              (click)="selectLang('uk')"
              title="Українська"
            >
              UK
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
        <section class="minimal-ready" role="region" aria-label="Local transit and recent routes">
          <div class="ready-head">
            <h2 class="ready-title">{{ welcomeLabels().title }}</h2>
            <p class="ready-sub">{{ welcomeLabels().tip }}</p>
          </div>

          <!-- 1. Returning User Routes Near Current Location (~250m) -->
          @if (returningRoutes().length > 0) {
            <div class="sug-block">
              <div class="sug-head">{{ welcomeLabels().returningTitle }}</div>
              <div class="sug-list">
                @for (item of returningRoutes(); track (item.id || '') + '-' + (item.dest_label || item.route_id) + '-' + $index) {
                  <button
                    type="button"
                    class="sug-card is-returning"
                    (click)="onSelectReturningRoute(item)"
                  >
                    <div class="sug-row-top">
                      <span class="sug-line-badge is-history">
                        🕒 {{ item.line_number || '🚌' }}
                      </span>
                      <span class="sug-terminus" dir="auto">
                        → {{ cleanPlaceName(item.dest_label || item.origin_stop_name || '') }}
                      </span>
                      @if (item.eta_minutes !== undefined) {
                        <span class="sug-eta">{{ item.eta_minutes }} {{ minShort() }}</span>
                      }
                    </div>
                    <div class="sug-row-meta" dir="auto">
                      @if (item.origin_stop_name) {
                        <span>📍 {{ cleanPlaceName(item.origin_stop_name) }}</span>
                        <span>•</span>
                      }
                      <span>{{ item.distance_meters }} m</span>
                    </div>
                  </button>
                }
              </div>
            </div>
          }

          <!-- 2. Local Bus Lines Passing Nearby Stops (number + terminus + live ETA) -->
          <div class="sug-block">
            <div class="sug-head">{{ welcomeLabels().localTitle }}</div>

            @if (isLoadingSuggestions() && localLines().length === 0) {
              <div class="sug-empty">{{ labels().locating }}</div>
            } @else if (localLines().length === 0) {
              <div class="sug-empty">{{ welcomeLabels().noLocalLines }}</div>
            } @else {
              <div class="sug-list">
                @for (line of localLines(); track line.route_id + '-' + line.direction_id) {
                  <button
                    type="button"
                    class="sug-card"
                    (click)="onSelectLocalLine(line)"
                  >
                    <div class="sug-row-top">
                      <span class="sug-line-badge">{{ line.line_number }}</span>
                      <span class="sug-terminus" dir="auto">
                        → {{
                          cleanPlaceName(
                            lang() === 'he' || lang() === 'ar'
                              ? line.destination_he
                              : line.destination_name
                          )
                        }}
                      </span>
                      <span class="sug-eta">{{ line.eta_minutes }} {{ minShort() }}</span>
                    </div>
                    <div class="sug-row-meta" dir="auto">
                      <span>
                        📍
                        {{
                          cleanPlaceName(
                            lang() === 'he' || lang() === 'ar'
                              ? line.nearest_stop_name_he
                              : line.nearest_stop_name
                          )
                        }}
                      </span>
                      <span>•</span>
                      <span>{{ line.distance_meters }} m</span>
                    </div>
                  </button>
                }
              </div>
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
        max-inline-size: min(420px, 100%);
        margin-inline: auto;
        min-inline-size: 0;
        overflow-x: clip;
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 1.75rem;
        padding-block: 1.15rem 1.2rem;
        padding-inline: 1.15rem;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        transition: max-inline-size 0.2s ease;
      }

      .widget-shell.is-map-mode {
        max-inline-size: min(480px, 100%);
      }

      @media (max-width: 400px) {
        .widget-shell {
          padding-block: 0.95rem 1rem;
          padding-inline: 0.85rem;
          border-radius: 1.35rem;
        }
      }

      /* Subtle Micro Header */
      .micro-top-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        column-gap: 0.45rem;
        row-gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        margin-block: -0.25rem -0.35rem;
      }

      .micro-geo-btn {
        background: transparent;
        border: none;
        padding: 0.2rem 0.3rem;
        border-radius: 999px;
        color: #8b96a5;
        font-size: 0.72rem;
        font-weight: 500;
        display: block;
        text-align: start;
        flex: 0 1 auto;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }

      .micro-geo-btn.is-granted,
      .micro-geo-btn:hover {
        color: #cbd5e1;
      }

      .micro-right {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        flex-shrink: 0;
        margin-inline-start: auto;
        max-inline-size: 100%;
      }

      .micro-langs {
        display: inline-flex;
        gap: 0.1rem;
      }

      .micro-lang-btn,
      .micro-reset-btn {
        background: transparent;
        border: none;
        color: #7c8796;
        font-size: 0.66rem;
        font-weight: 700;
        padding: 0.18rem 0.28rem;
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
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.9rem;
        padding-block: 0.35rem 0.25rem;
      }

      .ready-head {
        text-align: center;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        gap: 0.28rem;
      }

      .ready-title {
        margin: 0;
        font-size: 1.08rem;
        font-weight: 700;
        color: #f8fafc;
      }

      .ready-sub {
        margin: 0;
        font-size: 0.76rem;
        color: #8b96a5;
        line-height: 1.38;
      }

      .sug-block {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.42rem;
      }

      .sug-head {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #8b96a5;
        padding-inline: 0.2rem;
      }

      .sug-empty {
        font-size: 0.78rem;
        color: #7c8796;
        text-align: center;
        padding-block: 0.65rem;
      }

      .sug-list {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        min-inline-size: 0;
        max-inline-size: 100%;
        gap: 0.42rem;
      }

      .sug-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.2rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        text-align: start;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 0.9rem;
        padding: 0.5rem 0.7rem;
        color: #e2e8f0;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .sug-card:hover {
        background: rgba(48, 135, 246, 0.16);
        border-color: #3087f6;
        color: #ffffff;
      }

      .sug-card.is-returning {
        background: rgba(48, 135, 246, 0.12);
        border-color: rgba(59, 130, 246, 0.38);
      }

      .sug-row-top {
        display: flex;
        align-items: center;
        gap: 0.48rem;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .sug-line-badge {
        background: #3087f6;
        color: #ffffff;
        font-size: 0.76rem;
        font-weight: 800;
        border-radius: 0.45rem;
        padding: 0.12rem 0.45rem;
        flex-shrink: 0;
      }

      .sug-line-badge.is-history {
        background: rgba(59, 130, 246, 0.28);
        border: 1px solid rgba(96, 165, 250, 0.55);
      }

      .sug-terminus {
        font-size: 0.82rem;
        font-weight: 600;
        color: #f8fafc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1 1 auto;
        min-inline-size: 0;
      }

      .sug-eta {
        font-size: 0.74rem;
        font-weight: 700;
        color: #93c5fd;
        flex-shrink: 0;
      }

      .sug-row-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem;
        min-inline-size: 0;
        max-inline-size: 100%;
        font-size: 0.71rem;
        color: #9aa6b4;
        overflow-wrap: anywhere;
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
        grid-template-columns: repeat(2, minmax(0, 1fr));
        min-inline-size: 0;
        max-inline-size: 100%;
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
        gap: 0.4rem;
        min-inline-size: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        background: transparent;
        border: none;
        border-radius: 999px;
        padding-block: 0.62rem;
        padding-inline: 0.55rem;
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.84rem;
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
  readonly userId = signal<string>('');
  readonly returningRoutes = signal<ReturningRouteSuggestion[]>([]);
  readonly localLines = signal<LocalLineSuggestion[]>([]);
  readonly isLoadingSuggestions = signal<boolean>(false);
  readonly lang = signal<WidgetLang>('he');
  private hasManualLang = false;
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
      case 'ar':
        return {
          live: 'مباشر • 15ث',
          paused: 'متوقف مؤقتاً',
          locateMe: 'موقعي',
          locating: 'جارٍ التحديد...',
          defaultArea: 'حيفا (افتراضي)',
          toStop: 'المسافة للمحطة',
          viewMap: 'عرض الخريطة',
          liveTrack: 'تتبع مباشر',
          loadingMap: 'جارٍ تحميل الخريطة...',
          lineWord: 'خط'
        };
      case 'uk':
        return {
          live: 'Онлайн • 15с',
          paused: 'Пауза (фон)',
          locateMe: 'Моя геопозиція',
          locating: 'Пошук GPS...',
          defaultArea: 'Хайфа (за замовч.)',
          toStop: 'До зупинки',
          viewMap: 'Карта',
          liveTrack: 'Live Track',
          loadingMap: 'Завантаження інтерактивної карти...',
          lineWord: 'Автобус'
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
          tip: 'הזינו מספר קו או כתובת יעד, או בחרו מהקווים הקרובים אליכם.',
          returningTitle: 'המסלולים האחרונים שלך מכאן',
          localTitle: 'אוטובוסים קרובים אליך',
          noLocalLines: 'אין תחנות אוטובוס בקרבת המיקום הנוכחי',
          resetBtn: 'חיפוש חדש',
          resetTitle: 'איפוס וחזרה למסך הראשי'
        };
      case 'ar':
        return {
          title: 'إلى أين تريد الذهاب اليوم؟',
          tip: 'أدخل رقم الحافلة أو الوجهة، أو اختر من الحافلات القريبة منك.',
          returningTitle: 'مساراتك الأخيرة من هنا',
          localTitle: 'حافلات بالقرب منك',
          noLocalLines: 'لم يتم العثور على محطات قريبة',
          resetBtn: 'بحث جديد',
          resetTitle: 'إعادة تعيين والعودة للبداية'
        };
      case 'uk':
        return {
          title: 'Куди ви хочете поїхати?',
          tip: 'Введіть номер автобуса або пункт призначення чи оберіть найближчий рейс.',
          returningTitle: 'Ваші нещодавні маршрути звідси',
          localTitle: 'Автобуси поруч із вами',
          noLocalLines: 'Не знайдено зупинок поблизу',
          resetBtn: 'Новий пошук',
          resetTitle: 'Скинути та повернутися на головний екран'
        };
      case 'en':
        return {
          title: 'Where would you like to go?',
          tip: 'Enter a bus line or destination, or tap a local bus stop nearby.',
          returningTitle: 'Your recent routes from here',
          localTitle: 'Buses near you',
          noLocalLines: 'No nearby bus stops found',
          resetBtn: 'New search',
          resetTitle: 'Clear and return to start screen'
        };
      default:
        return {
          title: 'Куда вы хотите поехать?',
          tip: 'Введите номер автобуса или место назначения, либо выберите маршрут рядом с вами.',
          returningTitle: 'Ваши недавние маршруты отсюда',
          localTitle: 'Автобусы рядом с вами',
          noLocalLines: 'Поблизости нет остановок в базе',
          resetBtn: 'Новый поиск',
          resetTitle: 'Сбросить и вернуться на главный экран'
        };
    }
  });

  readonly minShort = computed(() => {
    switch (this.lang()) {
      case 'he':
        return 'דק׳';
      case 'ar':
        return 'د';
      case 'uk':
        return 'хв';
      case 'en':
        return 'min';
      default:
        return 'мин';
    }
  });

  readonly detectedCityName = computed(() => {
    const c = this.userCoords();
    if (!c) return this.labels().defaultArea;
    const l = this.lang();
    if (c.lat >= 32.74 && c.lat <= 32.785 && c.lon >= 34.95 && c.lon <= 34.995) {
      if (l === 'he') return 'טירת כרמל';
      if (l === 'ar') return 'طيرة الكرمل';
      if (l === 'uk') return 'Тірат-Кармель';
      return l === 'en' ? 'Tirat Carmel' : 'Тират-Кармель';
    }
    if (c.lat >= 32.0 && c.lat <= 32.15 && c.lon >= 34.74 && c.lon <= 34.85) {
      if (l === 'he') return 'תל אביב';
      if (l === 'ar') return 'تل أبيب';
      if (l === 'uk') return 'Тель-Авів';
      return l === 'en' ? 'Tel Aviv' : 'Тель-Авив';
    }
    if (c.lat >= 31.74 && c.lat <= 31.85 && c.lon >= 35.15 && c.lon <= 35.25) {
      if (l === 'he') return 'ירושלים';
      if (l === 'ar') return 'القدس';
      if (l === 'uk') return 'Єрусалим';
      return l === 'en' ? 'Jerusalem' : 'Иерусалим';
    }
    if (l === 'he') return 'חיפה';
    if (l === 'ar') return 'حيفا';
    if (l === 'uk') return 'Хайфа';
    return l === 'en' ? 'Haifa' : 'Хайфа';
  });

  cleanPlaceName(name: string): string {
    return name.replace(/\s*\([^)]+\)\s*$/, '').trim() || name;
  }

  private resolvePersistentUserId(): string {
    const paramId = new URLSearchParams(window.location.search).get('user_id')?.trim();
    if (paramId) return paramId;

    const storageKey = 'nextbus_user_id';
    try {
      const existing = window.localStorage?.getItem(storageKey)?.trim();
      if (existing) return existing;
      const generated = `nb_u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
      window.localStorage?.setItem(storageKey, generated);
      return generated;
    } catch {
      return `nb_u_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

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
      const paramUid = params.get('user_id')?.trim() || injected?.user_id?.trim();
      if (paramUid) {
        this.userId.set(paramUid);
      }
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
      this.userId.set(this.resolvePersistentUserId());
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
    if (
      langParam === 'he' ||
      langParam === 'en' ||
      langParam === 'ar' ||
      langParam === 'ru' ||
      langParam === 'uk'
    ) {
      this.hasManualLang = true;
      this.lang.set(langParam);
    }

    const latParam = params.get('lat');
    const lonParam = params.get('lon');
    if (latParam && lonParam && !Number.isNaN(Number(latParam)) && !Number.isNaN(Number(lonParam))) {
      const parsedCoords = { lat: Number(latParam), lon: Number(lonParam) };
      this.userCoords.set(parsedCoords);
      this.geoStatus.set('granted');
      this.applyLocationDefaultLang(parsedCoords);
    } else {
      this.applyLocationDefaultLang(null);
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
      if (this.entryContext() === 'standalone') {
        void this.loadLocalSuggestions();
      }
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
    if (this.entryContext() === 'standalone') {
      void this.loadLocalSuggestions();
    }
  }

  selectLang(nextLang: WidgetLang): void {
    this.hasManualLang = true;
    this.lang.set(nextLang);
  }

  private isLocationInIsrael(lat: number, lon: number): boolean {
    return lat >= 29.45 && lat <= 33.4 && lon >= 34.2 && lon <= 35.95;
  }

  private detectDefaultLangByLocation(
    coords: { lat: number; lon: number } | null
  ): WidgetLang {
    if (coords) {
      if (this.isLocationInIsrael(coords.lat, coords.lon)) {
        return 'he';
      }
      if (coords.lat >= 44.3 && coords.lat <= 52.4 && coords.lon >= 22.1 && coords.lon <= 40.3) {
        return 'uk';
      }
      const navLang = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase();
      if (navLang.startsWith('he') || navLang.startsWith('iw')) return 'he';
      if (navLang.startsWith('ar')) return 'ar';
      if (navLang.startsWith('uk')) return 'uk';
      if (navLang.startsWith('ru')) return 'ru';
      return 'en';
    }

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz === 'Asia/Jerusalem' || tz === 'Asia/Tel_Aviv') {
        return 'he';
      }
    } catch {
      // Ignore timezone detection failure
    }

    // Default service area is Israel (DEFAULT_COORDS)
    return 'he';
  }

  private applyLocationDefaultLang(coords: { lat: number; lon: number } | null): void {
    if (this.hasManualLang) return;
    this.lang.set(this.detectDefaultLangByLocation(coords));
  }

  requestUserGeolocation(): void {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.geoStatus.set('denied');
      return;
    }

    this.geoStatus.set('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const detected = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy)
        };
        this.userCoords.set(detected);
        this.geoStatus.set('granted');
        this.applyLocationDefaultLang(detected);
        if (this.hasActiveSearch()) {
          if (this.activeSearchLabel()) {
            void this.onSearchDestination(this.activeSearchLabel());
          } else {
            void this.fetchLatestStatus();
          }
        } else if (this.entryContext() === 'standalone') {
          void this.loadLocalSuggestions();
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

  async loadLocalSuggestions(): Promise<void> {
    this.isLoadingSuggestions.set(true);
    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const uid = this.userId().trim();
      const userParam = uid ? `&user_id=${encodeURIComponent(uid)}` : '';
      const url = `/api/local-suggestions?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}${userParam}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = (await response.json()) as LocalSuggestionsResponse;
        this.returningRoutes.set(data.returning_routes ?? []);
        this.localLines.set(data.local_lines ?? []);
      }
    } catch {
      // Keep current suggestions on transient error
    } finally {
      this.isLoadingSuggestions.set(false);
    }
  }

  async onSelectLocalLine(line: LocalLineSuggestion): Promise<void> {
    this.isSearching.set(true);
    this.hasActiveSearch.set(true);
    this.selectedRouteId.set(line.route_id);
    this.selectedDirection.set(line.direction_id);
    this.selectedOptionIndex.set(0);
    this.isTripReversed.set(false);
    this.originalDestination.set(null);
    this.hasExplicitDirection.set(true);
    this.activeSearchLabel.set(line.line_number);

    try {
      const coords = this.userCoords() ?? DEFAULT_COORDS;
      const response = await fetch('/api/search-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: line.line_number,
          user_location: { lat: coords.lat, lon: coords.lon },
          user_id: this.userId() || undefined,
          route_id: line.route_id,
          direction_id: line.direction_id,
          include_nearby_places: this.viewMode() === 'interactive'
        })
      });
      if (response.ok) {
        const data = (await response.json()) as LiveBusStatusResponse;
        this.busState.set(data);
        this.startPolling();
        void this.loadLocalSuggestions();
      }
    } catch {
      // Keep state on transient error
    } finally {
      this.isSearching.set(false);
    }
  }

  onSelectReturningRoute(item: ReturningRouteSuggestion): void {
    if (
      item.route_id &&
      item.line_number &&
      (item.dest_lat === null || item.dest_lat === undefined)
    ) {
      void this.onSelectLocalLine({
        route_id: item.route_id,
        line_number: item.line_number,
        route_long_name: item.dest_label || item.line_number,
        direction_id: item.direction_id === 1 ? 1 : 0,
        nearest_stop_id: item.origin_stop_id ?? '',
        nearest_stop_code: '',
        nearest_stop_name: item.origin_stop_name ?? '',
        nearest_stop_name_he: item.origin_stop_name ?? '',
        nearest_stop_sequence: 1,
        stop_lat: item.origin_lat,
        stop_lon: item.origin_lon,
        distance_meters: item.distance_meters,
        destination_name: item.dest_label || item.line_number,
        destination_he: item.dest_label || item.line_number,
        eta_minutes: item.eta_minutes ?? 5
      });
      return;
    }

    const q = item.dest_label?.trim() || item.line_number?.trim();
    if (q) {
      void this.onSearchDestination(q);
    }
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
          user_id: this.userId() || undefined,
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
        if (this.entryContext() === 'standalone') {
          void this.loadLocalSuggestions();
        }
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
                this.applyLocationDefaultLang(c);
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
          user_id: this.userId() || undefined,
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
        if (this.entryContext() === 'standalone') {
          void this.loadLocalSuggestions();
        }
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

      const uid = this.userId().trim();
      const userParam = uid ? `&user_id=${encodeURIComponent(uid)}` : '';

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
        )}&entry_context=${encodeURIComponent(this.entryContext())}${userParam}${routeIdsParam}${bootstrapParam}`;

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
      )}${userParam}${bootstrapParam}`;

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

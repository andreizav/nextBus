import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import * as L from 'leaflet';
import type {
  EntryContext,
  LiveBusStatusResponse,
  RecommendedBusOption,
  WidgetLang
} from '../../models/bus.models';
import { SearchBarComponent } from '../search-bar/search-bar.component';

const RANK_COLORS: Record<number, string> = {
  1: '#10b981', // Rank 1: Fastest (Emerald Green)
  2: '#38bdf8', // Rank 2: Cyan
  3: '#818cf8'  // Rank 3: Indigo
};

@Component({
  selector: 'nb-interactive-map-view',
  standalone: true,
  imports: [CommonModule, SearchBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../../node_modules/leaflet/dist/leaflet.css'],
  template: `
    <section
      class="interactive-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Interactive transit map, Top-3 A-to-B buses, and nearby cafes"
    >
      @if (entryContext() === 'standalone') {
        <nb-search-bar
          [lang]="lang()"
          [isSearching]="isSearching()"
          (searchSubmitted)="searchDestination.emit($event)"
        />
      }

      <header class="interactive-header">
        <div class="interactive-route">
          <div
            class="route-badge-sm"
            [style.background]="activeRankColor()"
            aria-label="Selected route number"
          >
            {{ activeDisplayRoute().short_name }}
          </div>
          <div class="route-info">
            <span class="interactive-pill">
              <span aria-hidden="true">🗺️</span>
              {{ labels().badge }}
              @if (state().destination; as dest) {
                <span class="dest-tag">→ {{ dest.place_name }}</span>
              }
            </span>
            <h2 class="interactive-title">
              @if (state().destination; as dest) {
                {{ labels().tripTo }} {{ dest.place_name }}
              } @else {
                {{ labels().routeLabel }} {{ activeDisplayRoute().short_name }} —
                {{
                  lang() === 'he'
                    ? activeOriginStop().stop_name_he
                    : activeOriginStop().stop_name
                }}
              }
            </h2>
            @if (activeBus()?.current_stop_name) {
              <p class="bus-current-sub">
                <span aria-hidden="true">🚌</span>
                {{ labels().busNowAt }}:
                {{
                  lang() === 'he'
                    ? activeBus()?.current_stop_name_he
                    : activeBus()?.current_stop_name
                }}
              </p>
            }
          </div>
        </div>

        <div class="header-right">
          <div class="eta-box-interactive" role="status" aria-live="polite">
            <span class="eta-val">{{ etaText() }}</span>
            <span class="eta-sub">{{ stopsAwayText() }}</span>
          </div>

          <div class="zoom-controls">
            <button
              type="button"
              class="ctrl-btn nb-btn"
              (click)="recenterMap()"
              [title]="labels().recenter"
            >
              🎯
            </button>
            @if (recommendedOptions().length === 0) {
              <button
                type="button"
                class="ctrl-btn nb-btn"
                (click)="switchDirection.emit(state().route.direction_id === 0 ? 1 : 0)"
                title="Switch direction"
              >
                ⇄
              </button>
            }
          </div>
        </div>
      </header>

      <div class="map-viewport">
        <div #mapContainer class="leaflet-host" aria-label="OpenStreetMap interactive map"></div>
        <div class="map-hud">
          <span>
            <strong>{{ labels().nearestStop }}:</strong>
            {{
              lang() === 'he'
                ? activeOriginStop().stop_name_he
                : activeOriginStop().stop_name
            }}
            (#{{ activeOriginStop().stop_code }})
          </span>
          <span>{{ etaText() }} • {{ stopsAwayText() }}</span>
        </div>
      </div>

      @if (recommendedOptions().length > 0) {
        <div class="top3-section" role="region" aria-label="Top 3 recommended buses">
          <div class="top3-header">
            <h3 class="offers-title">
              <span aria-hidden="true">🏆</span>
              {{ labels().top3Title }} ({{ recommendedOptions().length }})
            </h3>
            @if (state().destination; as dest) {
              <span class="dest-addr">{{ dest.formatted_address }}</span>
            }
          </div>

          <div class="top3-carousel">
            @for (opt of recommendedOptions(); track opt.route.route_id + '-' + opt.route.direction_id; let idx = $index) {
              <button
                type="button"
                class="top3-card"
                [class.is-selected]="selectedOptionIndex() === idx"
                [class.is-fastest]="opt.rank === 1"
                (click)="selectOption(idx)"
              >
                <div class="top3-card-head">
                  <span
                    class="line-pill"
                    [style.background]="rankColor(opt.rank)"
                  >
                    {{ lang() === 'he' ? 'קו ' + opt.route.short_name : labels().lineWord + ' ' + opt.route.short_name }}
                  </span>
                  @if (opt.rank === 1) {
                    <span class="fastest-badge">{{ labels().fastest }}</span>
                  } @else {
                    <span class="rank-badge">#{{ opt.rank }}</span>
                  }
                </div>

                <div class="top3-boarding">
                  {{ labels().arrivesIn }}
                  <strong>{{ opt.eta_to_boarding_min }} {{ labels().min }}</strong>
                  <span class="stop-inline">
                    ({{ lang() === 'he' ? opt.origin_stop.stop_name_he : opt.origin_stop.stop_name }})
                  </span>
                </div>

                <div class="top3-total">
                  <span>{{ labels().arriveAt }} <strong>{{ opt.estimated_arrival_time }}</strong></span>
                  <span class="total-mins">({{ labels().total }} {{ opt.total_arrival_min }} {{ labels().min }})</span>
                </div>
              </button>
            }
          </div>

          @if (selectedOption(); as selected) {
            <div class="selected-timeline-box">
              <div class="timeline-head">
                <strong>
                  {{ labels().routeWord }} {{ selected.route.short_name }}:
                  {{ lang() === 'he' ? selected.origin_stop.stop_name_he : selected.origin_stop.stop_name }}
                  →
                  {{ lang() === 'he' ? selected.dest_stop.stop_name_he : selected.dest_stop.stop_name }}
                </strong>
                <span>{{ selected.stops_between }} {{ labels().stopsWord }} • ~{{ selected.ride_duration_min }} {{ labels().min }}</span>
              </div>
              <ul class="mini-stop-list">
                @for (stop of selected.timeline_stops; track stop.stop_id) {
                  <li
                    class="mini-stop"
                    [class.is-bus]="stop.stop_sequence === selected.bus.current_stop_sequence"
                    [class.is-origin]="stop.stop_sequence === selected.origin_stop.stop_sequence"
                    [class.is-dest]="stop.stop_sequence === selected.dest_stop.stop_sequence"
                  >
                    <span class="mini-dot">
                      @if (stop.stop_sequence === selected.bus.current_stop_sequence) {
                        🚌
                      } @else if (stop.stop_sequence === selected.origin_stop.stop_sequence) {
                        📍
                      } @else if (stop.stop_sequence === selected.dest_stop.stop_sequence) {
                        🏁
                      } @else {
                        •
                      }
                    </span>
                    <span class="mini-name">
                      {{ lang() === 'he' ? stop.stop_name_he : stop.stop_name }}
                    </span>
                    <span class="mini-code">#{{ stop.stop_code }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      }

      <div class="offers-section">
        <h3 class="offers-title">
          <span aria-hidden="true">☕</span>
          {{ labels().offersTitle }} ({{ state().nearby_offers.length }})
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
                  <span class="offer-dist">
                    {{ offer.walk_minutes }} {{ labels().min }} • {{ offer.distance_meters }} m
                  </span>
                </div>
                <p class="offer-promo">{{ offer.promo }}</p>
                @if (offer.maps_url) {
                  <a
                    class="offer-link"
                    [href]="offer.maps_url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ labels().openMaps }} ↗
                  </a>
                }
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
        padding-block: 1.15rem;
        padding-inline: 1.15rem;
        display: grid;
        gap: 0.95rem;
      }

      .interactive-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }

      .interactive-route {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-inline-size: 0;
        flex: 1 1 260px;
      }

      .route-badge-sm {
        display: grid;
        place-items: center;
        inline-size: 3rem;
        block-size: 3rem;
        flex-shrink: 0;
        border-radius: 0.75rem;
        background: #38bdf8;
        color: #041322;
        font-size: 1.25rem;
        font-weight: 800;
      }

      .route-info {
        min-inline-size: 0;
      }

      .interactive-pill {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.72rem;
        font-weight: 700;
        color: #34d399;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .dest-tag {
        color: #fbbf24;
      }

      .interactive-title {
        margin: 0.15rem 0 0;
        font-size: 1rem;
        font-weight: 700;
      }

      .bus-current-sub {
        margin: 0.15rem 0 0;
        font-size: 0.78rem;
        color: #cbd5e1;
      }

      .header-right {
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }

      .eta-box-interactive {
        background: #13223b;
        border: 1.5px solid #38bdf8;
        border-radius: 0.75rem;
        padding-block: 0.45rem;
        padding-inline: 0.85rem;
        text-align: end;
      }

      .eta-val {
        display: block;
        font-size: 1.15rem;
        font-weight: 800;
        color: #38bdf8;
      }

      .eta-sub {
        display: block;
        font-size: 0.72rem;
        color: #cbd5e1;
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
        min-inline-size: 2.2rem;
        block-size: 2.2rem;
        font-weight: 700;
        cursor: pointer;
      }

      .map-viewport {
        overflow: hidden;
        border-radius: 0.875rem;
        border: 1px solid #2b3c5d;
        background: #071524;
      }

      .leaflet-host {
        inline-size: 100%;
        block-size: 320px;
        z-index: 1;
      }

      /* Smooth 15s marker glides */
      .leaflet-marker-icon.nb-smooth-marker {
        transition: transform 1.2s ease-out;
      }

      .nb-pin-emoji {
        display: grid;
        place-items: center;
        inline-size: 30px;
        block-size: 30px;
        border-radius: 999px;
        font-size: 15px;
        border: 2px solid #f8fafc;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      }

      .nb-pin-user {
        background: #fbbf24;
        color: #0b1220;
      }

      .nb-pin-dest {
        background: #ef4444;
        color: #ffffff;
      }

      .nb-pin-bus-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding-block: 3px;
        padding-inline: 8px;
        border-radius: 999px;
        color: #041322;
        font-weight: 800;
        font-size: 12px;
        border: 2px solid #ffffff;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.55);
        white-space: nowrap;
      }

      .nb-pin-bus-pill.is-primary {
        transform: scale(1.1);
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.45), 0 4px 12px rgba(0, 0, 0, 0.6);
      }

      .nb-pin-cafe {
        background: #34d399;
        color: #041322;
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

      .top3-section {
        display: grid;
        gap: 0.7rem;
      }

      .top3-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
      }

      .dest-addr {
        font-size: 0.76rem;
        color: #94a3b8;
      }

      .top3-carousel {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 0.65rem;
      }

      .top3-card {
        text-align: start;
        background: #121d33;
        color: #f8fafc;
        border: 1.5px solid #2b3c5d;
        border-radius: 0.85rem;
        padding-block: 0.75rem;
        padding-inline: 0.85rem;
        display: grid;
        gap: 0.4rem;
        cursor: pointer;
        transition: border-color 0.2s ease, transform 0.15s ease;
      }

      .top3-card:hover {
        border-color: #38bdf8;
      }

      .top3-card.is-selected {
        background: #162642;
        border-color: #34d399;
        box-shadow: 0 0 0 1px #34d399;
      }

      .top3-card-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }

      .line-pill {
        color: #041322;
        font-size: 0.85rem;
        font-weight: 800;
        border-radius: 0.45rem;
        padding-block: 0.2rem;
        padding-inline: 0.55rem;
      }

      .fastest-badge {
        font-size: 0.7rem;
        font-weight: 700;
        color: #34d399;
        background: rgba(16, 185, 129, 0.15);
        border: 1px solid #10b981;
        border-radius: 999px;
        padding-block: 0.12rem;
        padding-inline: 0.5rem;
      }

      .rank-badge {
        font-size: 0.72rem;
        font-weight: 700;
        color: #94a3b8;
      }

      .top3-boarding {
        font-size: 0.8rem;
        color: #e2e8f0;
      }

      .stop-inline {
        display: block;
        font-size: 0.74rem;
        color: #94a3b8;
      }

      .top3-total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.4rem;
        font-size: 0.8rem;
        color: #7dd3fc;
        border-block-start: 1px solid #24344f;
        padding-block-start: 0.35rem;
      }

      .total-mins {
        color: #34d399;
        font-weight: 700;
      }

      .selected-timeline-box {
        background: #0e182b;
        border: 1px solid #24344f;
        border-radius: 0.75rem;
        padding-block: 0.65rem;
        padding-inline: 0.85rem;
        display: grid;
        gap: 0.5rem;
      }

      .timeline-head {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.8rem;
        color: #cbd5e1;
      }

      .mini-stop-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }

      .mini-stop {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.74rem;
        color: #cbd5e1;
        background: #131e33;
        border: 1px solid #24344f;
        border-radius: 0.45rem;
        padding-block: 0.2rem;
        padding-inline: 0.45rem;
      }

      .mini-stop.is-bus {
        border-color: #38bdf8;
        color: #7dd3fc;
      }

      .mini-stop.is-origin {
        border-color: #fbbf24;
        color: #fde68a;
      }

      .mini-stop.is-dest {
        border-color: #ef4444;
        color: #fca5a5;
      }

      .mini-code {
        color: #94a3b8;
        font-size: 0.68rem;
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
        grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
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

      .offer-link {
        font-size: 0.78rem;
        font-weight: 600;
        color: #7dd3fc;
        text-decoration: none;
      }

      .offer-link:hover {
        text-decoration: underline;
      }
    `
  ]
})
export class InteractiveMapViewComponent implements AfterViewInit, OnDestroy {
  readonly state = input.required<LiveBusStatusResponse>();
  readonly lang = input<WidgetLang>('ru');
  readonly entryContext = input<EntryContext>('standalone');
  readonly isSearching = input<boolean>(false);

  readonly switchDirection = output<0 | 1>();
  readonly searchDestination = output<string>();

  readonly selectedOptionIndex = signal<number>(0);

  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private busLayer: L.LayerGroup | null = null;
  private busMarkers = new Map<string, { marker: L.Marker; iconSig: string }>();
  private lastFitSignature = '';

  readonly recommendedOptions = computed<RecommendedBusOption[]>(
    () => this.state().recommended_options ?? []
  );

  readonly selectedOption = computed<RecommendedBusOption | null>(() => {
    const opts = this.recommendedOptions();
    if (opts.length === 0) return null;
    const idx = Math.min(this.selectedOptionIndex(), opts.length - 1);
    return opts[idx] ?? null;
  });

  readonly activeDisplayRoute = computed(
    () => this.selectedOption()?.route ?? this.state().route
  );

  readonly activeOriginStop = computed(
    () => this.selectedOption()?.origin_stop ?? this.state().user_stop
  );

  readonly activeBus = computed(
    () => this.selectedOption()?.bus ?? this.state().nearest_bus
  );

  readonly activeRankColor = computed(() => {
    const selected = this.selectedOption();
    return selected ? this.rankColor(selected.rank) : '#38bdf8';
  });

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          badge: 'מפה ותכנון מסלול • @defer',
          routeLabel: 'קו',
          tripTo: 'מסלולים ליעד:',
          busNowAt: 'האוטובוס כעת',
          nearestStop: 'תחנת עלייה',
          recenter: 'מרכז מסלול',
          top3Title: '3 האוטובוסים המהירים ביותר',
          fastest: 'הכי מהיר',
          lineWord: 'קו',
          routeWord: 'מסלול קו',
          arrivesIn: 'מגיע אליך בעוד',
          arriveAt: 'הגעה ביעד ב-',
          total: 'סה"כ',
          stopsWord: 'תחנות',
          offersTitle: 'בתי קפה אמיתיים בסביבה',
          noOffers: 'לא נמצאו בתי קפה בקרבת מקום.',
          min: 'דק׳',
          openMaps: 'פתח במפות'
        };
      case 'en':
        return {
          badge: 'Map & Top-3 Transit • @defer',
          routeLabel: 'Line',
          tripTo: 'Fastest buses to',
          busNowAt: 'Bus now at',
          nearestStop: 'Boarding stop',
          recenter: 'Center route',
          top3Title: 'Top-3 Fastest Buses',
          fastest: 'Fastest',
          lineWord: 'Line',
          routeWord: 'Line',
          arrivesIn: 'Arrives in',
          arriveAt: 'Arrive at',
          total: 'total',
          stopsWord: 'stops',
          offersTitle: 'Real Cafes Nearby (OpenStreetMap)',
          noOffers: 'No nearby cafes found.',
          min: 'min',
          openMaps: 'Open in Maps'
        };
      default:
        return {
          badge: 'Карта и Топ-3 маршрута • @defer',
          routeLabel: 'Маршрут',
          tripTo: 'Куда едем:',
          busNowAt: 'Автобус сейчас',
          nearestStop: 'Остановка посадки',
          recenter: 'Центрировать маршрут',
          top3Title: 'Топ-3 самых быстрых автобуса',
          fastest: 'Самый быстрый',
          lineWord: 'Маршрут',
          routeWord: 'Линия',
          arrivesIn: 'Прибудет к вам через',
          arriveAt: 'Будете на месте в',
          total: 'всего',
          stopsWord: 'ост.',
          offersTitle: 'Настоящие кафе рядом (OpenStreetMap)',
          noOffers: 'Кафе поблизости не найдены.',
          min: 'мин',
          openMaps: 'Открыть на карте'
        };
    }
  });

  readonly etaText = computed(() => {
    const eta = this.activeBus()?.eta_minutes;
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
    const stops = this.activeBus()?.stops_away ?? 0;
    if (this.lang() === 'he') return `${stops} תחנות ממך`;
    if (this.lang() === 'en') return `${stops} stops away`;
    return `${stops} ост. до вас`;
  });

  constructor() {
    effect(() => {
      const currentState = this.state();
      const currentLang = this.lang();
      const selectedIdx = this.selectedOptionIndex();
      if (this.map && this.markersLayer) {
        this.renderMapLayers(currentState, currentLang, selectedIdx);
      }
    });
  }

  ngAfterViewInit(): void {
    const container = this.mapEl()?.nativeElement;
    if (!container) return;

    const initial = this.state();
    const centerLat = initial.user_location?.lat ?? initial.user_stop.lat;
    const centerLon = initial.user_location?.lon ?? initial.user_stop.lon;

    this.map = L.map(container, {
      center: [centerLat, centerLon],
      zoom: 14,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
    this.busLayer = L.layerGroup().addTo(this.map);
    this.renderMapLayers(initial, this.lang(), this.selectedOptionIndex());
  }

  ngOnDestroy(): void {
    this.busMarkers.clear();
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markersLayer = null;
      this.busLayer = null;
    }
  }

  rankColor(rank: number): string {
    return RANK_COLORS[rank] ?? '#38bdf8';
  }

  selectOption(index: number): void {
    this.selectedOptionIndex.set(index);
  }

  recenterMap(): void {
    if (!this.map) return;
    this.lastFitSignature = '';
    this.renderMapLayers(this.state(), this.lang(), this.selectedOptionIndex());
  }

  private renderMapLayers(
    data: LiveBusStatusResponse,
    lang: WidgetLang,
    selectedIdx: number
  ): void {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];
    const opts = data.recommended_options ?? [];
    const activeOpt = opts[Math.min(selectedIdx, Math.max(0, opts.length - 1))] ?? null;

    // 1. Draw polyline & stop markers for active trip (or single route fallback)
    const activeTimeline = activeOpt?.timeline_stops ?? data.timeline_stops;
    const originStopSeq = activeOpt?.origin_stop.stop_sequence ?? data.user_stop.stop_sequence;
    const destStopSeq = activeOpt?.dest_stop.stop_sequence;
    const activeColor = activeOpt ? this.rankColor(activeOpt.rank) : '#38bdf8';

    if (activeTimeline.length > 0) {
      const polyCoords: L.LatLngExpression[] = activeTimeline.map((s) => [s.lat, s.lon]);
      L.polyline(polyCoords, { color: activeColor, weight: 4.5, opacity: 0.85 }).addTo(
        this.markersLayer
      );

      for (const stop of activeTimeline) {
        const isOrigin = stop.stop_sequence === originStopSeq;
        const isDest = destStopSeq !== undefined && stop.stop_sequence === destStopSeq;
        L.circleMarker([stop.lat, stop.lon], {
          radius: isOrigin || isDest ? 8 : 4.5,
          color: '#041322',
          weight: 2,
          fillColor: isDest ? '#ef4444' : isOrigin ? '#fbbf24' : '#cbd5e1',
          fillOpacity: 1
        })
          .bindPopup(
            `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Stop #${stop.stop_code}`
          )
          .addTo(this.markersLayer);
      }
    }

    // 2. User Position (Point A)
    if (data.user_location) {
      const userPos: L.LatLngExpression = [data.user_location.lat, data.user_location.lon];
      boundsPoints.push(userPos);
      const userIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-user">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker(userPos, { icon: userIcon })
        .bindPopup(
          `<strong>Point A (Your GPS)</strong><br/>${data.user_location.lat.toFixed(5)}, ${data.user_location.lon.toFixed(5)}`
        )
        .addTo(this.markersLayer);
    }

    // 3. Destination Marker (Point B) when searching A -> B
    if (data.destination) {
      const destPos: L.LatLngExpression = [data.destination.lat, data.destination.lon];
      boundsPoints.push(destPos);
      const destIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-dest">🏁</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      L.marker(destPos, { icon: destIcon })
        .bindPopup(`<strong>🏁 ${data.destination.place_name}</strong><br/>${data.destination.formatted_address}`)
        .addTo(this.markersLayer);
    }

    // 4. Live Bus Markers (Up to 3 for A -> B, or single bus) on dedicated smooth busLayer
    const activeBusKeys = new Set<string>();
    const busEntries: Array<{
      key: string;
      lat: number;
      lon: number;
      shortName: string;
      color: string;
      isPrimary: boolean;
      popupHtml: string;
    }> =
      opts.length > 0
        ? opts.map((opt, idx) => ({
            key: `${opt.route.route_id}:${opt.bus.vehicle_id}`,
            lat: opt.bus.lat,
            lon: opt.bus.lon,
            shortName: opt.route.short_name,
            color: this.rankColor(opt.rank),
            isPrimary: idx === selectedIdx,
            popupHtml:
              `<strong>${opt.route.short_name}</strong> (#${opt.rank})<br/>` +
              `ETA: ${opt.eta_to_boarding_min} min • Arrive ${opt.estimated_arrival_time}`
          }))
        : data.nearest_bus
          ? [
              {
                key: `${data.route.route_id}:${data.nearest_bus.vehicle_id}`,
                lat: data.nearest_bus.lat,
                lon: data.nearest_bus.lon,
                shortName: data.route.short_name,
                color: '#38bdf8',
                isPrimary: true,
                popupHtml: `<strong>Bus ${data.route.short_name}</strong> (${data.nearest_bus.vehicle_id})<br/>ETA: ${data.nearest_bus.eta_minutes} min`
              }
            ]
          : [];

    for (const item of busEntries) {
      activeBusKeys.add(item.key);
      const busPos: L.LatLngExpression = [item.lat, item.lon];
      boundsPoints.push(busPos);
      this.upsertBusMarker(
        item.key,
        busPos,
        item.shortName,
        item.color,
        item.isPrimary,
        item.popupHtml
      );
    }

    for (const [key, entry] of this.busMarkers) {
      if (!activeBusKeys.has(key)) {
        entry.marker.remove();
        this.busMarkers.delete(key);
      }
    }

    // 5. Real Cafes
    for (const offer of data.nearby_offers) {
      const cafePos: L.LatLngExpression = [offer.lat, offer.lon];
      const cafeIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-cafe">☕</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      L.marker(cafePos, { icon: cafeIcon })
        .bindPopup(
          `<strong>${lang === 'he' ? offer.name_he : offer.name}</strong><br/>${offer.distance_meters} m (${offer.walk_minutes} min walk)<br/>${offer.promo}`
        )
        .addTo(this.markersLayer);
    }

    const fitSignature = data.destination
      ? `${data.destination.lat.toFixed(4)},${data.destination.lon.toFixed(4)}:${opts.length}`
      : `${data.route.route_id}:${data.route.direction_id}`;

    if (this.lastFitSignature !== fitSignature && boundsPoints.length >= 2) {
      this.lastFitSignature = fitSignature;
      this.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36], maxZoom: 15 });
    }
  }

  private upsertBusMarker(
    key: string,
    busPos: L.LatLngExpression,
    shortName: string,
    color: string,
    isPrimary: boolean,
    popupHtml: string
  ): void {
    if (!this.busLayer) return;
    const iconSig = `${shortName}:${color}:${isPrimary}`;
    const existing = this.busMarkers.get(key);

    if (existing) {
      existing.marker.setLatLng(busPos).setPopupContent(popupHtml);
      if (existing.iconSig !== iconSig) {
        existing.marker.setIcon(
          L.divIcon({
            className: 'nb-smooth-marker',
            html: `<div class="nb-pin-bus-pill ${isPrimary ? 'is-primary' : ''}" style="background:${color}">🚌 ${shortName}</div>`,
            iconSize: [58, 26],
            iconAnchor: [29, 13]
          })
        );
        existing.iconSig = iconSig;
      }
      return;
    }

    const icon = L.divIcon({
      className: 'nb-smooth-marker',
      html: `<div class="nb-pin-bus-pill ${isPrimary ? 'is-primary' : ''}" style="background:${color}">🚌 ${shortName}</div>`,
      iconSize: [58, 26],
      iconAnchor: [29, 13]
    });
    const marker = L.marker(busPos, { icon }).bindPopup(popupHtml).addTo(this.busLayer);
    this.busMarkers.set(key, { marker, iconSig });
  }
}

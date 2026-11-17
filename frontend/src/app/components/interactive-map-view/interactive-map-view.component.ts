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
  viewChild
} from '@angular/core';
import * as L from 'leaflet';
import type { LiveBusStatusResponse, WidgetLang } from '../../models/bus.models';

@Component({
  selector: 'nb-interactive-map-view',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../../node_modules/leaflet/dist/leaflet.css'],
  template: `
    <section
      class="interactive-card nb-card"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      aria-label="Interactive transit map and nearby cafes"
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
            (click)="recenterMap()"
            [title]="labels().recenter"
          >
            🎯
          </button>
          <button
            type="button"
            class="ctrl-btn nb-btn"
            (click)="switchDirection.emit(state().route.direction_id === 0 ? 1 : 0)"
            title="Switch direction"
          >
            ⇄
          </button>
        </div>
      </header>

      <div class="map-viewport">
        <div #mapContainer class="leaflet-host" aria-label="OpenStreetMap interactive map"></div>
        <div class="map-hud">
          <span>
            <strong>{{ labels().nearestStop }}:</strong>
            {{ lang() === 'he' ? state().user_stop.stop_name_he : state().user_stop.stop_name }}
            (#{{ state().user_stop.stop_code }})
          </span>
          <span>
            ETA: {{ state().nearest_bus?.eta_minutes ?? '-' }} min
            ({{ state().nearest_bus?.stops_away ?? 0 }} stops)
          </span>
        </div>
      </div>

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

      .nb-pin-emoji {
        display: grid;
        place-items: center;
        inline-size: 28px;
        block-size: 28px;
        border-radius: 999px;
        font-size: 15px;
        border: 2px solid #f8fafc;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      }

      .nb-pin-user {
        background: #fbbf24;
        color: #0b1220;
      }

      .nb-pin-bus {
        background: #38bdf8;
        color: #041322;
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
  readonly switchDirection = output<0 | 1>();

  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapContainer');

  private map: L.Map | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private hasAutoFitted = false;

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          badge: 'מפה חיה (OpenStreetMap) • @defer',
          routeLabel: 'קו',
          nearestStop: 'תחנה קרובה',
          recenter: 'מרכז למיקום שלי',
          offersTitle: 'בתי קפה אמיתיים בסביבה',
          noOffers: 'לא נמצאו בתי קפה בקרבת מקום.',
          min: 'דק׳',
          openMaps: 'פתח במפות'
        };
      case 'en':
        return {
          badge: 'Live OSM Map • @defer Chunk',
          routeLabel: 'Line',
          nearestStop: 'Nearest stop',
          recenter: 'Center on my location',
          offersTitle: 'Real Cafes Nearby (OpenStreetMap)',
          noOffers: 'No nearby cafes found.',
          min: 'min',
          openMaps: 'Open in Maps'
        };
      default:
        return {
          badge: 'Живая карта OpenStreetMap • @defer',
          routeLabel: 'Маршрут',
          nearestStop: 'Ближайшая остановка',
          recenter: 'Центрировать на мне',
          offersTitle: 'Настоящие кафе рядом (OpenStreetMap)',
          noOffers: 'Кафе поблизости не найдены.',
          min: 'мин',
          openMaps: 'Открыть на карте'
        };
    }
  });

  constructor() {
    effect(() => {
      const currentState = this.state();
      const currentLang = this.lang();
      if (this.map && this.markersLayer) {
        this.renderMapLayers(currentState, currentLang);
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
      zoom: 15,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
    this.renderMapLayers(initial, this.lang());
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
      this.map = null;
      this.markersLayer = null;
    }
  }

  recenterMap(): void {
    if (!this.map) return;
    const current = this.state();
    const lat = current.user_location?.lat ?? current.user_stop.lat;
    const lon = current.user_location?.lon ?? current.user_stop.lon;
    this.map.setView([lat, lon], 15, { animate: true });
  }

  private renderMapLayers(data: LiveBusStatusResponse, lang: WidgetLang): void {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];

    // 1. Route path polyline & GTFS stops
    if (data.timeline_stops.length > 0) {
      const polyCoords: L.LatLngExpression[] = data.timeline_stops.map((s) => [s.lat, s.lon]);
      L.polyline(polyCoords, { color: '#38bdf8', weight: 4, opacity: 0.75 }).addTo(
        this.markersLayer
      );

      for (const stop of data.timeline_stops) {
        const isUserStop = stop.stop_sequence === data.user_stop.stop_sequence;
        L.circleMarker([stop.lat, stop.lon], {
          radius: isUserStop ? 8 : 5,
          color: '#041322',
          weight: 2,
          fillColor: isUserStop ? '#fbbf24' : '#cbd5e1',
          fillOpacity: 1
        })
          .bindPopup(
            `<strong>${lang === 'he' ? stop.stop_name_he : stop.stop_name}</strong><br/>Stop #${stop.stop_code}`
          )
          .addTo(this.markersLayer);
      }
    }

    // 2. User exact GPS location
    if (data.user_location) {
      const userPos: L.LatLngExpression = [data.user_location.lat, data.user_location.lon];
      boundsPoints.push(userPos);
      const userIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-user">📍</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      L.marker(userPos, { icon: userIcon })
        .bindPopup(
          `<strong>Your Location</strong><br/>${data.user_location.lat.toFixed(5)}, ${data.user_location.lon.toFixed(5)}`
        )
        .addTo(this.markersLayer);
    }

    boundsPoints.push([data.user_stop.lat, data.user_stop.lon]);

    // 3. Live bus position
    if (data.nearest_bus) {
      const busPos: L.LatLngExpression = [data.nearest_bus.lat, data.nearest_bus.lon];
      boundsPoints.push(busPos);
      const busIcon = L.divIcon({
        className: '',
        html: '<div class="nb-pin-emoji nb-pin-bus">🚌</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      L.marker(busPos, { icon: busIcon })
        .bindPopup(
          `<strong>Bus ${data.route.short_name}</strong> (${data.nearest_bus.vehicle_id})<br/>ETA: ${data.nearest_bus.eta_minutes} min • ${data.nearest_bus.stops_away} stops`
        )
        .addTo(this.markersLayer);
    }

    // 4. Real nearby cafes from OpenStreetMap
    for (const offer of data.nearby_offers) {
      const cafePos: L.LatLngExpression = [offer.lat, offer.lon];
      boundsPoints.push(cafePos);
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

    if (!this.hasAutoFitted && boundsPoints.length >= 2) {
      this.hasAutoFitted = true;
      this.map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32], maxZoom: 16 });
    }
  }
}

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import type { WidgetLang } from '../../models/bus.models';
import { VoiceRecognitionService } from '../../services/voice-recognition.service';

@Component({
  selector: 'nb-search-bar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="search-shell"
      [attr.dir]="lang() === 'he' ? 'rtl' : 'ltr'"
      role="search"
      aria-label="Destination or bus line search"
    >
      <form class="search-pill" (submit)="onSubmit($event)">
        <span class="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="7.5" />
            <path d="m20 20-3.8-3.8" />
          </svg>
        </span>

        <input
          type="text"
          class="search-input"
          [value]="query()"
          (input)="onInput($event)"
          [placeholder]="labels().placeholder"
          [attr.aria-label]="labels().placeholder"
          autocomplete="off"
        />

        @if (query()) {
          <button
            type="button"
            class="icon-action clear-btn"
            (click)="query.set('')"
            [title]="labels().clear"
            [attr.aria-label]="labels().clear"
          >
            ✕
          </button>

          <button
            type="submit"
            class="icon-action go-btn"
            [disabled]="isSearching()"
            [title]="labels().find"
            [attr.aria-label]="labels().find"
          >
            {{ isSearching() ? '…' : '↵' }}
          </button>
        }

        <button
          type="button"
          class="icon-action mic-btn"
          [class.is-recording]="voice.isListening()"
          (click)="toggleVoiceSearch()"
          [title]="voice.isListening() ? labels().stopVoice : labels().startVoice"
          [attr.aria-label]="voice.isListening() ? labels().stopVoice : labels().startVoice"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 14.5a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 1 0-6.4 0v5.1a3.2 3.2 0 0 0 3.2 3.2Z"/>
            <path d="M17.3 11.3a.8.8 0 0 0-1.6 0 3.7 3.7 0 1 1-7.4 0 .8.8 0 0 0-1.6 0 5.3 5.3 0 0 0 4.5 5.24V19H9.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-1.7v-2.46a5.3 5.3 0 0 0 4.5-5.24Z"/>
          </svg>
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .search-shell {
        inline-size: 100%;
      }

      .search-pill {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        background: #dfe5ec;
        color: #1e293b;
        border-radius: 0.95rem;
        padding-block: 0.52rem;
        padding-inline: 0.85rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
        transition: box-shadow 0.15s ease;
      }

      .search-pill:focus-within {
        box-shadow: 0 0 0 2.5px rgba(59, 130, 246, 0.55);
      }

      .search-icon {
        color: #6b7280;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
      }

      .search-input {
        flex: 1 1 auto;
        min-inline-size: 0;
        background: transparent;
        border: none;
        color: #111827;
        font-size: 0.96rem;
        font-weight: 500;
        padding-block: 0.25rem;
        outline: none;
      }

      .search-input::placeholder {
        color: #6b7280;
        font-weight: 400;
      }

      .icon-action {
        background: transparent;
        border: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.28rem;
        border-radius: 999px;
        cursor: pointer;
        flex-shrink: 0;
        color: #525c6a;
        transition: background-color 0.15s ease, color 0.15s ease;
      }

      .icon-action:hover {
        background: rgba(15, 23, 42, 0.08);
        color: #0f172a;
      }

      .go-btn {
        font-size: 0.95rem;
        font-weight: 700;
        color: #2563eb;
      }

      .clear-btn {
        font-size: 0.82rem;
      }

      .mic-btn.is-recording {
        background: #fee2e2;
        color: #dc2626;
        animation: nb-pulse 1.1s ease-in-out infinite;
      }

      @keyframes nb-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45);
        }
        50% {
          box-shadow: 0 0 0 6px rgba(220, 38, 38, 0);
        }
      }
    `
  ]
})
export class SearchBarComponent {
  readonly voice = inject(VoiceRecognitionService);

  readonly lang = input<WidgetLang>('ru');
  readonly isSearching = input<boolean>(false);
  readonly showQuickChips = input<boolean>(false);
  readonly searchSubmitted = output<string>();

  readonly query = signal<string>('');

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          placeholder: 'חפש קו או יעד',
          find: 'חיפוש',
          clear: 'נקה',
          startVoice: 'חיפוש קולי',
          stopVoice: 'עצור הקלטה'
        };
      case 'en':
        return {
          placeholder: 'Search Route or Location',
          find: 'Find Route',
          clear: 'Clear',
          startVoice: 'Voice search',
          stopVoice: 'Stop recording'
        };
      default:
        return {
          placeholder: 'Поиск маршрута или места',
          find: 'Найти',
          clear: 'Очистить',
          startVoice: 'Голосовой поиск',
          stopVoice: 'Остановить запись'
        };
    }
  });

  constructor() {
    effect(() => {
      const liveTranscript = this.voice.transcript();
      if (this.voice.isListening() && liveTranscript) {
        this.query.set(liveTranscript);
      }
    });
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    const cleaned = this.query().trim();
    if (cleaned) {
      this.searchSubmitted.emit(cleaned);
    }
  }

  toggleVoiceSearch(): void {
    this.voice.startListening(this.lang(), (finalText) => {
      this.query.set(finalText);
      this.searchSubmitted.emit(finalText);
    });
  }
}

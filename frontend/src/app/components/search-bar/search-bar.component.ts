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
      aria-label="Destination bus route search"
    >
      <form class="search-form" (submit)="onSubmit($event)">
        <div class="input-wrap">
          <span class="search-icon" aria-hidden="true">🔍</span>
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
              class="clear-btn"
              (click)="query.set('')"
              [title]="labels().clear"
              [attr.aria-label]="labels().clear"
            >
              ✕
            </button>
          }
        </div>

        <button
          type="button"
          class="mic-btn nb-btn"
          [class.is-recording]="voice.isListening()"
          (click)="toggleVoiceSearch()"
          [title]="voice.isListening() ? labels().stopVoice : labels().startVoice"
          [attr.aria-label]="voice.isListening() ? labels().stopVoice : labels().startVoice"
        >
          <span class="mic-dot" aria-hidden="true">
            {{ voice.isListening() ? '●' : '🎙️' }}
          </span>
          @if (voice.isListening()) {
            <span class="mic-label">{{ labels().listening }}</span>
          }
        </button>

        <button
          type="submit"
          class="submit-btn nb-btn"
          [disabled]="isSearching() || !query().trim()"
        >
          {{ isSearching() ? labels().searching : labels().find }}
        </button>
      </form>

      @if (showQuickChips()) {
        <div class="quick-chips">
          <span class="chips-caption">{{ labels().quickLabel }}:</span>
          @for (chip of labels().chips; track chip) {
            <button
              type="button"
              class="chip-btn"
              (click)="selectQuickDestination(chip)"
            >
              {{ chip }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .search-shell {
        background: #101b2e;
        border: 1px solid #2b3c5d;
        border-radius: 0.875rem;
        padding-block: 0.75rem;
        padding-inline: 0.85rem;
        display: grid;
        gap: 0.55rem;
      }

      .search-form {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }

      .input-wrap {
        position: relative;
        flex: 1 1 230px;
        min-inline-size: 0;
        display: flex;
        align-items: center;
        background: #070d18;
        border: 1px solid #33486e;
        border-radius: 0.625rem;
        padding-inline: 0.65rem;
      }

      .input-wrap:focus-within {
        border-color: #38bdf8;
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
      }

      .search-icon {
        font-size: 0.9rem;
        margin-inline-end: 0.45rem;
        flex-shrink: 0;
      }

      .search-input {
        flex: 1 1 auto;
        min-inline-size: 0;
        background: transparent;
        border: none;
        color: #f8fafc;
        font-size: 0.875rem;
        padding-block: 0.55rem;
        outline: none;
      }

      .search-input::placeholder {
        color: #94a3b8;
      }

      .clear-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 0.8rem;
        padding: 0.25rem;
      }

      .mic-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: #13223b;
        color: #f8fafc;
        border: 1px solid #33486e;
        border-radius: 0.625rem;
        padding-block: 0.52rem;
        padding-inline: 0.75rem;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;
      }

      .mic-btn.is-recording {
        background: #450a0a;
        border-color: #ef4444;
        color: #fecaca;
        animation: nb-pulse 1.1s ease-in-out infinite;
      }

      @keyframes nb-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.55);
        }
        50% {
          box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
        }
      }

      .submit-btn {
        background: #38bdf8;
        color: #041322;
        border: 1px solid #38bdf8;
        border-radius: 0.625rem;
        padding-block: 0.52rem;
        padding-inline: 1rem;
        font-size: 0.85rem;
        font-weight: 800;
        cursor: pointer;
      }

      .submit-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .quick-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.75rem;
      }

      .chips-caption {
        color: #94a3b8;
      }

      .chip-btn {
        background: #172540;
        color: #cbd5e1;
        border: 1px solid #2b3c5d;
        border-radius: 999px;
        padding-block: 0.2rem;
        padding-inline: 0.6rem;
        font-size: 0.74rem;
        cursor: pointer;
      }

      .chip-btn:hover {
        border-color: #38bdf8;
        color: #f8fafc;
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
          placeholder: 'לאן נוסעים? למשל: מרפאה בחורב, חיפה...',
          find: 'חפש מסלול',
          searching: 'מחפש...',
          clear: 'נקה',
          startVoice: 'חיפוש קולי',
          stopVoice: 'עצור הקלטה',
          listening: 'מקשיב...',
          quickLabel: 'יעדים מהירים',
          chips: ['מרכז חורב', 'אוניברסיטת חיפה', 'בית חולים רמב"ם', 'טכניון']
        };
      case 'en':
        return {
          placeholder: 'Where to? e.g. Clinic on Horev, Haifa...',
          find: 'Find Route',
          searching: 'Searching...',
          clear: 'Clear',
          startVoice: 'Voice search',
          stopVoice: 'Stop recording',
          listening: 'Listening...',
          quickLabel: 'Quick destinations',
          chips: ['Horev Clinic Haifa', 'University of Haifa', 'Rambam Hospital', 'Technion']
        };
      default:
        return {
          placeholder: 'Куда едем? Например: поликлиника на Хорев...',
          find: 'Найти маршрут',
          searching: 'Поиск...',
          clear: 'Очистить',
          startVoice: 'Голосовой поиск',
          stopVoice: 'Остановить запись',
          listening: 'Слушаю...',
          quickLabel: 'Быстро',
          chips: ['Хорев Хайфа', 'Университет Хайфы', 'Больница Рамбам', 'Технион Хайфа']
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

  selectQuickDestination(dest: string): void {
    this.query.set(dest);
    this.searchSubmitted.emit(dest);
  }

  toggleVoiceSearch(): void {
    this.voice.startListening(this.lang(), (finalText) => {
      this.query.set(finalText);
      this.searchSubmitted.emit(finalText);
    });
  }
}

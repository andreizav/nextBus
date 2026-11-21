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
  host: {
    '(window:pointerup)': 'onGlobalPointerUp()',
    '(window:pointercancel)': 'onGlobalPointerUp()'
  },
  template: `
    <div
      class="search-shell"
      [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'"
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
          (click)="openVoiceModalFromIcon()"
          [title]="voice.isListening() ? labels().stopVoice : labels().startVoice"
          [attr.aria-label]="voice.isListening() ? labels().stopVoice : labels().startVoice"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 14.5a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 1 0-6.4 0v5.1a3.2 3.2 0 0 0 3.2 3.2Z"/>
            <path d="M17.3 11.3a.8.8 0 0 0-1.6 0 3.7 3.7 0 1 1-7.4 0 .8.8 0 0 0-1.6 0 5.3 5.3 0 0 0 4.5 5.24V19H9.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-1.7v-2.46a5.3 5.3 0 0 0 4.5-5.24Z"/>
          </svg>
        </button>
      </form>

      <!-- Prominent Centered Push-To-Talk Voice Button -->
      <div class="ptt-center-row">
        <button
          type="button"
          class="ptt-hero-btn"
          [class.is-recording]="voice.isListening()"
          (pointerdown)="onPttPressStart($event)"
          (contextmenu)="$event.preventDefault()"
          [attr.aria-label]="labels().pttButton"
        >
          <span class="ptt-mic-ring" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M12 14.5a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 1 0-6.4 0v5.1a3.2 3.2 0 0 0 3.2 3.2Z"/>
              <path d="M17.3 11.3a.8.8 0 0 0-1.6 0 3.7 3.7 0 1 1-7.4 0 .8.8 0 0 0-1.6 0 5.3 5.3 0 0 0 4.5 5.24V19H9.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-1.7v-2.46a5.3 5.3 0 0 0 4.5-5.24Z"/>
            </svg>
          </span>
          <span class="ptt-btn-label">{{ labels().pttButton }}</span>
        </button>
      </div>
    </div>

    <!-- Push-To-Talk Interactive Modal Overlay -->
    @if (isPttModalOpen()) {
      <div
        class="ptt-modal-backdrop"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="labels().pttModalTitle"
        (click)="onBackdropClick($event)"
      >
        <div class="ptt-modal-card" [attr.dir]="lang() === 'he' || lang() === 'ar' ? 'rtl' : 'ltr'">
          <button
            type="button"
            class="ptt-close-btn"
            (click)="closePttModal()"
            [title]="labels().closePtt"
            [attr.aria-label]="labels().closePtt"
          >
            ✕
          </button>

          <div class="ptt-modal-title">{{ labels().pttModalTitle }}</div>

          <button
            type="button"
            class="ptt-modal-mic"
            [class.is-listening]="voice.isListening()"
            (pointerdown)="onModalMicPressStart($event)"
            (contextmenu)="$event.preventDefault()"
            [attr.aria-label]="voice.isListening() ? labels().pttReleaseHint : labels().pttHoldHint"
          >
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
              <path d="M12 14.5a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 1 0-6.4 0v5.1a3.2 3.2 0 0 0 3.2 3.2Z"/>
              <path d="M17.3 11.3a.8.8 0 0 0-1.6 0 3.7 3.7 0 1 1-7.4 0 .8.8 0 0 0-1.6 0 5.3 5.3 0 0 0 4.5 5.24V19H9.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-1.7v-2.46a5.3 5.3 0 0 0 4.5-5.24Z"/>
            </svg>
          </button>

          <div class="ptt-status-text">
            {{
              voice.error()
                ? voiceErrorText()
                : voice.isListening()
                  ? (isHoldingPtt ? labels().pttReleaseHint : labels().pttTapStopHint)
                  : labels().pttHoldHint
            }}
          </div>

          <div class="ptt-transcript-box" dir="auto">
            {{ voice.transcript() || labels().pttPlaceholder }}
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .search-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 0.65rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .search-pill {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        background: #dfe5ec;
        color: #1e293b;
        border-radius: 0.95rem;
        padding-block: 0.52rem;
        padding-inline: 0.8rem;
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

      /* Prominent Centered Push-To-Talk Button */
      .ptt-center-row {
        display: flex;
        justify-content: center;
        align-items: center;
        min-inline-size: 0;
        max-inline-size: 100%;
      }

      .ptt-hero-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        inline-size: min(100%, 300px);
        padding: 0.58rem 1.05rem;
        border-radius: 999px;
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: linear-gradient(135deg, rgba(48, 135, 246, 0.28), rgba(14, 165, 233, 0.2));
        color: #f0f9ff;
        font-size: 0.88rem;
        font-weight: 700;
        letter-spacing: 0.01em;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        box-shadow: 0 6px 20px rgba(37, 99, 235, 0.25);
        transition: transform 0.14s ease, box-shadow 0.15s ease, background 0.15s ease;
      }

      .ptt-hero-btn:hover {
        background: linear-gradient(135deg, rgba(48, 135, 246, 0.42), rgba(14, 165, 233, 0.34));
        box-shadow: 0 8px 24px rgba(56, 189, 248, 0.32);
      }

      .ptt-hero-btn:active,
      .ptt-hero-btn.is-recording {
        transform: scale(0.98);
        border-color: #f87171;
        background: linear-gradient(135deg, rgba(220, 38, 38, 0.45), rgba(239, 68, 68, 0.32));
        box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25);
      }

      .ptt-mic-ring {
        display: grid;
        place-items: center;
        inline-size: 2rem;
        block-size: 2rem;
        border-radius: 999px;
        background: #3087f6;
        color: #ffffff;
        flex-shrink: 0;
        box-shadow: 0 0 12px rgba(48, 135, 246, 0.6);
      }

      .ptt-hero-btn.is-recording .ptt-mic-ring {
        background: #ef4444;
        box-shadow: 0 0 14px rgba(239, 68, 68, 0.75);
      }

      .ptt-btn-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Push-To-Talk Modal Overlay */
      .ptt-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: rgba(8, 13, 20, 0.78);
        backdrop-filter: blur(8px);
      }

      .ptt-modal-card {
        position: relative;
        display: grid;
        justify-items: center;
        gap: 0.9rem;
        inline-size: min(360px, 100%);
        padding: 1.5rem 1.25rem 1.35rem;
        border-radius: 1.5rem;
        background: linear-gradient(180deg, #242c36 0%, #181f27 100%);
        border: 1px solid rgba(96, 165, 250, 0.35);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
        text-align: center;
        color: #f8fafc;
      }

      .ptt-close-btn {
        position: absolute;
        top: 0.85rem;
        inset-inline-end: 0.85rem;
        inline-size: 1.9rem;
        block-size: 1.9rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
        font-size: 0.82rem;
        cursor: pointer;
      }

      .ptt-modal-title {
        font-size: 0.96rem;
        font-weight: 700;
        color: #e2e8f0;
      }

      .ptt-modal-mic {
        display: grid;
        place-items: center;
        inline-size: 96px;
        block-size: 96px;
        border-radius: 999px;
        border: 3px solid rgba(96, 165, 250, 0.85);
        background: radial-gradient(circle at 35% 30%, #3b82f6, #1d4ed8);
        color: #ffffff;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        box-shadow: 0 0 0 10px rgba(59, 130, 246, 0.2), 0 10px 26px rgba(29, 78, 216, 0.5);
        transition: transform 0.14s ease;
      }

      .ptt-modal-mic.is-listening {
        border-color: #fca5a5;
        background: radial-gradient(circle at 35% 30%, #ef4444, #b91c1c);
        animation: nb-pulse 1.1s ease-in-out infinite;
      }

      .ptt-status-text {
        font-size: 0.8rem;
        font-weight: 600;
        color: #93c5fd;
      }

      .ptt-transcript-box {
        inline-size: 100%;
        min-block-size: 2.75rem;
        padding: 0.65rem 0.85rem;
        border-radius: 0.9rem;
        background: rgba(15, 23, 34, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #f8fafc;
        font-size: 0.9rem;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      @keyframes nb-pulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45);
        }
        50% {
          box-shadow: 0 0 0 12px rgba(220, 38, 38, 0);
        }
      }
    `
  ]
})
export class SearchBarComponent {
  readonly voice = inject(VoiceRecognitionService);

  readonly lang = input<WidgetLang>('he');
  readonly isSearching = input<boolean>(false);
  readonly showQuickChips = input<boolean>(false);
  readonly searchSubmitted = output<string>();

  readonly query = signal<string>('');
  readonly isPttModalOpen = signal<boolean>(false);

  isHoldingPtt = false;
  private pressStartedAtMs = 0;

  readonly labels = computed(() => {
    switch (this.lang()) {
      case 'he':
        return {
          placeholder: 'חפש קו או יעד',
          find: 'חיפוש',
          clear: 'נקה',
          startVoice: 'חיפוש קולי',
          stopVoice: 'עצור הקלטה',
          pttButton: 'החזק ודבר • חיפוש קולי',
          pttModalTitle: 'חיפוש קולי (Push-To-Talk)',
          pttHoldHint: 'החזק את המיקרופון ודבר…',
          pttReleaseHint: 'מדבר… שחרר כדי לחפש',
          pttTapStopHint: 'מקשיב… הקש לסיום וחיפוש',
          pttPlaceholder: 'לדוגמה: «ירושלים» או «קו 49»',
          pttUnsupported: 'זיהוי קול אינו נתמך בדפדפן זה',
          pttDenied: 'הגישה למיקרופון נחסמה בדפדפן',
          closePtt: 'סגור'
        };
      case 'ar':
        return {
          placeholder: 'ابحث عن خط أو وجهة',
          find: 'بحث',
          clear: 'مسح',
          startVoice: 'بحث صوتي',
          stopVoice: 'إيقاف التسجيل',
          pttButton: 'اضغط مطولاً وتحدث',
          pttModalTitle: 'بحث صوتي (Push-To-Talk)',
          pttHoldHint: 'اضغط مطولاً على الميكروفون وتحدث…',
          pttReleaseHint: 'يتم الاستماع… اترك للبحث',
          pttTapStopHint: 'يستمع… اضغط للإيقاف والبحث',
          pttPlaceholder: 'مثال: «القدس» أو «خط 49»',
          pttUnsupported: 'التعرف الصوتي غير مدعوم في هذا المتصفح',
          pttDenied: 'تم رفض إذن الميكروفون',
          closePtt: 'إغلاق'
        };
      case 'uk':
        return {
          placeholder: 'Пошук маршруту або місця',
          find: 'Знайти',
          clear: 'Очистити',
          startVoice: 'Голосовий пошук',
          stopVoice: 'Зупинити запис',
          pttButton: 'Утримуйте та говоріть',
          pttModalTitle: 'Голосовий пошук (Push-To-Talk)',
          pttHoldHint: 'Натисніть і утримуйте мікрофон…',
          pttReleaseHint: 'Говоріть… відпустіть для пошуку',
          pttTapStopHint: 'Слухаю… натисніть для пошуку',
          pttPlaceholder: 'Наприклад: «Єрусалим» або «автобус 49»',
          pttUnsupported: 'Голосовий ввід не підтримується цим браузером',
          pttDenied: 'Доступ до мікрофона заборонено',
          closePtt: 'Закрити'
        };
      case 'en':
        return {
          placeholder: 'Search Route or Location',
          find: 'Find Route',
          clear: 'Clear',
          startVoice: 'Voice search',
          stopVoice: 'Stop recording',
          pttButton: 'Hold to Talk • Voice Search',
          pttModalTitle: 'Voice Search (Push-To-Talk)',
          pttHoldHint: 'Press & hold the microphone to speak…',
          pttReleaseHint: 'Listening… release to search',
          pttTapStopHint: 'Listening… tap to finish & search',
          pttPlaceholder: 'Try: “Jerusalem” or “Line 49”',
          pttUnsupported: 'Speech recognition is not supported in this browser',
          pttDenied: 'Microphone access was denied',
          closePtt: 'Close'
        };
      default:
        return {
          placeholder: 'Поиск маршрута или места',
          find: 'Найти',
          clear: 'Очистить',
          startVoice: 'Голосовой поиск',
          stopVoice: 'Остановить запись',
          pttButton: 'Удерживайте и говорите',
          pttModalTitle: 'Голосовой поиск (Push-To-Talk)',
          pttHoldHint: 'Нажмите и удерживайте микрофон…',
          pttReleaseHint: 'Говорите… отпустите для поиска',
          pttTapStopHint: 'Слушаю… нажмите для поиска',
          pttPlaceholder: 'Например: «Иерусалим» или «автобус 49»',
          pttUnsupported: 'Голосовой ввод не поддерживается в этом браузере',
          pttDenied: 'Доступ к микрофону запрещён',
          closePtt: 'Закрыть'
        };
    }
  });

  readonly voiceErrorText = computed(() => {
    const err = this.voice.error();
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      return this.labels().pttDenied;
    }
    return this.labels().pttUnsupported;
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

  private beginPushToTalkSession(): void {
    this.voice.startPushToTalk(
      this.lang(),
      (finalText) => {
        this.query.set(finalText);
        this.isPttModalOpen.set(false);
        this.searchSubmitted.emit(finalText);
      },
      () => {
        if (!this.voice.error() && !this.isHoldingPtt) {
          this.isPttModalOpen.set(false);
        }
      }
    );
  }

  onPttPressStart(event: PointerEvent): void {
    event.preventDefault();
    this.pressStartedAtMs = Date.now();
    this.isHoldingPtt = true;
    this.isPttModalOpen.set(true);
    this.beginPushToTalkSession();
  }

  onModalMicPressStart(event: PointerEvent): void {
    event.preventDefault();
    this.pressStartedAtMs = Date.now();
    this.isHoldingPtt = true;
    if (!this.voice.isListening()) {
      this.beginPushToTalkSession();
    }
  }

  onGlobalPointerUp(): void {
    if (!this.isHoldingPtt) return;
    this.isHoldingPtt = false;
    const heldMs = Date.now() - this.pressStartedAtMs;
    const hasTranscript = this.voice.transcript().trim().length > 0;
    if (heldMs >= 250 || hasTranscript) {
      this.voice.stopAndSubmitPushToTalk();
      if (!this.voice.error() && !hasTranscript) {
        this.isPttModalOpen.set(false);
      }
    }
  }

  openVoiceModalFromIcon(): void {
    this.isHoldingPtt = false;
    this.isPttModalOpen.set(true);
    this.beginPushToTalkSession();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closePttModal();
    }
  }

  closePttModal(): void {
    this.isHoldingPtt = false;
    this.voice.cancelListening();
    this.isPttModalOpen.set(false);
  }
}

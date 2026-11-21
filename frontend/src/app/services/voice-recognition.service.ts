import { Injectable, signal } from '@angular/core';
import type { WidgetLang } from '../models/bus.models';

interface SpeechRecognitionResultAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionResultAlternative;
}

interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultItem;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

@Injectable({
  providedIn: 'root'
})
export class VoiceRecognitionService {
  readonly isSupported = signal<boolean>(this.detectSupport());
  readonly isListening = signal<boolean>(false);
  readonly transcript = signal<string>('');
  readonly error = signal<string | null>(null);

  private activeRecognition: SpeechRecognitionLike | null = null;
  private pendingFinalCallback: ((text: string) => void) | null = null;
  private pendingEndedCallback: (() => void) | null = null;

  private detectSupport(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  private getSpeechLocale(lang: WidgetLang): string {
    switch (lang) {
      case 'he':
        return 'he-IL';
      case 'en':
        return 'en-US';
      case 'ar':
        return 'ar-IL';
      case 'uk':
        return 'uk-UA';
      default:
        return 'ru-RU';
    }
  }

  private beginRecognition(
    lang: WidgetLang,
    continuous: boolean,
    onFinalTranscript: (text: string) => void,
    onSessionEnded?: () => void
  ): void {
    if (typeof window === 'undefined') {
      this.error.set('speech-unsupported');
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      this.error.set('speech-unsupported');
      return;
    }

    this.error.set(null);
    this.transcript.set('');
    this.pendingFinalCallback = onFinalTranscript;
    this.pendingEndedCallback = onSessionEnded ?? null;

    const recognition = new Ctor();
    recognition.lang = this.getSpeechLocale(lang);
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.isListening.set(true);
    };

    recognition.onresult = (event) => {
      const chunks: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript?.trim();
        if (piece) {
          chunks.push(piece);
        }
      }
      this.transcript.set(chunks.join(' ').trim());
    };

    recognition.onerror = (event) => {
      this.error.set(event.error || 'recognition-error');
      this.isListening.set(false);
    };

    recognition.onend = () => {
      this.isListening.set(false);
      this.activeRecognition = null;
      const finalCb = this.pendingFinalCallback;
      const endedCb = this.pendingEndedCallback;
      this.pendingFinalCallback = null;
      this.pendingEndedCallback = null;

      const resolvedText = this.transcript().trim();
      if (finalCb && resolvedText) {
        finalCb(resolvedText);
      } else if (endedCb) {
        endedCb();
      }
    };

    this.activeRecognition = recognition;
    try {
      recognition.start();
    } catch {
      this.pendingFinalCallback = null;
      this.pendingEndedCallback = null;
      this.activeRecognition = null;
      this.isListening.set(false);
      this.error.set('start-failed');
    }
  }

  startListening(
    lang: WidgetLang,
    onFinalTranscript: (text: string) => void
  ): void {
    if (this.isListening()) {
      this.stopListening();
      return;
    }
    this.beginRecognition(lang, false, onFinalTranscript);
  }

  startPushToTalk(
    lang: WidgetLang,
    onFinalTranscript: (text: string) => void,
    onSessionEnded?: () => void
  ): void {
    this.cancelListening();
    this.beginRecognition(lang, true, onFinalTranscript, onSessionEnded);
  }

  stopAndSubmitPushToTalk(): void {
    if (this.activeRecognition) {
      try {
        this.activeRecognition.stop();
      } catch {
        // Ignore stop errors if already ended
      }
    }
    this.isListening.set(false);
  }

  cancelListening(): void {
    this.pendingFinalCallback = null;
    this.pendingEndedCallback = null;
    if (this.activeRecognition) {
      try {
        this.activeRecognition.abort();
      } catch {
        // Ignore abort errors
      }
      this.activeRecognition = null;
    }
    this.isListening.set(false);
    this.transcript.set('');
  }

  stopListening(): void {
    this.stopAndSubmitPushToTalk();
    this.activeRecognition = null;
  }
}

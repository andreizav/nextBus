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
      default:
        return 'ru-RU';
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

    const recognition = new Ctor();
    recognition.lang = this.getSpeechLocale(lang);
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalBuffer = '';

    recognition.onstart = () => {
      this.isListening.set(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const piece = res?.[0]?.transcript ?? '';
        if (res?.isFinal) {
          finalBuffer += `${piece} `;
        } else {
          interim += piece;
        }
      }
      const combined = `${finalBuffer}${interim}`.trim();
      this.transcript.set(combined);
    };

    recognition.onerror = (event) => {
      this.error.set(event.error || 'recognition-error');
      this.isListening.set(false);
    };

    recognition.onend = () => {
      this.isListening.set(false);
      this.activeRecognition = null;
      const resolvedText = (finalBuffer || this.transcript()).trim();
      if (resolvedText) {
        onFinalTranscript(resolvedText);
      }
    };

    this.activeRecognition = recognition;
    try {
      recognition.start();
    } catch {
      this.isListening.set(false);
      this.error.set('start-failed');
    }
  }

  stopListening(): void {
    if (this.activeRecognition) {
      try {
        this.activeRecognition.stop();
      } catch {
        // Ignore stop errors if already ended
      }
      this.activeRecognition = null;
    }
    this.isListening.set(false);
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  viewChild
} from '@angular/core';
import type { WidgetLang } from '../../models/bus.models';

interface SourceLink {
  readonly href: string;
  readonly label: Record<WidgetLang, string>;
}

const SOURCE_LINKS: readonly SourceLink[] = [
  {
    href: 'https://www.gov.il/en/departments/public_transportion_authority',
    label: {
      en: 'National Public Transport Authority (Israel Ministry of Transport)',
      he: 'הרשות הארצית לתחבורה ציבורית (משרד התחבורה)',
      ar: 'الهيئة الوطنية للمواصلات العامة (وزارة المواصلات الإسرائيلية)',
      ru: 'Национальное управление общественного транспорта (Минтранс Израиля)',
      uk: 'Національне управління громадського транспорту (Мінтранс Ізраїлю)'
    }
  },
  {
    href: 'https://www.gov.il/he/pages/gtfs_general_transit_feed_specifications',
    label: {
      en: 'Official GTFS static schedule data',
      he: 'נתוני לוחות זמנים רשמיים (GTFS)',
      ar: 'بيانات الجداول الرسمية (GTFS)',
      ru: 'Официальные данные расписаний (GTFS)',
      uk: 'Офіційні дані розкладів (GTFS)'
    }
  },
  {
    href: 'https://www.gov.il/he/pages/real_time_information_siri',
    label: {
      en: 'Official SIRI real-time data',
      he: 'נתוני זמן אמת רשמיים (SIRI)',
      ar: 'بيانات الوقت الفعلي الرسمية (SIRI)',
      ru: 'Официальные данные реального времени (SIRI)',
      uk: 'Офіційні дані реального часу (SIRI)'
    }
  },
  {
    href: 'https://open-bus-stride-api.hasadna.org.il/docs',
    label: {
      en: 'Open data aggregator: The Public Knowledge Workshop — Open Bus Stride API',
      he: 'מאגר נתונים פתוחים: הסדנא לידע ציבורי — Open Bus Stride API',
      ar: 'مجمّع البيانات المفتوحة: ورشة المعرفة العامة — Open Bus Stride API',
      ru: 'Агрегатор открытых данных: The Public Knowledge Workshop — Open Bus Stride API',
      uk: 'Агрегатор відкритих даних: The Public Knowledge Workshop — Open Bus Stride API'
    }
  }
];

const TEXTS: Record<
  WidgetLang,
  {
    trigger: string;
    title: string;
    disclaimer: string;
    sourcesTitle: string;
    sourcesIntro: string;
    privacy: string;
    terms: string;
    close: string;
  }
> = {
  en: {
    trigger: 'Data Sources & Disclaimer',
    title: 'Data Sources & Disclaimer',
    disclaimer:
      'nextBus is an independent application. It is NOT affiliated with, endorsed by, or representing the Israeli Ministry of Transport or any other government entity.',
    sourcesTitle: 'Official government data sources',
    sourcesIntro:
      'Schedule (GTFS) and real-time (SIRI) information shown in the app comes from open data published by the National Public Transport Authority (Israel Ministry of Transport and Road Safety):',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    close: 'Close'
  },
  he: {
    trigger: 'אודות ומקורות מידע',
    title: 'אודות ומקורות מידע',
    disclaimer:
      'nextBus היא אפליקציה עצמאית. היא אינה קשורה למשרד התחבורה או לכל גוף ממשלתי אחר, אינה מייצגת אותם ואינה מאושרת על ידם.',
    sourcesTitle: 'מקורות מידע ממשלתיים רשמיים',
    sourcesIntro:
      'נתוני לוחות הזמנים (GTFS) וזמן האמת (SIRI) המוצגים באפליקציה מבוססים על מידע פתוח שמפרסמת הרשות הארצית לתחבורה ציבורית (משרד התחבורה והבטיחות בדרכים):',
    privacy: 'מדיניות פרטיות',
    terms: 'תנאי שימוש',
    close: 'סגירה'
  },
  ar: {
    trigger: 'مصادر البيانات وإخلاء المسؤولية',
    title: 'مصادر البيانات وإخلاء المسؤولية',
    disclaimer:
      'nextBus تطبيق مستقل. وهو غير تابع لوزارة المواصلات الإسرائيلية أو لأي جهة حكومية أخرى، ولا يمثلها ولا يحظى بتأييدها.',
    sourcesTitle: 'مصادر البيانات الحكومية الرسمية',
    sourcesIntro:
      'تستند بيانات الجداول (GTFS) والوقت الفعلي (SIRI) المعروضة في التطبيق إلى بيانات مفتوحة تنشرها الهيئة الوطنية للمواصلات العامة (وزارة المواصلات والسلامة على الطرق):',
    privacy: 'سياسة الخصوصية',
    terms: 'شروط الاستخدام',
    close: 'إغلاق'
  },
  ru: {
    trigger: 'Источники данных и отказ от ответственности',
    title: 'Источники данных и отказ от ответственности',
    disclaimer:
      'nextBus — независимое приложение. Оно НЕ представляет Министерство транспорта Израиля или какой-либо государственный орган и не аффилировано с ними.',
    sourcesTitle: 'Официальные государственные источники данных',
    sourcesIntro:
      'Расписания (GTFS) и данные реального времени (SIRI) в приложении основаны на открытых данных Национального управления общественного транспорта (Министерство транспорта и безопасности дорожного движения Израиля):',
    privacy: 'Политика конфиденциальности',
    terms: 'Условия использования',
    close: 'Закрыть'
  },
  uk: {
    trigger: 'Джерела даних і відмова від відповідальності',
    title: 'Джерела даних і відмова від відповідальності',
    disclaimer:
      'nextBus — незалежний застосунок. Він НЕ представляє Міністерство транспорту Ізраїлю чи будь-який державний орган і не афілійований з ними.',
    sourcesTitle: 'Офіційні державні джерела даних',
    sourcesIntro:
      'Розклади (GTFS) і дані реального часу (SIRI) у застосунку базуються на відкритих даних Національного управління громадського транспорту (Міністерство транспорту та безпеки дорожнього руху Ізраїлю):',
    privacy: 'Політика конфіденційності',
    terms: 'Умови використання',
    close: 'Закрити'
  }
};

@Component({
  selector: 'nb-data-sources-footer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="ds-footer">
      <button type="button" class="ds-trigger" (click)="open()" aria-haspopup="dialog">
        ⓘ {{ t().trigger }}
      </button>
    </footer>

    <dialog
      #dlg
      class="ds-dialog"
      [attr.dir]="isRtl() ? 'rtl' : 'ltr'"
      [attr.lang]="lang()"
      aria-labelledby="nb-ds-title"
      (click)="onBackdropClick($event)"
    >
      <div class="ds-card">
        <div class="ds-head">
          <h2 id="nb-ds-title" class="ds-title">{{ t().title }}</h2>
          <button type="button" class="ds-close" (click)="close()" [attr.aria-label]="t().close">✕</button>
        </div>

        <p class="ds-disclaimer">{{ t().disclaimer }}</p>

        <h3 class="ds-subtitle">{{ t().sourcesTitle }}</h3>
        <p class="ds-intro">{{ t().sourcesIntro }}</p>
        <ul class="ds-links">
          @for (src of sources; track src.href) {
            <li>
              <a [href]="src.href" target="_blank" rel="noopener noreferrer">{{ src.label[lang()] }}</a>
            </li>
          }
        </ul>

        <div class="ds-legal">
          <a href="/privacy" target="_blank" rel="noopener noreferrer">{{ t().privacy }}</a>
          <span aria-hidden="true">•</span>
          <a href="/terms" target="_blank" rel="noopener noreferrer">{{ t().terms }}</a>
        </div>
      </div>
    </dialog>
  `,
  styles: [
    `
      :host {
        display: block;
        min-inline-size: 0;
      }

      .ds-footer {
        display: flex;
        justify-content: center;
        margin-block: -0.4rem -0.3rem;
      }

      .ds-trigger {
        background: transparent;
        border: none;
        color: #7c8796;
        font-size: 0.66rem;
        font-weight: 500;
        padding: 0.2rem 0.4rem;
        border-radius: 0.4rem;
        cursor: pointer;
        text-align: center;
      }

      .ds-trigger:hover,
      .ds-trigger:focus-visible {
        color: #cbd5e1;
        background: rgba(255, 255, 255, 0.06);
      }

      .ds-dialog {
        color-scheme: only dark;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 1.25rem;
        padding: 0;
        background: #1f262e;
        color: #f8fafc;
        inline-size: min(400px, calc(100vw - 1.5rem));
        max-block-size: calc(100dvh - 2rem);
        overflow-y: auto;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
      }

      .ds-dialog::backdrop {
        background: rgba(8, 12, 16, 0.65);
      }

      .ds-card {
        padding: 1rem 1.1rem 1.1rem;
        display: grid;
        gap: 0.6rem;
        font-size: 0.82rem;
        line-height: 1.5;
      }

      .ds-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .ds-title {
        margin: 0;
        font-size: 1rem;
        line-height: 1.3;
      }

      .ds-subtitle {
        margin: 0.2rem 0 0;
        font-size: 0.85rem;
      }

      .ds-close {
        background: transparent;
        border: none;
        color: #9aa6b4;
        font-size: 0.9rem;
        padding: 0.15rem 0.35rem;
        border-radius: 0.4rem;
        cursor: pointer;
        flex-shrink: 0;
      }

      .ds-close:hover {
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.08);
      }

      .ds-disclaimer {
        margin: 0;
        padding: 0.6rem 0.75rem;
        border-radius: 0.75rem;
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(59, 130, 246, 0.3);
      }

      .ds-intro {
        margin: 0;
        color: #9aa6b4;
      }

      .ds-links {
        margin: 0;
        padding-inline-start: 1.1rem;
        display: grid;
        gap: 0.35rem;
      }

      a {
        color: #60a5fa;
        overflow-wrap: anywhere;
      }

      .ds-legal {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        justify-content: center;
        padding-block-start: 0.4rem;
        border-block-start: 1px solid rgba(255, 255, 255, 0.08);
      }
    `
  ]
})
export class DataSourcesFooterComponent {
  readonly lang = input<WidgetLang>('he');

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly sources = SOURCE_LINKS;
  readonly t = computed(() => TEXTS[this.lang()] ?? TEXTS.en);
  readonly isRtl = computed(() => this.lang() === 'he' || this.lang() === 'ar');

  open(): void {
    const el = this.dialog().nativeElement;
    if (typeof el.showModal === 'function') {
      el.showModal();
    } else {
      el.setAttribute('open', '');
    }
  }

  close(): void {
    const el = this.dialog().nativeElement;
    if (typeof el.close === 'function') {
      el.close();
    } else {
      el.removeAttribute('open');
    }
  }

  /** Clicks on the dialog element itself (outside the card) land on the backdrop. */
  onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }
}

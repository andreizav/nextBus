# nextBus — Walkthrough: Лёгкий мобильный виджет, диспетчер интентов, пересадки и Dual Entry Context

## 1. Обзор обновления

### 1.1. Лёгкий минималистичный мобильный UI-виджет («Правило 3 секунд»)
Компоненты [search-bar.component.ts](file:///Users/andrey/Development/projects/nextBus/frontend/src/app/components/search-bar/search-bar.component.ts), [lite-timeline-view.component.ts](file:///Users/andrey/Development/projects/nextBus/frontend/src/app/components/lite-timeline-view/lite-timeline-view.component.ts) и оболочка [next-bus-widget.component.ts](file:///Users/andrey/Development/projects/nextBus/frontend/src/app/components/next-bus-widget/next-bus-widget.component.ts) оформлены в едином минималистичном стиле:
- **Светлая поисковая капсула сверху:** лаконичная строка поиска (`#dfe5ec`) с иконкой лупы и микрофоном голосового ввода справа (`entryContext() === 'standalone'`, строго скрыта в режиме `mcp`).
- **Две ключевые метрики в фокусе:** слева крупный номер маршрута (`49`, `49→17`) с подписью `маршрут` / `bus route`, справа крупный обратный отсчёт (`7 MIN` / `7 МИН`) с подписью `до прибытия` / `arrival countdown`.
- **Пунктирная синяя шкала остановок с синим пином:** отметка `📍 Near You` / `Рядом с вами` вверху, компактное окно остановок (`timeline_window`) с тусклыми крайними точками, белыми соседними и **светящимся синим ореолом активной остановки**. При желании полный маршрут раскрывается одной ссылкой `Все остановки (N)`.
- **Нижний синий переключатель-пилюля:** единая капсула **`View Map | Live Track ●`** внизу карточки для мгновенного переключения между компактной карточкой и лениво загружаемой картой (`@defer`).
- **Умный выбор линии и пересадки:** компактные капсулы дезамбигуации (`LINE_DISAMBIGUATION`: `№49` vs `№49א`) и пошаговые шаги пересадок (`TRIP_PLANNER`: `BOARD_AND_RIDE`, `TRANSFER`) показываются только тогда, когда они действительно нужны.

### 1.2. Разделение режимов входа (`entry_context: "mcp" | "standalone"`)
- **`mcp`** (вызов из Gemini / Google Search через `POST /mcp` или `?entry_context=mcp`): строка поиска и кнопка микрофона строго скрыты из DOM (`@if (entryContext() === 'standalone')`), виджет сразу показывает готовый ответ.
- **`standalone`** (прямой вход через сайт / мобильное приложение): отображается строка поиска [search-bar.component.ts](file:///Users/andrey/Development/projects/nextBus/frontend/src/app/components/search-bar/search-bar.component.ts) с голосовым вводом (`Web Speech API`: `ru-RU`, `he-IL`, `en-US`).

### 1.3. Бэкенд: Диспетчер интентов и PostGIS-маршрутизация
- **`database/migration_03_intents_and_transfers.sql`:**
  - Засеяна линия `49א` (`stride-10049a`) для реальной гео-дезамбигуации в связке с линией `49`.
  - Созданы PostGIS RPC-функции: `find_nearby_lines_by_number`, `find_direct_trips`, `find_transfer_trips` (поддержка 1 и 2 пересадок).
- **`backend/src/services/intent-router.service.ts`:**
  - `classifyQueryIntent`: распознаёт цифровые номера (`"49"`, `"49א"`, `"קו 49"`), голосовые фразы (`"Сорок девятый автобус"`, `"twenty four"`, `"קו ארבעים ותשע"`) и текстовые цели поездки (`"Хочу поехать в больницу Рамбам"`).
  - `dispatchSearchIntent`: выполняет гео-поиск по линиям с чтением актуальных ETA из Upstash Redis (`bus:state:{route_id}:{direction_id}`), либо вызывает геокодинг + планировщик поездок.
- **`backend/src/services/geocoding.service.ts`:**
  - `stripConversationalPrefix` очищает разговорные префиксы (`"хочу поехать в"`, `"איך מגיעים ל"`, `"take me to"`) перед геокодированием и 24h кэшированием в Redis (`geo:cache:*`).

---

## 2. Настройка переменных окружения (`.env` / Railway Variables)

```env
PORT=3000
SUPABASE_URL=https://<your-project-id>.supabase.co
SUPABASE_SERVICE_KEY=<your-service-role-key>
REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6379
GOOGLE_MAPS_API_KEY=<optional-google-maps-places-key>
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/nextbus
```

> При использовании удалённого Supabase выполните SQL из [database/supabase_full_setup.sql](file:///Users/andrey/Development/projects/nextBus/database/supabase_full_setup.sql) в Supabase SQL Editor (данные `stride-10049a` и `stride-10940` уже загружены, а RPC-слой имеет встроенный PostgREST-фоллбэк).

---

## 3. Результаты проверок

1. **Unit-тесты бэкенда (`npm --prefix backend test`)**:
   - `src/__tests__/eta.service.test.ts` (14 тестов, включая `buildTimelineWindow`): **PASS**
   - `src/__tests__/intent-router.service.test.ts` (5 тестов: голосовой парсинг, разговорные префиксы, `LINE_DISAMBIGUATION`): **PASS**
   - `src/__tests__/trip-planner.service.test.ts` (12 тестов, включая `buildTripOptions` с пересадками): **PASS**
   - **Итого:** 3/3 файла, **31/31 тест пройден**, сборка `tsc` — без ошибок.
2. **Сборка фронтенда (`npm --prefix frontend run build`)**:
   - Успешная production-сборка Angular 20 (`main-OR6EZDFD.js`, 59.21 kB raw, ленивый чанк `interactive-map-view-component` вынесен через `@defer`).
3. **Проверка локального HTTP/MCP API (`http://localhost:3000`)**:
   - `POST /api/search-routes` (`"Сорок девятый автобус"`, Тират-Кармель): вернул `entry_context: "standalone"`, `intent_type: "LINE_DISAMBIGUATION"`, 4 кандидата (`49`, `49א`), `timeline_window.compact_stops = 7` из `36` остановок.
   - `POST /api/search-routes` (`"Хочу поехать в больницу Рамбам"`, Тират-Кармель): вернул `intent_type: "TRIP_PLANNER"`, упорядоченные маршруты с пересадками (`Вариант 1: 49א -> 28`, `Вариант 2: 49 -> 17`).
   - `POST /mcp` (`get_live_bus_status`, `find_best_buses_to_destination`): вернул `entry_context: "mcp"` с компактным окном остановок и шагами поездки.
4. **Примечание о Chrome DevTools:** автоматический запуск браузерного сабагента к локальному Google Chrome был заблокирован политикой macOS (`EPERM: operation not permitted` при чтении `/Users/andrey/Library/Application Support/Google/Chrome/DevToolsActivePort`), поэтому визуальный рендер проверяется открытием ссылки вручную в браузере.

# Правила работы с проектом Price Tracker

## Git и деплой

- Работаем ТОЛЬКО в ветке `main`. Никаких feature-веток, PR, merge.
- После каждого логического блока изменений — коммит и пуш в main.
- Коммит-сообщения ТОЛЬКО на английском языке.
- Перед коммитом запускать тесты: `npx jest --no-coverage --forceExit` в `price-tracker-extension/`.
- Пуш ВСЕГДА выполнять сразу после успешного коммита: `git push origin main`. Не спрашивать разрешения.
- Деплой на VPS — ручной: после пуша зайти на сервер и выполнить `cd /opt/price-tracker && git pull && docker compose up -d --build`.

## Язык

- Общение с пользователем — на русском языке.
- Интерфейс расширения и Mini App — на русском языке.
- Код, комментарии в коде, коммит-сообщения — на английском языке.
- JSDoc-комментарии — на английском языке.

## Код: расширение (`price-tracker-extension/`)

- Vanilla JavaScript, НИКАКИХ фреймворков (React, Vue, Svelte и т.д.).
- Все модули — IIFE-паттерн с двойным экспортом (browser global + module.exports).
- Новые UI-компоненты создавать по образцу существующих в `dashboard/components/`.
- Все CSS-переменные определены в `shared/styles.css` — использовать их, не хардкодить цвета/размеры.
- Дашборд-специфичные стили — в `dashboard/dashboard.css`.

## Код: сервер (`server/`)

- CommonJS модули (require/module.exports).
- Миграции БД — через `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `initDB()` в `server.js`.
- Новые поля в settings — добавлять в массив `allowed` в PUT `/settings/global`.
- Новые поля в trackers — добавлять в массив `allowed` в PUT `/trackers/:id`.

## UI-компоненты: обязательные правила

- **ЗАПРЕЩЕНО** использовать нативные `<select>` элементы. Только кастомные дропдауны `.custom-dropdown`.
- Референсная реализация кастомного дропдауна — функция `createCustomDropdown()` в `toolbar.js`.
- При создании нового дропдауна — копировать паттерн из `toolbar.js`, не изобретать заново.
- Все кнопки — через классы `.btn`, `.btn-primary`, `.btn-danger`, `.btn-icon`.
- Все инпуты — класс `.input`.
- Модалки — `.modal-overlay` + `.modal` с анимацией через `.active` класс.
- Тоглы — `.toggle` + `.toggle-slider` + `<input type="checkbox">`.
- Карточки — `.card` с glassmorphism и hover-эффектами.
- Skeleton-лоадеры при загрузке данных.
- Ripple-эффект на `.btn` элементах (реализован в `dashboard.js` → `initRipple()`).
- Toast-уведомления — `showToast(message, type)` в `dashboard.js`. Типы: `success`, `error`, `info`. Классы: `.toast`, `.toast-success`, `.toast-error`, `.toast-info`. Использовать вместо `alert()` для информационных сообщений. `confirm()` оставлять только для деструктивных действий (удаление).

## Тестирование

- Тесты расширения: `price-tracker-extension/tests/unit/` — Jest + jsdom.
- При изменении компонента — обновлять соответствующий тест-файл.
- При создании нового компонента — создавать тест-файл.
- Известные failing тесты: `background.test.js` → `rescheduleAllAlarms` (4 теста, не экспортирована функция) — это pre-existing, не блокирует.
- Property-based тесты: `tests/property/` — fast-check.

## Telegram

- Трекеры добавляются ТОЛЬКО через Chrome-расширение, НИКОГДА через Telegram.
- Telegram-бот отправляет уведомления в личку пользователя (`telegramPersonalChatId`), а также в групповой чат (`telegramChatId`) если настроен.
- `telegramPersonalChatId` устанавливается автоматически при отправке /start боту.
- Поля Telegram Bot Token и Chat ID НЕ показываются в настройках расширения — они настраиваются на сервере.

## Уведомления и пороги

- Три режима порогов: адаптивный (по диапазонам цен), абсолютный (фиксированная сумма), процентный.
- Пороги настраиваются глобально в settings и могут быть переопределены per-tracker.
- Серверный `serverThresholdEngine.js` и клиентский `lib/thresholdEngine.js` должны быть синхронизированы по логике.
- Дайджест отправляется только если есть значимые изменения (прошедшие порог) или исторические минимумы.

## Проверка цен

- Проверка цен выполняется СЕРВЕРНО через Puppeteer (`serverPriceChecker.js`).
- Кнопка "Обновить все" в дашборде вызывает `POST /server-check`, НЕ extension alarm.
- Автоматическая проверка — cron каждые 3 часа (`scheduler.js`).
- Между проверками трекеров — рандомная задержка 5-15 секунд для обхода WAF.
- Также поддерживается браузерная проверка (checkMethod = 'extension'): расширение открывает вкладку, инжектит `priceExtractor.js`, читает цену по `cssSelector`.

## Извлечение цен: стратегия fallback

- Основной путь: читать цену по сохранённому `cssSelector`.
- Если основной селектор не найден — **всегда** пытаться auto-detect цену на странице (и в браузере, и на сервере).
- **ЗАПРЕЩЕНО** просто возвращать ошибку, если основной селектор сломался — нужен fallback через auto-detect.
- Для variant-трекеров: сначала читать цену из `meta[itemprop="price"]` внутри варианта (без клика), затем fallback на клик + чтение отображаемой цены.
- Auto-detect приоритеты: site-specific селекторы → `[itemprop="price"]` → DOM-сканирование с scoring.

## Поддержка магазинов (site-specific логика)

### makeup.com.ua
- Сайт использует React SPA с CSS Modules (обновлён в 2025).
- Цена: `span[class*="Price__priceCurrent"]` (отображаемая), `meta[itemprop="price"]` (structured data).
- Варианты: `div[class*="ProductBuySection__variant"]` с `id` атрибутом и `meta[itemprop="price"]` внутри.
- Выбранный вариант: класс содержит `selected`/`Selected`, или `li[role="option"][aria-selected="true"]` в дропдауне.
- Варианты различаются по объёму (30ml, 50ml, 80ml) и региону (с флажком ЕС = доставка из Европы, без = Украина). Цены разные.
- `variantSelector` сохраняется как `#elementId` (например `#2921590_3`). Суффикс `_3` = вариант из ЕС.
- При браузерной проверке: `priceExtractor.js` → `tryMakeupVariantPrice()` читает цену из `meta[itemprop="price"]` внутри варианта напрямую, без клика.
- При серверной проверке: `scraper.js` матчит вариант по ID, объёму и региону (EU/non-EU).
- Старые селекторы (`.product-item__price`, `.price-block__price`) больше не работают — есть fallback на новые.

### notino.ua
- React SPA, два ценовых блока:
  - `#pd-price span[data-testid="pd-price"]` (атрибут `content`) — АКТУАЛЬНАЯ цена (скидочная, если есть скидка).
  - `span[data-testid="pd-price-wrapper"]` вне `#pd-price` (внутри `originalPriceDiscountWrapper`) — СТАРАЯ/оригинальная цена (зачёркнутая).
- Всегда приоритизировать `#pd-price` — это реальная цена, которую платит покупатель.
- Варианты (объёмы): каждый вариант — `span[data-testid="price-variant"]` с `content` атрибутом. URL меняется при выборе варианта (разные product ID в URL).
- Наборы (gift sets): та же структура `#pd-price`, без вариантов.
- Wait-page detection: "Трохи зачекайте…" — ждём до 30 секунд.

### eva.ua
- Vue/Nuxt SPA, цена в `[data-testid="product-price"]` (textContent, e.g. "6 547 ₴").
- JSON-LD и meta tags содержат цену ДЕФОЛТНОГО варианта (обычно 30 мл), НЕ выбранного. Всегда приоритизировать `[data-testid="product-price"]`.
- Варианты: кнопки `button[title="VOLUME (PRODUCT_ID)"]` (e.g. `button[title="80 (808730)"]`).
- Выбранный вариант: класс содержит `border-apple` (зелёная рамка). Невыбранные: `border-dark-300`.
- Hash-based URLs: `#/PRODUCT_ID` (e.g. `#/73311` для 80ml). Hash не работает при серверной загрузке — scraper стрипает hash и кликает кнопку.
- `variantSelector` сохраняется как `button[title="VOLUME (PRODUCT_ID)"]`.
- При браузерной auto-detect: `autoDetector.js` → `checkSiteSpecific()` читает `[data-testid="product-price"]` напрямую, `detectEvaVariant()` определяет выбранный вариант.
- При серверной проверке: `scraper.js` извлекает объём из productName, находит кнопку по title, кликает через JS dispatchEvent, ждёт обновления цены.
- Out-of-stock варианты: EVA убирает элемент цены — используется быстрый путь с короткими таймаутами.

### kasta.ua
- Динамические ID (`#kcPriceXXX`) — не работают на сервере.
- Fallback приоритет: `.kcPrice span.t-bold` (Kasta Card цена, ниже — предпочтительна) → `#productPrice` (обычная цена) → `#productOldPrice` → JSON-LD `priceSpecification`.
- **BNPL/рассрочка**: элементы `.BnplPayment`, `#bnplPayment*`, `.p__bnpl`, `[class*="bnpl"]` содержат цену за платёж (например `46 ₴ / 2 недели`), а НЕ цену товара. Исключаются из DOM-сканирования во всех детекторах (scraper, autoDetector, priceExtractor).
- Kasta fallback срабатывает и когда селектор не найден, и когда найден но цена не распарсилась.
- `autoDetector.js` → `checkSiteSpecific()` приоритизирует `.kcPrice span.t-bold` для kasta.ua.

## API Base URL

- Захардкожен в нескольких местах: `apiClient.js`, `dashboard.js`, `globalSettings.js`.
- Значение: `http://85.115.209.141:3000`
- При изменении (например, добавление домена + HTTPS) — обновлять во всех местах.

## Версионирование (Semantic Versioning)

- Формат: `MAJOR.MINOR.PATCH` (например `2.1.3`).
- Версия хранится в `server/webapp/app.js` (renderSettings → "О приложении"), `price-tracker-extension/manifest.json`, `price-tracker-extension/package.json`.
- При изменении версии — обновлять во всех трёх местах.

### Когда какую цифру менять

- `PATCH` (2.1.0 → 2.1.1) — баг-фиксы, мелкие правки UI, исправления текстов, рефакторинг без изменения поведения. Всё, что не меняет функциональность для пользователя.
- `MINOR` (2.1.3 → 2.2.0) — новая фича, новый UI-компонент, новый API-эндпоинт, новая команда бота, заметное улучшение UX. Обратная совместимость сохраняется.
- `MAJOR` (2.2.0 → 3.0.0) — ломающие изменения: смена формата БД без обратной совместимости, удаление API-эндпоинтов, полный редизайн, миграция на другой стек. На практике — редко.

### Правила

- Один коммит может менять только одну цифру версии (не прыгать с 2.1.0 на 2.3.0).
- Не каждый коммит обязан менять версию — серия мелких фиксов может быть объединена в один PATCH-бамп.
- PATCH сбрасывается в 0 при бампе MINOR. MINOR и PATCH сбрасываются в 0 при бампе MAJOR.
- В коммит-сообщении при бампе версии указывать: `Bump version to X.Y.Z`.

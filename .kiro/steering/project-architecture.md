# Архитектура проекта Price Tracker

## Обзор

Price Tracker — система отслеживания цен на товары в интернет-магазинах. Состоит из трёх частей:

1. **Chrome-расширение** (`price-tracker-extension/`) — MV3 extension на vanilla JS
2. **Серверный бэкенд** (`server/`) — Express + PostgreSQL + Puppeteer
3. **Telegram Mini App** (`server/webapp/`) — SPA для управления через Telegram

Все три части работают с одной PostgreSQL базой через REST API сервера.

## Серверный бэкенд (`server/`)

### Стек
- Node.js 20, Express, PostgreSQL (pg), Puppeteer-core + Chromium
- Деплой: Railway (автодеплой из main ветки)
- Dockerfile в корне проекта
- API Base URL: `https://pricetracker-production-ac69.up.railway.app`

### Ключевые модули
- `server.js` — Express-сервер, REST API, инициализация БД (миграции через ALTER TABLE IF NOT EXISTS), статика для Mini App
- `scraper.js` — Puppeteer-скрапер, извлечение цен со страниц магазинов, cookie injection для авторизованных проверок
- `serverPriceChecker.js` — цикл проверки всех трекеров: скрапинг → сравнение → пороги → дайджест
- `serverThresholdEngine.js` — определение значимости изменения цены (адаптивный/абсолютный/процентный режимы)
- `serverDigestComposer.js` — формирование Telegram-дайджеста из изменений
- `telegramSender.js` — отправка сообщений в Telegram (поддерживает personalChatId и groupChatId)
- `telegramBot.js` — Telegram-бот с long polling, команды /start /groups /best /all /stats /check /settings /help
- `scheduler.js` — cron-планировщик проверок (по умолчанию каждые 3 часа)
- `autoGrouper.js` — автоматическая группировка трекеров по названию товара (cross-store). Два режима: assignToExisting (тихо при создании трекера), suggestGroups (предложения для ручного подтверждения)
- `priceParser.js` — парсинг цен из текста

### База данных (PostgreSQL)
Таблицы:
- `trackers` — трекеры (pageUrl, cssSelector, productName, currentPrice, minPrice, maxPrice, productGroup, status, starred, thresholdConfig и т.д.)
- `price_history` — история цен (trackerId, price, checkedAt)
- `settings` — глобальные настройки (id='global', thresholdConfig, telegramBotToken, telegramChatId, telegramPersonalChatId, telegramDigestEnabled, siteCookies, checkMethod)

### REST API эндпоинты
- `GET/POST /trackers`, `GET/PUT/DELETE /trackers/:id`
- `POST /trackers/auto-group` — автогруппировка в существующие группы (без создания новых)
- `GET /trackers/auto-group/suggest` — предложения группировки (preview)
- `POST /trackers/auto-group/apply` — применить выбранные предложения
- `POST /trackers/auto-group/single/:id` — тихо назначить трекер в существующую группу
- `GET/POST /priceHistory`, `POST /priceHistory/clear-all`
- `GET/PUT /settings/global`
- `POST /server-check` — ручной запуск проверки цен
- `POST /server-check/single/:id` — проверка одного трекера через Puppeteer (используется расширением при создании трекера)
- `GET /server-check/status` — статус текущей проверки
- `POST /server-check/cancel` — отмена текущей проверки цен

## Chrome-расширение (`price-tracker-extension/`)

### Стек
- Chrome Manifest V3, vanilla JavaScript (IIFE-паттерн, без фреймворков)
- Тесты: Jest + jsdom + fast-check (property-based)

### Структура
- `background.js` — service worker, маршрутизация сообщений, алармы. Поддерживает три метода проверки цен: server (Puppeteer), extension (вкладки браузера), hybrid (сервер с fallback на браузер). Метод настраивается глобально и per-tracker.
- `popup/` — popup окно расширения (popup.html/js/css)
- `dashboard/` — полноэкранная панель управления
  - `dashboard.js` — главный скрипт, загрузка трекеров, фильтрация, сортировка, рендеринг
  - `components/` — UI-компоненты:
    - `toolbar.js` — тулбар с поиском, кастомными дропдаунами, кнопками
    - `trackerCard.js` — карточка трекера
    - `settingsModal.js` — модалка настроек отдельного трекера
    - `globalSettings.js` — модалка глобальных настроек
    - `comparisonTable.js` — таблица сравнения цен в группе
    - `priceHistory.js` — график истории цен
    - `sortEngine.js` — логика сортировки
    - `contentDiff.js` — diff контента
- `content/` — content scripts:
  - `selectorPicker.js` — визуальный выбор CSS-селектора на странице
  - `autoDetector.js` — автоматическое определение цены на странице
  - `priceExtractor.js` — извлечение цены по селектору
  - `selectorGenerator.js` — генерация уникального CSS-селектора
- `lib/` — библиотечные модули:
  - `apiClient.js` — HTTP-клиент к серверному API
  - `priceChecker.js` — проверка цен через content scripts (открытие вкладок, инжект priceExtractor.js). Используется при checkMethod = 'extension' или 'hybrid'
  - `notifier.js` — Chrome-уведомления
  - `thresholdEngine.js` — клиентский движок порогов
  - `alarmManager.js` — управление Chrome alarms
  - `badgeManager.js` — бейдж расширения
  - `priceParser.js` — парсинг цен
  - `digestComposer.js` — клиентский дайджест
- `shared/` — общие ресурсы:
  - `constants.js` — все константы (IIFE, экспорт через self.PriceTracker.constants и module.exports)
  - `icons.js` — SVG-иконки
  - `styles.css` — базовые стили, CSS-переменные, тема

### Паттерн модулей
Все модули используют IIFE-паттерн с двойным экспортом:
```js
const Module = (function() {
  // ... код ...
  return { publicMethod };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Module;
}
```
В браузере модули доступны как глобальные переменные, в тестах — через require().

## Telegram Mini App (`server/webapp/`)

### Стек
- Vanilla JS SPA, один файл `app.js`
- Telegram WebApp API (window.Telegram.WebApp)
- Тёмная тема, адаптирована под Telegram theme variables

### Функциональность
- 4 вкладки: Best Prices, Groups, All Trackers, Settings
- Полное управление трекерами: редактирование, пауза, удаление, перемещение между группами
- Настройки порогов уведомлений (адаптивный/абсолютный/процентный)
- Извлечение объёма (мл) из названий товаров, группировка по объёмам
- Haptic feedback, pull-to-refresh, back button navigation

## Дизайн-система

### Тема
- Тёмная тема с глубокими тёмными фонами (#0c0f1a, #111827)
- Акцентный цвет: indigo (#6366f1)
- Шрифт: Inter (Google Fonts)
- Glassmorphism: backdrop-filter: blur(20px)
- Скруглённые углы: 16px карточки, pill-shaped инпуты
- CSS-переменные определены в `shared/styles.css`

### UI-компоненты (обязательные правила)
- **Дропдауны**: используются ТОЛЬКО кастомные дропдауны (класс `.custom-dropdown`), НЕ нативные `<select>`. Компонент `createCustomDropdown()` в `toolbar.js` — референсная реализация.
- **Кнопки**: `.btn`, `.btn-primary`, `.btn-danger`, `.btn-icon`, `.btn-sm`
- **Инпуты**: `.input` с фокус-стилями через CSS-переменные
- **Модалки**: `.modal-overlay` + `.modal` с анимацией появления
- **Тоглы**: `.toggle` + `.toggle-slider`
- **Карточки**: `.card` с hover-эффектами и glassmorphism

### Анимации
- Stagger-анимация карточек при загрузке
- Crossfade при переключении состояний (loading/grid/empty/error)
- Ripple-эффект на кнопках
- Skeleton-лоадеры при загрузке данных

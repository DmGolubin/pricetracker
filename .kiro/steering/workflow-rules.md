# Правила работы с проектом Price Tracker

## Git и деплой

- Работаем ТОЛЬКО в ветке `main`. Никаких feature-веток, PR, merge.
- После каждого логического блока изменений — коммит и пуш в main.
- Коммит-сообщения ТОЛЬКО на английском языке.
- Перед коммитом запускать тесты: `npx jest --no-coverage --forceExit` в `price-tracker-extension/`.
- Пуш разрешён сразу после успешного коммита: `git push origin main`.
- Railway автоматически деплоит из main — после пуша серверная часть обновляется сама.

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

## API Base URL

- Захардкожен в нескольких местах: `apiClient.js`, `dashboard.js`, `globalSettings.js`, `popup.js`.
- Значение: `https://pricetracker-production-ac69.up.railway.app`
- При изменении — обновлять во всех местах.

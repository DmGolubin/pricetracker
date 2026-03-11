/**
 * Notifier module — Chrome Notifications and Telegram Bot API.
 * Handles notification decisions based on tracker settings and filters.
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var NotificationFilterType = _constants.NotificationFilterType;

/**
 * Evaluate the notification filter for a tracker.
 * Returns true if the filter condition is met (notification should be sent).
 *
 * @param {object} tracker - The tracker object
 * @param {number} newPrice - The new price value
 * @param {number} previousPrice - The previous price value
 * @returns {boolean}
 */
function evaluateFilter(tracker, newPrice, previousPrice) {
  const filter = tracker.notificationFilter;

  if (!filter || filter.type === NotificationFilterType.NONE) {
    // Default behavior: notify on any price change
    return newPrice !== previousPrice;
  }

  switch (filter.type) {
    case NotificationFilterType.CONTAINS:
      return typeof tracker.currentContent === 'string' &&
        tracker.currentContent.includes(filter.value);

    case NotificationFilterType.GREATER_THAN:
      return newPrice > Number(filter.value);

    case NotificationFilterType.LESS_THAN:
      return newPrice < Number(filter.value);

    case NotificationFilterType.INCREASED:
      return newPrice > previousPrice;

    case NotificationFilterType.DECREASED:
      return newPrice < previousPrice;

    default:
      return newPrice !== previousPrice;
  }
}

/**
 * Determine whether Chrome and Telegram notifications should be sent.
 *
 * @param {object} tracker - The tracker object
 * @param {number} newPrice - The new price
 * @param {number} previousPrice - The previous price
 * @param {object} settings - Global settings
 * @returns {{ chrome: boolean, telegram: boolean }}
 */
function shouldNotify(tracker, newPrice, previousPrice, settings) {
  const filterPassed = evaluateFilter(tracker, newPrice, previousPrice);

  const chromeEnabled =
    filterPassed && tracker.notificationsEnabled === true;

  const telegramEnabled =
    filterPassed &&
    Boolean(settings.telegramBotToken) &&
    Boolean(settings.telegramChatId);

  return { chrome: chromeEnabled, telegram: telegramEnabled };
}

/**
 * Send a Chrome desktop notification.
 *
 * @param {object} tracker - The tracker object
 * @param {number} oldPrice - The old price
 * @param {number} newPrice - The new price
 */
function sendChromeNotification(tracker, oldPrice, newPrice) {
  const notificationId = `price-tracker-${tracker.id}`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: tracker.imageUrl || chrome.runtime.getURL('icons/icon128.png'),
    title: tracker.productName,
    message: `Цена изменилась: ${oldPrice} → ${newPrice}`,
  });
}

/**
 * Send a Telegram notification via Bot API.
 *
 * @param {object} tracker - The tracker object
 * @param {number} oldPrice - The old price
 * @param {number} newPrice - The new price
 * @param {object} settings - Global settings (telegramBotToken, telegramChatId)
 * @returns {Promise<void>}
 */
async function sendTelegramNotification(tracker, oldPrice, newPrice, settings) {
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    return;
  }

  const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
  const text =
    `<b>${tracker.productName}</b>\n` +
    `Цена: ${oldPrice} → ${newPrice}\n` +
    `<a href="${tracker.pageUrl}">Открыть страницу</a>`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text,
        parse_mode: 'HTML',
      }),
    });
  } catch (err) {
    console.error('Telegram notification error:', err);
  }
}

/**
 * Convenience method: evaluate shouldNotify and dispatch appropriate notifications.
 *
 * @param {object} tracker - The tracker object
 * @param {number} oldPrice - The old price
 * @param {number} newPrice - The new price
 * @param {object} settings - Global settings
 * @returns {Promise<void>}
 */
async function notify(tracker, oldPrice, newPrice, settings) {
  const previousPrice = oldPrice;
  const decision = shouldNotify(tracker, newPrice, previousPrice, settings);

  if (decision.chrome) {
    sendChromeNotification(tracker, oldPrice, newPrice);
  }

  if (decision.telegram) {
    await sendTelegramNotification(tracker, oldPrice, newPrice, settings);
  }
}

/**
 * Register the notification click handler.
 * Opens the tracker's page URL when the user clicks a Chrome notification.
 */
function registerNotificationClickHandler() {
  chrome.notifications.onClicked.addListener((notificationId) => {
    const prefix = 'price-tracker-';
    if (notificationId.startsWith(prefix)) {
      // We don't have direct access to the tracker here,
      // so the background.js should handle this via stored mapping or
      // by querying the tracker. For now, clear the notification.
      chrome.notifications.clear(notificationId);
    }
  });
}

const _notifier = {
  evaluateFilter,
  shouldNotify,
  sendChromeNotification,
  sendTelegramNotification,
  notify,
  registerNotificationClickHandler,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _notifier;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.notifier = _notifier;
}

})();

/**
 * Notifier module — Chrome Notifications and Telegram Bot API.
 * Handles notification decisions based on tracker settings and filters.
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var NotificationFilterType = _constants.NotificationFilterType;

var _thresholdEngine;
if (typeof require !== 'undefined') {
  _thresholdEngine = require('./thresholdEngine');
} else if (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.thresholdEngine) {
  _thresholdEngine = self.PriceTracker.thresholdEngine;
}

// ─── Inline LCS diff for Telegram formatting ────────────────────

function buildLCSTable(oldArr, newArr) {
  var m = oldArr.length, n = newArr.length;
  var t = [];
  for (var i = 0; i <= m; i++) {
    t[i] = [];
    for (var j = 0; j <= n; j++) {
      if (i === 0 || j === 0) t[i][j] = 0;
      else if (oldArr[i - 1] === newArr[j - 1]) t[i][j] = t[i - 1][j - 1] + 1;
      else t[i][j] = Math.max(t[i - 1][j], t[i][j - 1]);
    }
  }
  return t;
}

function diffBacktrack(table, oldArr, newArr, i, j) {
  var ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
      ops.push({ type: 'equal', value: oldArr[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      ops.push({ type: 'added', value: newArr[j - 1] });
      j--;
    } else {
      ops.push({ type: 'removed', value: oldArr[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function computeLineDiff(oldText, newText) {
  var oldLines = String(oldText || '').split('\n').filter(function (l) { return l.trim().length > 0; });
  var newLines = String(newText || '').split('\n').filter(function (l) { return l.trim().length > 0; });
  if (oldLines.length === 0 && newLines.length === 0) return [];
  if (oldLines.length === 0) return newLines.map(function (l) { return { type: 'added', value: l }; });
  if (newLines.length === 0) return oldLines.map(function (l) { return { type: 'removed', value: l }; });
  var table = buildLCSTable(oldLines, newLines);
  return diffBacktrack(table, oldLines, newLines, oldLines.length, newLines.length);
}

/**
 * Escape HTML special characters for Telegram HTML parse mode.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format a content diff as Telegram HTML.
 * Shows changed lines with ➖/➕ markers, plus 1 context line around changes.
 */
function formatContentDiffHtml(oldContent, newContent) {
  var ops = computeLineDiff(oldContent, newContent);
  if (ops.length === 0) return 'Контент изменился';

  // Mark which indices are changed
  var changed = [];
  for (var i = 0; i < ops.length; i++) {
    changed[i] = ops[i].type !== 'equal';
  }

  // Include 1 context line around each change
  var include = [];
  for (var i = 0; i < ops.length; i++) {
    if (changed[i]) {
      if (i > 0 && !include[i - 1]) include[i - 1] = true;
      include[i] = true;
      if (i + 1 < ops.length) include[i + 1] = true;
    }
  }

  var lines = [];
  var skipped = false;
  for (var i = 0; i < ops.length; i++) {
    if (!include[i]) {
      if (!skipped) { skipped = true; }
      continue;
    }
    skipped = false;
    var op = ops[i];
    if (op.type === 'removed') {
      lines.push('➖ <s>' + escapeHtml(op.value) + '</s>');
    } else if (op.type === 'added') {
      lines.push('➕ <b>' + escapeHtml(op.value) + '</b>');
    } else {
      lines.push('   ' + escapeHtml(op.value));
    }
  }

  if (lines.length === 0) return 'Контент изменился';

  // Limit to 30 lines max for Telegram readability
  if (lines.length > 30) {
    lines = lines.slice(0, 30);
    lines.push('… ещё изменения');
  }

  return lines.join('\n');
}

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
 * Integrates threshold engine: suppresses notifications when price change
 * is below the configured threshold (unless it's a historical minimum).
 *
 * @param {object} tracker - The tracker object
 * @param {number} newPrice - The new price
 * @param {number} previousPrice - The previous price
 * @param {object} settings - Global settings
 * @param {object} [options] - Additional options
 * @param {boolean} [options.isHistoricalMinimum] - Whether this is a historical minimum
 * @returns {{ chrome: boolean, telegram: boolean }}
 */
function shouldNotify(tracker, newPrice, previousPrice, settings, options) {
  const filterPassed = evaluateFilter(tracker, newPrice, previousPrice);

  const chromeEnabled =
    filterPassed && tracker.notificationsEnabled === true;

  const telegramEnabled =
    filterPassed &&
    Boolean(settings.telegramBotToken) &&
    Boolean(settings.telegramChatId);

  // If filter didn't pass, no notification regardless
  if (!chromeEnabled && !telegramEnabled) {
    return { chrome: false, telegram: false };
  }

  var isHistMin = options && options.isHistoricalMinimum;

  // Check threshold significance (only for price tracking, not content)
  if (_thresholdEngine && tracker.trackingType !== 'content') {
    var thresholdConfig = _thresholdEngine.resolveThresholdConfig(tracker, settings);
    var significant = _thresholdEngine.isSignificant(previousPrice, newPrice, thresholdConfig);

    // Historical minimum always bypasses threshold
    if (!significant && !isHistMin) {
      return { chrome: false, telegram: false };
    }
  }

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

  var message;
  if (tracker.trackingType === 'content') {
    var oldContent = String(oldPrice || '');
    var newContent = String(newPrice || '');
    if (oldContent && newContent && oldContent !== newContent) {
      // Build a compact text diff for Chrome notification
      var ops = computeLineDiff(oldContent, newContent);
      var diffLines = [];
      for (var k = 0; k < ops.length && diffLines.length < 6; k++) {
        if (ops[k].type === 'removed') diffLines.push('− ' + ops[k].value);
        else if (ops[k].type === 'added') diffLines.push('+ ' + ops[k].value);
      }
      message = diffLines.length > 0 ? diffLines.join('\n') : 'Контент изменился';
    } else {
      message = 'Контент изменился';
    }
  } else {
    message = `Цена изменилась: ${oldPrice} \u2192 ${newPrice}`;
  }

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: tracker.imageUrl || chrome.runtime.getURL('icons/icon128.png'),
    title: tracker.productName,
    message: message,
  });
}

/**
 * Send a special Chrome desktop notification for historical minimum price.
 *
 * @param {object} tracker - The tracker object
 */
function sendHistoricalMinNotification(tracker) {
  const notificationId = `price-tracker-histmin-${tracker.id}`;

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: tracker.imageUrl || chrome.runtime.getURL('icons/icon128.png'),
    title: '\uD83C\uDFC6 Исторический минимум!',
    message: `${tracker.productName}\nЦена: ${tracker.currentPrice}`,
  });
}

/**
 * Send a Telegram notification via Bot API.
 *
 * @param {object} tracker - The tracker object
 * @param {number} oldPrice - The old price
 * @param {number} newPrice - The new price
 * @param {object} settings - Global settings (telegramBotToken, telegramChatId)
 * @param {object} [options] - Additional options
 * @param {boolean} [options.isHistoricalMinimum] - Whether this is a historical minimum
 * @returns {Promise<void>}
 */
async function sendTelegramNotification(tracker, oldPrice, newPrice, settings, options) {
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    return;
  }

  // When digest mode is enabled, skip individual Telegram messages
  // (the digest will be sent by priceChecker after the cycle)
  if (settings.telegramDigestEnabled) {
    return;
  }

  const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;

  var isHistMin = options && options.isHistoricalMinimum;

  var priceText;
  if (tracker.trackingType === 'content') {
    var oldContent = String(oldPrice || '');
    var newContent = String(newPrice || '');
    if (oldContent && newContent && oldContent !== newContent) {
      priceText = formatContentDiffHtml(oldContent, newContent);
    } else {
      priceText = `Контент изменился`;
    }
  } else {
    priceText = `Цена: ${oldPrice} → ${newPrice}`;
  }

  var titlePrefix = isHistMin ? '\uD83C\uDFC6 ' : '';
  const text =
    `<b>${titlePrefix}${escapeHtml(tracker.productName)}</b>\n` +
    priceText + `\n` +
    `<a href="${tracker.pageUrl}">Открыть страницу</a>`;

  // Inline keyboard: "Открыть страницу" URL button
  var replyMarkup = {
    inline_keyboard: [
      [{ text: 'Открыть страницу', url: tracker.pageUrl }]
    ]
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
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
 * @param {object} [options] - Additional options
 * @param {boolean} [options.isHistoricalMinimum] - Whether this is a historical minimum
 * @returns {Promise<void>}
 */
async function notify(tracker, oldPrice, newPrice, settings, options) {
  const previousPrice = oldPrice;
  const decision = shouldNotify(tracker, newPrice, previousPrice, settings, options);

  var isHistMin = options && options.isHistoricalMinimum;

  if (decision.chrome) {
    sendChromeNotification(tracker, oldPrice, newPrice);
    // Also send the special historical minimum Chrome notification
    if (isHistMin) {
      sendHistoricalMinNotification(tracker);
    }
  }

  if (decision.telegram) {
    await sendTelegramNotification(tracker, oldPrice, newPrice, settings, options);
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
  sendHistoricalMinNotification,
  sendTelegramNotification,
  notify,
  registerNotificationClickHandler,
  computeLineDiff,
  formatContentDiffHtml,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _notifier;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.notifier = _notifier;
}

})();

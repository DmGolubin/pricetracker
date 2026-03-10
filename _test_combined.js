/**
 * Shared constants for Price Tracker Extension
 */
(function () {

// Message types from popup/dashboard to service worker
var MessageToSW = {
  START_PICKER: 'startPicker',
  START_AUTO_DETECT: 'startAutoDetect',
  GET_ALL_TRACKERS: 'getAllTrackers',
  GET_TRACKER: 'getTracker',
  DELETE_TRACKER: 'deleteTracker',
  UPDATE_TRACKER: 'updateTracker',
  CHECK_ALL_PRICES: 'checkAllPrices',
  CHECK_PRICE: 'checkPrice',
  GET_SETTINGS: 'getSettings',
  SAVE_SETTINGS: 'saveSettings',
  GET_PRICE_HISTORY: 'getPriceHistory',
  MARK_AS_READ: 'markAsRead',
  RESET_BADGE: 'resetBadge',
};

// Message types from content script to service worker
var MessageFromCS = {
  ELEMENT_SELECTED: 'elementSelected',
  PRICE_EXTRACTED: 'priceExtracted',
  CONTENT_EXTRACTED: 'contentExtracted',
  EXTRACTION_FAILED: 'extractionFailed',
  PICKER_CANCELLED: 'pickerCancelled',
  AUTO_DETECTED: 'autoDetected',
  AUTO_DETECT_FAILED: 'autoDetectFailed',
};

// Check intervals in hours
var CHECK_INTERVALS = {
  SIX_HOURS: 6,
  TWELVE_HOURS: 12,
  TWENTY_FOUR_HOURS: 24,
  DISABLED: 0,
};

// Default check interval
var DEFAULT_CHECK_INTERVAL = CHECK_INTERVALS.TWELVE_HOURS;

// Page load timeout in milliseconds
var PAGE_LOAD_TIMEOUT_MS = 30000;

// API retry delay in milliseconds
var API_RETRY_DELAY_MS = 5000;

// Alarm name format: price-check-{trackerId}
var ALARM_NAME_PREFIX = 'price-check-';
var getAlarmName = function (trackerId) { return ALARM_NAME_PREFIX + trackerId; };
var getTrackerIdFromAlarm = function (alarmName) {
  return alarmName.indexOf(ALARM_NAME_PREFIX) === 0
    ? alarmName.slice(ALARM_NAME_PREFIX.length)
    : null;
};

// Tracker statuses
var TrackerStatus = {
  ACTIVE: 'active',
  UPDATED: 'updated',
  ERROR: 'error',
  PAUSED: 'paused',
};

// Tracking types
var TrackingType = {
  PRICE: 'price',
  CONTENT: 'content',
};

// Check modes
var CheckMode = {
  AUTO: 'auto',
  PIN_TAB: 'pinTab',
};

// Notification filter types
var NotificationFilterType = {
  NONE: 'none',
  CONTAINS: 'contains',
  GREATER_THAN: 'greaterThan',
  LESS_THAN: 'lessThan',
  INCREASED: 'increased',
  DECREASED: 'decreased',
};

// Currency symbols used for auto-detection
var CURRENCY_SYMBOLS = ['\u20AC', '\u0024', '\u20BD', '\u20B4', 'z\u0142', 'kn', '\u00A3', '\u00A5', '\u20A9', '\u20B9', '\u20BA', '\u20AB', '\u0E3F', 'R\u0024', 'kr'];

// URL schemes considered as browser internal pages (track button should be hidden)
var INTERNAL_URL_SCHEMES = ['chrome://', 'about:', 'edge://', 'chrome-extension://', 'moz-extension://', 'brave://'];

// Badge colors
var BadgeColor = {
  DEFAULT: '#4CAF50',
  ERROR: '#F44336',
};

// Export object
var _constants = {
  MessageToSW: MessageToSW,
  MessageFromCS: MessageFromCS,
  CHECK_INTERVALS: CHECK_INTERVALS,
  DEFAULT_CHECK_INTERVAL: DEFAULT_CHECK_INTERVAL,
  PAGE_LOAD_TIMEOUT_MS: PAGE_LOAD_TIMEOUT_MS,
  API_RETRY_DELAY_MS: API_RETRY_DELAY_MS,
  ALARM_NAME_PREFIX: ALARM_NAME_PREFIX,
  getAlarmName: getAlarmName,
  getTrackerIdFromAlarm: getTrackerIdFromAlarm,
  TrackerStatus: TrackerStatus,
  TrackingType: TrackingType,
  CheckMode: CheckMode,
  NotificationFilterType: NotificationFilterType,
  CURRENCY_SYMBOLS: CURRENCY_SYMBOLS,
  INTERNAL_URL_SCHEMES: INTERNAL_URL_SCHEMES,
  BadgeColor: BadgeColor,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _constants;
}
if (typeof self !== 'undefined' && typeof self.PriceTracker === 'undefined') {
  self.PriceTracker = {};
}
if (typeof self !== 'undefined') {
  self.PriceTracker.constants = _constants;
}

})();

/**
 * API Client for Price Tracker Extension.
 * Communicates with external database via REST API.
 * Implements retry logic: one retry after API_RETRY_DELAY_MS on network errors.
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var API_RETRY_DELAY_MS = _constants.API_RETRY_DELAY_MS;

/** Module-level base URL, configurable via setBaseUrl */
let baseUrl = 'https://pricetracker-production-ac69.up.railway.app';

/**
 * Set the base URL for all API requests.
 * @param {string} url
 */
function setBaseUrl(url) {
  baseUrl = url.replace(/\/+$/, '');
}

/**
 * Get the current base URL.
 * @returns {string}
 */
function getBaseUrl() {
  return baseUrl;
}

/**
 * Determine if an error is a network error (fetch itself failed, not an HTTP error).
 * @param {Error} err
 * @returns {boolean}
 */
function isNetworkError(err) {
  return err instanceof TypeError || err.name === 'TypeError';
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Core fetch wrapper with retry-on-network-error logic.
 * On network error, retries once after API_RETRY_DELAY_MS.
 * On HTTP errors, throws an appropriate ApiError.
 *
 * @param {string} path - API path (e.g. '/trackers')
 * @param {RequestInit} [options={}]
 * @returns {Promise<Response>}
 */
async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const fetchOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (isNetworkError(err)) {
      // Retry once after delay
      await sleep(API_RETRY_DELAY_MS);
      try {
        response = await fetch(url, fetchOptions);
      } catch (retryErr) {
        throw new ApiError(
          'Network error: server is unavailable after retry',
          0,
          'NETWORK_ERROR'
        );
      }
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    await handleHttpError(response);
  }

  return response;
}

/**
 * Custom error class for API errors.
 */
class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status - HTTP status code (0 for network errors)
   * @param {string} code - Error code string
   */
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Handle non-OK HTTP responses by throwing typed ApiError.
 * @param {Response} response
 */
async function handleHttpError(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  const message = body.message || body.error || response.statusText;

  switch (response.status) {
    case 404:
      throw new ApiError(
        message || 'Resource not found',
        404,
        'NOT_FOUND'
      );
    case 409:
      throw new ApiError(
        message || 'Duplicate tracker: a tracker with this URL and selector already exists',
        409,
        'DUPLICATE'
      );
    default:
      throw new ApiError(
        message || `HTTP error ${response.status}`,
        response.status,
        'HTTP_ERROR'
      );
  }
}

// ─── Tracker Methods ────────────────────────────────────────────────

/**
 * Get all trackers.
 * @returns {Promise<Object[]>}
 */
async function getTrackers() {
  const res = await request('/trackers');
  return res.json();
}

/**
 * Get a single tracker by ID.
 * @param {string} id
 * @returns {Promise<Object>}
 */
async function getTracker(id) {
  const res = await request(`/trackers/${encodeURIComponent(id)}`);
  return res.json();
}

/**
 * Create a new tracker.
 * @param {Object} data - CreateTrackerPayload
 * @returns {Promise<Object>}
 */
async function createTracker(data) {
  const res = await request('/trackers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * Update an existing tracker.
 * @param {string} id
 * @param {Object} data - Partial<Tracker>
 * @returns {Promise<Object>}
 */
async function updateTracker(id, data) {
  const res = await request(`/trackers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  return res.json();
}

/**
 * Delete a tracker.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteTracker(id) {
  await request(`/trackers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Price History Methods ──────────────────────────────────────────

/**
 * Get price history for a tracker.
 * @param {string} trackerId
 * @returns {Promise<Object[]>}
 */
async function getPriceHistory(trackerId) {
  const res = await request(
    `/priceHistory?trackerId=${encodeURIComponent(trackerId)}`
  );
  return res.json();
}

/**
 * Add a price record to a tracker's history.
 * @param {string} trackerId
 * @param {Object} record - CreatePriceRecord
 * @returns {Promise<Object>}
 */
async function addPriceRecord(trackerId, record) {
  const res = await request(
    `/priceHistory`,
    {
      method: 'POST',
      body: JSON.stringify({ ...record, trackerId }),
    }
  );
  return res.json();
}

// ─── Settings Methods ───────────────────────────────────────────────

/**
 * Get global settings.
 * @returns {Promise<Object>}
 */
async function getSettings() {
  const res = await request('/settings/global');
  return res.json();
}

/**
 * Save global settings.
 * @param {Object} settings - GlobalSettings
 * @returns {Promise<Object>}
 */
async function saveSettings(settings) {
  const res = await request('/settings/global', {
    method: 'PUT',
    body: JSON.stringify({ ...settings, id: 'global' }),
  });
  return res.json();
}

// ─── Exports ────────────────────────────────────────────────────────

const _apiClient = {
  setBaseUrl,
  getBaseUrl,
  getTrackers,
  getTracker,
  createTracker,
  updateTracker,
  deleteTracker,
  getPriceHistory,
  addPriceRecord,
  getSettings,
  saveSettings,
  ApiError,
  // Exported for testing
  _request: request,
  _isNetworkError: isNetworkError,
  _sleep: sleep,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _apiClient;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.apiClient = _apiClient;
}

})();

/**
 * Badge Manager — manages the badge on the extension icon.
 * Tracks unread count and displays it via chrome.action.setBadgeText.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var BadgeColor = _constants.BadgeColor;

let unreadCount = 0;

/**
 * Increment the unread changes counter and update the badge.
 */
function incrementUnread() {
  unreadCount++;
  updateBadge();
}

/**
 * Reset the unread counter to zero and clear the badge.
 */
function resetUnread() {
  unreadCount = 0;
  updateBadge();
}

/**
 * Show a red error badge on the extension icon.
 */
function showError() {
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: BadgeColor.ERROR });
}

/**
 * Update the badge text and color based on current unread count.
 * If unreadCount > 0, shows the count with default (green) color.
 * If unreadCount === 0, clears the badge.
 */
function updateBadge() {
  if (unreadCount > 0) {
    chrome.action.setBadgeText({ text: String(unreadCount) });
    chrome.action.setBadgeBackgroundColor({ color: BadgeColor.DEFAULT });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Get the current unread count (for testing).
 * @returns {number}
 */
function getUnreadCount() {
  return unreadCount;
}

/**
 * Set the unread count directly (for testing/restoration).
 * @param {number} count
 */
function setUnreadCount(count) {
  unreadCount = count;
  updateBadge();
}

const _badgeManager = {
  incrementUnread,
  resetUnread,
  showError,
  updateBadge,
  getUnreadCount,
  setUnreadCount,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _badgeManager;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.badgeManager = _badgeManager;
}

})();

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
    // Default behavior: notify when price drops below initial
    return newPrice < tracker.initialPrice;
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
      return newPrice < tracker.initialPrice;
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

/**
 * Alarm Manager — manages chrome.alarms for periodic price checks.
 *
 * Alarm name format: price-check-{trackerId}
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var getAlarmName = _constants.getAlarmName;
var getTrackerIdFromAlarm = _constants.getTrackerIdFromAlarm;
var ALARM_NAME_PREFIX = _constants.ALARM_NAME_PREFIX;

/**
 * Create or update an alarm for a tracker.
 * If intervalHours === 0, cancels the alarm instead (disable mode).
 *
 * @param {string} trackerId
 * @param {number} intervalHours — 6, 12, 24, or 0 (disabled)
 * @param {Function} [onCancel] — optional callback invoked when alarm is cancelled (interval 0)
 */
function scheduleTracker(trackerId, intervalHours) {
  if (intervalHours === 0) {
    cancelTracker(trackerId);
    return;
  }

  const alarmName = getAlarmName(trackerId);
  chrome.alarms.create(alarmName, { periodInMinutes: intervalHours * 60 });
}

/**
 * Cancel the alarm for a tracker.
 *
 * @param {string} trackerId
 */
function cancelTracker(trackerId) {
  const alarmName = getAlarmName(trackerId);
  chrome.alarms.clear(alarmName);
}

/**
 * Handle an alarm firing. Extracts the trackerId from the alarm name
 * and invokes the provided price-check callback.
 *
 * @param {chrome.alarms.Alarm} alarm
 * @param {Function} checkPrice — callback(trackerId) to run the price check
 */
function handleAlarm(alarm, checkPrice) {
  const trackerId = getTrackerIdFromAlarm(alarm.name);
  if (trackerId === null) {
    // Not one of our alarms — ignore
    return;
  }
  checkPrice(trackerId);
}

const _alarmManager = {
  scheduleTracker,
  cancelTracker,
  handleAlarm,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _alarmManager;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.alarmManager = _alarmManager;
}

})();

/**
 * Price Checker — background price/content checking module.
 *
 * Opens a background tab (or pinned tab), injects priceExtractor.js,
 * receives the result via message passing, and updates the tracker.
 *
 * Uses dependency injection for testability:
 *   deps = { apiClient, badgeManager, notifier }
 *
 * Exports:
 *   checkPrice(trackerId, deps) — check a single tracker
 *   checkAllPrices(deps) — check all active trackers sequentially
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 13.4, 15.2, 18.2, 19.1, 19.2, 19.3
 */
(function () {

var _constants = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants)
  ? self.PriceTracker.constants
  : require('../shared/constants');
var PAGE_LOAD_TIMEOUT_MS = _constants.PAGE_LOAD_TIMEOUT_MS;
var TrackerStatus = _constants.TrackerStatus;
var CheckMode = _constants.CheckMode;
var TrackingType = _constants.TrackingType;
var MessageFromCS = _constants.MessageFromCS;

/**
 * Wait for a tab to finish loading (status === 'complete').
 * Resolves when the tab's status becomes 'complete', or rejects on timeout.
 *
 * @param {number} tabId
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Page load timeout'));
      }
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && !settled) {
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Wait for an extraction message from the content script.
 * Listens for priceExtracted, contentExtracted, or extractionFailed.
 *
 * @param {string} trackerId
 * @param {number} timeoutMs
 * @returns {Promise<Object>} — the message received
 */
function waitForExtractionMessage(trackerId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        chrome.runtime.onMessage.removeListener(listener);
        reject(new Error('Extraction message timeout'));
      }
    }, timeoutMs);

    function listener(message, _sender, _sendResponse) {
      if (!message || message.trackerId !== trackerId) return;

      const validActions = [
        MessageFromCS.PRICE_EXTRACTED,
        MessageFromCS.CONTENT_EXTRACTED,
        MessageFromCS.EXTRACTION_FAILED,
      ];

      if (validActions.includes(message.action) && !settled) {
        settled = true;
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message);
      }
    }

    chrome.runtime.onMessage.addListener(listener);
  });
}

/**
 * Open a tab, inject the extractor, and return the extraction result.
 *
 * @param {Object} tracker
 * @param {boolean} pinned — whether to open as pinned tab
 * @returns {Promise<Object>} — extraction message
 */
async function performExtraction(tracker, pinned) {
  const tab = await chrome.tabs.create({
    url: tracker.pageUrl,
    active: false,
    ...(pinned ? { pinned: true } : {}),
  });

  const tabId = tab.id;

  try {
    // Wait for page to load
    await waitForTabLoad(tabId, PAGE_LOAD_TIMEOUT_MS);

    // Set extraction data on the tab, then inject the extractor script
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => { window.__ptExtractData = data; },
      args: [{
        trackerId: tracker.id,
        cssSelector: tracker.cssSelector,
        trackingType: tracker.trackingType || TrackingType.PRICE,
        excludedSelectors: tracker.excludedSelectors || [],
      }],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/priceExtractor.js'],
    });

    // Wait for the extraction result message
    const message = await waitForExtractionMessage(tracker.id, PAGE_LOAD_TIMEOUT_MS);
    return message;
  } finally {
    // Always close the tab
    try {
      await chrome.tabs.remove(tabId);
    } catch (_) {
      // Tab may already be closed
    }
  }
}

/**
 * Process a successful price extraction result.
 * Updates tracker stats and saves a price record.
 *
 * @param {Object} tracker
 * @param {number} newPrice
 * @param {Object} deps — { apiClient, badgeManager, notifier }
 * @returns {Promise<void>}
 */
async function handlePriceResult(tracker, newPrice, deps) {
  const { apiClient, badgeManager, notifier } = deps;
  const now = new Date().toISOString();

  // Save price record
  await apiClient.addPriceRecord(tracker.id, {
    price: newPrice,
    checkedAt: now,
  });

  // Compute updated stats
  const updatedMin = Math.min(tracker.minPrice, newPrice);
  const updatedMax = Math.max(tracker.maxPrice, newPrice);
  const priceChanged = newPrice !== tracker.currentPrice;

  const updateData = {
    currentPrice: newPrice,
    minPrice: updatedMin,
    maxPrice: updatedMax,
    lastCheckedAt: now,
    status: TrackerStatus.ACTIVE,
  };

  if (priceChanged) {
    updateData.status = TrackerStatus.UPDATED;
    updateData.unread = true;
  }

  await apiClient.updateTracker(tracker.id, updateData);

  // Notify on change
  if (priceChanged && badgeManager) {
    badgeManager.incrementUnread();
  }

  if (priceChanged && notifier) {
    try {
      await notifier.notify(tracker, tracker.currentPrice, newPrice);
    } catch (_) {
      // Notification errors should not break the check
    }
  }
}

/**
 * Process a successful content extraction result.
 * Compares with previous content, updates tracker.
 *
 * @param {Object} tracker
 * @param {string} newContent
 * @param {Object} deps — { apiClient, badgeManager, notifier }
 * @returns {Promise<void>}
 */
async function handleContentResult(tracker, newContent, deps) {
  const { apiClient, badgeManager, notifier } = deps;
  const now = new Date().toISOString();

  // Save content record
  await apiClient.addPriceRecord(tracker.id, {
    content: newContent,
    checkedAt: now,
  });

  const contentChanged = newContent !== (tracker.currentContent || '');

  const updateData = {
    currentContent: newContent,
    previousContent: tracker.currentContent || '',
    lastCheckedAt: now,
    status: TrackerStatus.ACTIVE,
  };

  if (contentChanged) {
    updateData.status = TrackerStatus.UPDATED;
    updateData.unread = true;
  }

  await apiClient.updateTracker(tracker.id, updateData);

  if (contentChanged && badgeManager) {
    badgeManager.incrementUnread();
  }

  if (contentChanged && notifier) {
    try {
      await notifier.notify(tracker, tracker.currentContent, newContent);
    } catch (_) {
      // Notification errors should not break the check
    }
  }
}

/**
 * Check a single tracker's price or content.
 *
 * Algorithm:
 * 1. Get tracker from API
 * 2. Open background tab (pinned if checkMode === 'pinTab')
 * 3. Wait for load, inject extractor, get result
 * 4. On success: save record, update tracker
 * 5. On extraction failure in 'auto' mode: retry with pinTab
 * 6. On error: set status to 'error'
 *
 * @param {string} trackerId
 * @param {Object} deps — { apiClient, badgeManager, notifier }
 * @returns {Promise<void>}
 */
async function checkPrice(trackerId, deps) {
  const { apiClient } = deps;

  let tracker;
  try {
    tracker = await apiClient.getTracker(trackerId);
  } catch (err) {
    // Cannot fetch tracker — nothing to do
    return;
  }

  // Skip paused trackers
  if (tracker.status === TrackerStatus.PAUSED) {
    return;
  }

  const usePinTab = tracker.checkMode === CheckMode.PIN_TAB;

  let message;
  try {
    message = await performExtraction(tracker, usePinTab);
  } catch (err) {
    // Timeout or tab error
    await setTrackerError(tracker, err.message, apiClient);
    return;
  }

  // Handle extraction failure with auto-mode fallback
  if (message.action === MessageFromCS.EXTRACTION_FAILED) {
    if (tracker.checkMode === CheckMode.AUTO && !usePinTab) {
      // Retry with pinned tab
      try {
        message = await performExtraction(tracker, true);
      } catch (retryErr) {
        await setTrackerError(tracker, retryErr.message, apiClient);
        return;
      }

      // If still failed after pin tab retry
      if (message.action === MessageFromCS.EXTRACTION_FAILED) {
        await setTrackerError(tracker, message.error, apiClient);
        return;
      }
    } else {
      await setTrackerError(tracker, message.error, apiClient);
      return;
    }
  }

  // Process successful extraction
  try {
    if (message.action === MessageFromCS.PRICE_EXTRACTED) {
      await handlePriceResult(tracker, message.price, deps);
    } else if (message.action === MessageFromCS.CONTENT_EXTRACTED) {
      await handleContentResult(tracker, message.content, deps);
    }
  } catch (err) {
    await setTrackerError(tracker, 'Failed to save result: ' + err.message, apiClient);
  }
}

/**
 * Set a tracker to error status.
 *
 * @param {Object} tracker
 * @param {string} errorMessage
 * @param {Object} apiClient
 * @returns {Promise<void>}
 */
async function setTrackerError(tracker, errorMessage, apiClient) {
  try {
    await apiClient.updateTracker(tracker.id, {
      status: TrackerStatus.ERROR,
      errorMessage: errorMessage,
      lastCheckedAt: new Date().toISOString(),
    });
  } catch (_) {
    // If we can't even save the error, there's nothing more to do
  }
}

/**
 * Check all active trackers sequentially.
 *
 * @param {Object} deps — { apiClient, badgeManager, notifier }
 * @returns {Promise<void>}
 */
async function checkAllPrices(deps) {
  const { apiClient } = deps;

  let trackers;
  try {
    trackers = await apiClient.getTrackers();
  } catch (_) {
    return;
  }

  // Filter to active/updated trackers (skip paused and errored)
  const activeTrackers = trackers.filter(
    (t) => t.status === TrackerStatus.ACTIVE || t.status === TrackerStatus.UPDATED
  );

  // Check sequentially
  for (const tracker of activeTrackers) {
    await checkPrice(tracker.id, deps);
  }
}

const _priceChecker = {
  checkPrice,
  checkAllPrices,
  // Exported for testing
  _waitForTabLoad: waitForTabLoad,
  _waitForExtractionMessage: waitForExtractionMessage,
  _performExtraction: performExtraction,
  _handlePriceResult: handlePriceResult,
  _handleContentResult: handleContentResult,
  _setTrackerError: setTrackerError,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _priceChecker;
}
if (typeof self !== 'undefined' && self.PriceTracker) {
  self.PriceTracker.priceChecker = _priceChecker;
}

})();

/**
 * Service Worker entry point for Price Tracker Extension.
 *
 * Loads all modules via importScripts(), sets up event listeners,
 * and routes messages between popup/dashboard/content scripts.
 *
 * Requirements: 2.1, 2.2, 2.3, 3.3, 7.1, 9.3, 13.2, 13.3, 17.2, 18.4
 */

/* global self, importScripts */

// Initialize global namespace (don't overwrite if already set, e.g. in tests)
if (typeof self !== 'undefined' && !self.PriceTracker) {
  self.PriceTracker = {};
}

// Load modules (order matters: constants first, then modules that depend on it)
importScripts(
  'shared/constants.js',
  'lib/apiClient.js',
  'lib/badgeManager.js',
  'lib/notifier.js',
  'lib/alarmManager.js',
  'lib/priceChecker.js'
);

(function () {

// Module references from the global namespace
var apiClient = self.PriceTracker.apiClient;
var priceChecker = self.PriceTracker.priceChecker;
var alarmManager = self.PriceTracker.alarmManager;
var notifier = self.PriceTracker.notifier;
var badgeManager = self.PriceTracker.badgeManager;
var _c = self.PriceTracker.constants;
var MessageToSW = _c.MessageToSW;
var MessageFromCS = _c.MessageFromCS;
var TrackerStatus = _c.TrackerStatus;
var DEFAULT_CHECK_INTERVAL = _c.DEFAULT_CHECK_INTERVAL;

// Dependencies object passed to priceChecker
const deps = { apiClient, badgeManager, notifier };

// Map notification IDs to tracker page URLs for click handling
const notificationUrlMap = {};

/**
 * Initialize API base URL from saved settings.
 */
async function initSettings() {
  try {
    const settings = await apiClient.getSettings();
    if (settings && settings.apiBaseUrl) {
      apiClient.setBaseUrl(settings.apiBaseUrl);
    }
  } catch (_) {
    // Settings not available yet — will be configured by user
  }
}

// ─── Message Router ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  const handler = getMessageHandler(message, sender);
  if (!handler) return false;

  // Handle async responses
  handler
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((err) => sendResponse({ success: false, error: err.message || String(err) }));

  // Return true to indicate async sendResponse
  return true;
});

/**
 * Route a message to the appropriate handler.
 * Returns a Promise or null if unhandled.
 */
function getMessageHandler(message, sender) {
  switch (message.action) {
    // ── Popup/Dashboard → SW ──
    case MessageToSW.START_PICKER:
      return handleStartPicker(sender);

    case MessageToSW.START_AUTO_DETECT:
      return handleStartAutoDetect(sender);

    case MessageToSW.GET_ALL_TRACKERS:
      return apiClient.getTrackers();

    case MessageToSW.GET_TRACKER:
      return apiClient.getTracker(message.trackerId);

    case MessageToSW.DELETE_TRACKER:
      return handleDeleteTracker(message.trackerId);

    case MessageToSW.UPDATE_TRACKER:
      return handleUpdateTracker(message.trackerId, message.data);

    case MessageToSW.CHECK_ALL_PRICES:
      return handleCheckAllPrices();

    case MessageToSW.CHECK_PRICE:
      return priceChecker.checkPrice(message.trackerId, deps);

    case MessageToSW.GET_SETTINGS:
      return apiClient.getSettings();

    case MessageToSW.SAVE_SETTINGS:
      return handleSaveSettings(message.settings);

    case MessageToSW.GET_PRICE_HISTORY:
      return apiClient.getPriceHistory(message.trackerId);

    case MessageToSW.MARK_AS_READ:
      return handleMarkAsRead(message.trackerId);

    case MessageToSW.RESET_BADGE:
      return handleResetBadge();

    // ── Content Script → SW ──
    case MessageFromCS.ELEMENT_SELECTED:
      return handleElementSelected(message);

    case MessageFromCS.AUTO_DETECTED:
      return handleAutoDetected(message);

    case MessageFromCS.PICKER_CANCELLED:
      return Promise.resolve();

    case MessageFromCS.AUTO_DETECT_FAILED:
      return Promise.resolve();

    default:
      return null;
  }
}

// ─── Handler Implementations ────────────────────────────────────────

/**
 * Inject selectorPicker.js into the active tab.
 * Requirement: 3.3
 */
async function handleStartPicker(sender) {
  const tab = await getActiveTab(sender);
  if (!tab) throw new Error('No active tab found');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/selectorPicker.css'],
  }).catch(() => {});

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/selectorPicker.js'],
  });
}

/**
 * Inject autoDetector.js into the active tab.
 * Requirement: 13.2
 */
async function handleStartAutoDetect(sender) {
  const tab = await getActiveTab(sender);
  if (!tab) throw new Error('No active tab found');

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/autoDetector.js'],
  });
}

/**
 * Create a tracker from manual element selection.
 * Requirements: 2.1, 2.2, 13.3
 */
async function handleElementSelected(message) {
  const payload = {
    pageUrl: message.pageUrl,
    cssSelector: message.selector,
    productName: message.title,
    imageUrl: message.imageUrl || '',
    initialPrice: message.price || 0,
    checkIntervalHours: DEFAULT_CHECK_INTERVAL,
    trackingType: message.trackingType || 'price',
    isAutoDetected: false,
    ...(message.contentValue ? { initialContent: message.contentValue } : {}),
    ...(message.excludedSelectors ? { excludedSelectors: message.excludedSelectors } : {}),
  };

  const tracker = await apiClient.createTracker(payload);

  // Schedule alarm for periodic checks
  alarmManager.scheduleTracker(tracker.id, tracker.checkIntervalHours);

  return tracker;
}

/**
 * Create a tracker from auto-detection result.
 * Requirements: 13.2, 13.3
 */
async function handleAutoDetected(message) {
  const payload = {
    pageUrl: message.pageUrl,
    cssSelector: message.selector,
    productName: message.title,
    imageUrl: message.imageUrl || '',
    initialPrice: message.price || 0,
    checkIntervalHours: DEFAULT_CHECK_INTERVAL,
    trackingType: 'price',
    isAutoDetected: true,
  };

  const tracker = await apiClient.createTracker(payload);

  // Schedule alarm for periodic checks
  alarmManager.scheduleTracker(tracker.id, tracker.checkIntervalHours);

  return tracker;
}

/**
 * Delete a tracker and cancel its alarm.
 */
async function handleDeleteTracker(trackerId) {
  alarmManager.cancelTracker(trackerId);
  await apiClient.deleteTracker(trackerId);
}

/**
 * Update a tracker and reschedule alarm if interval changed.
 */
async function handleUpdateTracker(trackerId, data) {
  const updated = await apiClient.updateTracker(trackerId, data);

  // Reschedule alarm if interval was changed
  if (data.checkIntervalHours !== undefined) {
    alarmManager.scheduleTracker(trackerId, data.checkIntervalHours);
  }

  return updated;
}

/**
 * Check all active trackers' prices.
 * Requirement: 7.1
 */
async function handleCheckAllPrices() {
  await priceChecker.checkAllPrices(deps);
}

/**
 * Save global settings and update API base URL.
 */
async function handleSaveSettings(settings) {
  // Update base URL FIRST so the save request goes to the new server
  if (settings.apiBaseUrl) {
    apiClient.setBaseUrl(settings.apiBaseUrl);
  }
  const saved = await apiClient.saveSettings(settings);
  return saved;
}


/**
 * Mark a tracker as read: reset status from "updated" to "active".
 * Requirement: 18.4
 */
async function handleMarkAsRead(trackerId) {
  const tracker = await apiClient.getTracker(trackerId);
  if (tracker.status === TrackerStatus.UPDATED) {
    await apiClient.updateTracker(trackerId, {
      status: TrackerStatus.ACTIVE,
      unread: false,
    });
  }
  badgeManager.updateBadge();
}

/**
 * Reset badge when dashboard is opened.
 * Requirement: 17.2
 */
async function handleResetBadge() {
  badgeManager.resetUnread();
}

/**
 * Get the active tab. Uses sender.tab if available (from content script),
 * otherwise queries for the active tab in the current window.
 */
async function getActiveTab(sender) {
  if (sender && sender.tab) {
    return sender.tab;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

// ─── Alarm Handler ──────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  alarmManager.handleAlarm(alarm, (trackerId) => {
    priceChecker.checkPrice(trackerId, deps);
  });
});

// ─── Notification Click Handler ─────────────────────────────────────

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const prefix = 'price-tracker-';
  if (!notificationId.startsWith(prefix)) return;

  const trackerId = notificationId.slice(prefix.length);

  try {
    const tracker = await apiClient.getTracker(trackerId);
    if (tracker && tracker.pageUrl) {
      chrome.tabs.create({ url: tracker.pageUrl });
    }
  } catch (_) {
    // Tracker may have been deleted
  }

  chrome.notifications.clear(notificationId);
});

// ─── Initialization ─────────────────────────────────────────────────

initSettings();

// ─── Exports for testing ────────────────────────────────────────────

var _bgExports = {
  getMessageHandler: getMessageHandler,
  handleStartPicker: handleStartPicker,
  handleStartAutoDetect: handleStartAutoDetect,
  handleElementSelected: handleElementSelected,
  handleAutoDetected: handleAutoDetected,
  handleDeleteTracker: handleDeleteTracker,
  handleUpdateTracker: handleUpdateTracker,
  handleCheckAllPrices: handleCheckAllPrices,
  handleSaveSettings: handleSaveSettings,
  handleMarkAsRead: handleMarkAsRead,
  handleResetBadge: handleResetBadge,
  getActiveTab: getActiveTab,
  initSettings: initSettings,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _bgExports;
}

})();


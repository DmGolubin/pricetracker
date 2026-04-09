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
  'lib/thresholdEngine.js',
  'lib/digestComposer.js',
  'lib/notifier.js',
  'lib/alarmManager.js',
  'lib/priceChecker.js'
);

(function () {

// Module references from the global namespace
var apiClient = self.PriceTracker.apiClient;
var alarmManager = self.PriceTracker.alarmManager;
var notifier = self.PriceTracker.notifier;
var badgeManager = self.PriceTracker.badgeManager;
var priceChecker = self.PriceTracker.priceChecker;
var _c = self.PriceTracker.constants;
var MessageToSW = _c.MessageToSW;
var MessageFromCS = _c.MessageFromCS;
var TrackerStatus = _c.TrackerStatus;
var CheckMethod = _c.CheckMethod;
var DEFAULT_CHECK_INTERVAL = _c.DEFAULT_CHECK_INTERVAL;

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
    .catch((err) => sendResponse({
      success: false,
      error: err.message || String(err),
      code: err.code || '',
      status: err.status || 0,
    }));

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
      return handleCheckAllPrices(message.method || null);

    case MessageToSW.CHECK_ALL_PRICES_EXTENSION:
      return handleCheckAllPrices(CheckMethod.EXTENSION);

    case MessageToSW.CHECK_PRICE:
      return handleCheckSingle(message.trackerId);

    case MessageToSW.CHECK_PRICE_EXTENSION:
      return handleExtensionCheckSingle(message.trackerId);

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

    case MessageToSW.EXPORT_COOKIES:
      return handleExportCookies(message.domain);

    // ── Content Script → SW ──
    case MessageFromCS.ELEMENT_SELECTED:
      return handleElementSelected(message);

    case MessageFromCS.AUTO_DETECTED:
      return handleAutoDetected(message);

    case MessageFromCS.PICKER_CANCELLED:
      return Promise.resolve();

    case MessageFromCS.AUTO_DETECT_FAILED:
      return Promise.resolve();

    // Extraction results from content scripts — handled by priceChecker via
    // its own onMessage listener (waitForExtractionMessage). Return null so
    // the main router does not interfere.
    case MessageFromCS.PRICE_EXTRACTED:
    case MessageFromCS.CONTENT_EXTRACTED:
    case MessageFromCS.EXTRACTION_FAILED:
      return null;

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
    checkIntervalHours: message.checkIntervalHours || DEFAULT_CHECK_INTERVAL,
    trackingType: message.trackingType || 'price',
    isAutoDetected: false,
    checkMode: message.checkMode || 'auto',
    productGroup: message.productGroup || '',
    variantSelector: message.variantSelector || '',
    ...(message.contentValue ? { initialContent: message.contentValue, currentContent: message.contentValue } : {}),
    ...(message.excludedSelectors ? { excludedSelectors: message.excludedSelectors } : {}),
  };

  const tracker = await apiClient.createTracker(payload);

  // Schedule alarm for periodic checks
  alarmManager.scheduleTracker(tracker.id, tracker.checkIntervalHours);

  // Run first price check respecting the global checkMethod setting
  setTimeout(function () {
    handleCheckSingle(tracker.id)
      .then(function () {
        // Notify open dashboard/popup that this tracker was updated
        chrome.runtime.sendMessage({
          action: _c.MessageFromSW.TRACKER_UPDATED,
          trackerId: tracker.id,
        }).catch(function () {});
      })
      .catch(function (err) {
        console.warn('First check for new tracker #' + tracker.id + ' failed:', err);
      });
  }, 2000);

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

  // Run first price check respecting the global checkMethod setting
  setTimeout(function () {
    handleCheckSingle(tracker.id)
      .then(function () {
        chrome.runtime.sendMessage({
          action: _c.MessageFromSW.TRACKER_UPDATED,
          trackerId: tracker.id,
        }).catch(function () {});
      })
      .catch(function (err) {
        console.warn('First check for new tracker #' + tracker.id + ' failed:', err);
      });
  }, 2000);

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

  // Handle pause/resume: cancel alarm when paused, reschedule when active
  if (data.status === 'paused') {
    alarmManager.cancelTracker(trackerId);
  } else if (data.status === 'active' && updated.checkIntervalHours) {
    alarmManager.scheduleTracker(trackerId, updated.checkIntervalHours);
  }

  // Reschedule alarm if interval was changed (and not paused)
  if (data.checkIntervalHours !== undefined && updated.status !== 'paused') {
    alarmManager.scheduleTracker(trackerId, data.checkIntervalHours);
  }

  return updated;
}

/**
 * Get the effective check method for a given context.
 * Per-tracker checkMethod overrides global setting.
 * @param {Object} [tracker] - optional tracker with checkMethod field
 * @returns {Promise<string>} - 'server', 'extension', or 'hybrid'
 */
async function getCheckMethod(tracker) {
  if (tracker && tracker.checkMethod) return tracker.checkMethod;
  try {
    var settings = await apiClient.getSettings();
    return (settings && settings.checkMethod) || CheckMethod.SERVER;
  } catch (_) {
    return CheckMethod.SERVER;
  }
}

/** Dependency bag for priceChecker */
var extensionCheckDeps = {
  apiClient: apiClient,
  badgeManager: badgeManager,
  notifier: notifier,
};

/**
 * Check all active trackers' prices.
 * Respects the global checkMethod setting: server / extension / hybrid.
 * Requirement: 7.1
 */
async function handleCheckAllPrices(method) {
  var checkMethod = method || null;
  if (!checkMethod) {
    checkMethod = await getCheckMethod();
  }

  if (checkMethod === CheckMethod.EXTENSION) {
    // Extension-based check: open tabs, inject extractors
    await priceChecker.checkAllPrices(extensionCheckDeps);
    return { method: 'extension' };
  }

  if (checkMethod === CheckMethod.HYBRID) {
    // Hybrid: try server first, fallback to extension on error
    try {
      await apiClient._request('/server-check', { method: 'POST' });
      return { method: 'hybrid-server' };
    } catch (_) {
      await priceChecker.checkAllPrices(extensionCheckDeps);
      return { method: 'hybrid-extension' };
    }
  }

  // Default: server-side check via API (Puppeteer on Railway)
  await apiClient._request('/server-check', { method: 'POST' });
  return { method: 'server' };
}

/**
 * Check a single tracker's price via extension (open tab).
 * @param {string} trackerId
 * @returns {Promise<void>}
 */
async function handleExtensionCheckSingle(trackerId) {
  await priceChecker.checkPrice(trackerId, extensionCheckDeps);
}

/**
 * Check a single tracker — respects per-tracker and global checkMethod.
 * @param {string} trackerId
 * @returns {Promise<Object>}
 */
async function handleCheckSingle(trackerId) {
  var tracker = null;
  try { tracker = await apiClient.getTracker(trackerId); } catch (_) {}
  var method = await getCheckMethod(tracker);
  console.log('[CheckSingle] #' + trackerId + ' method=' + method);

  if (method === CheckMethod.EXTENSION) {
    await priceChecker.checkPrice(trackerId, extensionCheckDeps);
    return { method: 'extension' };
  }

  if (method === CheckMethod.HYBRID) {
    try {
      var result = await apiClient.serverCheckSingle(trackerId);
      return Object.assign({ method: 'hybrid-server' }, result);
    } catch (_) {
      await priceChecker.checkPrice(trackerId, extensionCheckDeps);
      return { method: 'hybrid-extension' };
    }
  }

  // Default: server
  return apiClient.serverCheckSingle(trackerId);
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
 * Export all cookies for a given domain via chrome.cookies API.
 * @param {string} domain - Domain to export cookies for (e.g. "kasta.ua")
 * @returns {Promise<Object[]>} Array of cookie objects
 */
async function handleExportCookies(domain) {
  if (!domain) return [];
  var url = 'https://' + domain.replace(/^\./, '');
  var cookies = await chrome.cookies.getAll({ url: url });
  // Also try with www prefix
  var wwwCookies = await chrome.cookies.getAll({ url: 'https://www.' + domain.replace(/^\./, '') });
  // Merge, deduplicate by name+domain+path
  var seen = {};
  var merged = [];
  var all = cookies.concat(wwwCookies);
  for (var i = 0; i < all.length; i++) {
    var c = all[i];
    var key = c.name + '|' + c.domain + '|' + c.path;
    if (!seen[key]) {
      seen[key] = true;
      merged.push(c);
    }
  }
  return merged;
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
// When checkMethod is 'extension' or 'hybrid', alarms trigger local checks.
// When checkMethod is 'server', alarms are not used (server cron handles it).

chrome.alarms.onAlarm.addListener(function (alarm) {
  var _getAlarmId = _c.getTrackerIdFromAlarm;
  var trackerId = _getAlarmId ? _getAlarmId(alarm.name) : null;
  if (!trackerId) return;

  // Check the global method — only run extension check if not server-only
  getCheckMethod().then(function (method) {
    if (method === CheckMethod.SERVER) return; // server cron handles it
    priceChecker.checkPrice(trackerId, extensionCheckDeps).catch(function (err) {
      console.warn('Alarm check failed for tracker #' + trackerId + ':', err);
    });
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

// ─── Restore alarms on install/update/startup ──────────────────────

/**
 * Reschedule alarms for all active trackers.
 * Only sets alarms when checkMethod is 'extension' or 'hybrid'.
 */
async function rescheduleAllAlarms() {
  var method = await getCheckMethod();
  if (method === CheckMethod.SERVER) {
    chrome.alarms.clearAll();
    return;
  }
  try {
    var trackers = await apiClient.getTrackers();
    for (var i = 0; i < trackers.length; i++) {
      var t = trackers[i];
      if (t.status !== TrackerStatus.PAUSED && t.status !== TrackerStatus.ERROR) {
        var interval = t.checkIntervalHours || DEFAULT_CHECK_INTERVAL;
        if (interval > 0) {
          alarmManager.scheduleTracker(t.id, interval);
        }
      }
    }
  } catch (_) {
    // Cannot fetch trackers — alarms will be set on next check
  }
}

chrome.runtime.onInstalled.addListener(() => {
  initSettings();
  rescheduleAllAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  initSettings();
  rescheduleAllAlarms();
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
  handleCheckSingle: handleCheckSingle,
  handleExtensionCheckSingle: handleExtensionCheckSingle,
  handleSaveSettings: handleSaveSettings,
  handleMarkAsRead: handleMarkAsRead,
  handleResetBadge: handleResetBadge,
  getActiveTab: getActiveTab,
  initSettings: initSettings,
  rescheduleAllAlarms: rescheduleAllAlarms,
  getCheckMethod: getCheckMethod,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _bgExports;
}

})();

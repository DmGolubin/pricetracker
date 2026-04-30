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

var _thresholdEngine;
if (typeof require !== 'undefined') {
  _thresholdEngine = require('./thresholdEngine');
} else if (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.thresholdEngine) {
  _thresholdEngine = self.PriceTracker.thresholdEngine;
}

var _digestComposer;
if (typeof require !== 'undefined') {
  _digestComposer = require('./digestComposer');
} else if (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.digestComposer) {
  _digestComposer = self.PriceTracker.digestComposer;
}

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
      if (!message || String(message.trackerId) !== String(trackerId)) return;

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
  // Try to reuse an existing tab with the same domain to avoid Cloudflare challenges.
  // Existing tabs already have cookies/session, so CF won't block them.
  var tabId = null;
  var reusingTab = false;

  try {
    var urlObj = new URL(tracker.pageUrl);
    var domain = urlObj.hostname;
    // Search for existing tabs matching this domain
    var existingTabs = await chrome.tabs.query({ url: '*://' + domain + '/*' });
    if (existingTabs.length > 0) {
      // Prefer non-active tabs to avoid disrupting user's work
      var candidate = existingTabs.find(function(t) { return !t.active; }) || existingTabs[0];
      tabId = candidate.id;
      reusingTab = true;
      // Navigate the existing tab to the tracker URL
      await chrome.tabs.update(tabId, { url: tracker.pageUrl });
    }
  } catch (_) {
    // URL parsing or tab query failed — fall through to create new tab
  }

  if (!tabId) {
    var tab = await chrome.tabs.create({
      url: tracker.pageUrl,
      active: false,
      pinned: true,
    });
    tabId = tab.id;
  }

  try {
    // Wait for page to load
    await waitForTabLoad(tabId, PAGE_LOAD_TIMEOUT_MS);

    // Give SPA/dynamic pages time to render content after 'complete'
    await new Promise(function (r) { setTimeout(r, 2000); });

    // Register the message listener BEFORE injecting the extractor
    // to avoid a race condition where the content script sends the
    // message before the listener is ready.
    const extractionPromise = waitForExtractionMessage(tracker.id, PAGE_LOAD_TIMEOUT_MS);

    // Set extraction data on the tab, then inject the extractor script
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => { window.__ptExtractData = data; },
      args: [{
        trackerId: tracker.id,
        cssSelector: tracker.cssSelector,
        trackingType: tracker.trackingType || TrackingType.PRICE,
        excludedSelectors: tracker.excludedSelectors || [],
        variantSelector: tracker.variantSelector || '',
      }],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/priceExtractor.js'],
    });

    // Wait for the extraction result message
    const message = await extractionPromise;

    return message;
  } finally {
    // Close the tab only if we created it (don't close user's existing tabs)
    if (!reusingTab) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {
        // Tab may already be closed
      }
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

  // Detect first check for variant trackers: use the explicit
  // variantPriceVerified flag instead of price comparison heuristics.
  // This flag is false when the tracker is first created and set to
  // true after the first successful price read.
  var isFirstVariantCheck = tracker.variantSelector
    && !tracker.variantPriceVerified;

  // Compute updated stats
  var baseMin = isFirstVariantCheck ? newPrice : tracker.minPrice;
  var baseMax = isFirstVariantCheck ? newPrice : tracker.maxPrice;
  const updatedMin = Math.min(baseMin, newPrice);
  const updatedMax = Math.max(baseMax, newPrice);
  const priceChanged = Number(newPrice) !== Number(tracker.currentPrice);

  const updateData = {
    currentPrice: newPrice,
    minPrice: updatedMin,
    maxPrice: updatedMax,
    lastCheckedAt: now,
    status: TrackerStatus.ACTIVE,
  };

  // On first variant check, correct the initialPrice to the real value
  // and mark the variant as verified so future checks trigger notifications.
  if (isFirstVariantCheck) {
    updateData.initialPrice = newPrice;
    updateData.variantPriceVerified = true;
  }

  if (priceChanged && !isFirstVariantCheck) {
    updateData.status = TrackerStatus.UPDATED;
    updateData.unread = true;
  }

  await apiClient.updateTracker(tracker.id, updateData);

  // Check if this is a historical minimum (only when price decreased)
  var isHistMin = false;
  var isCrossStoreMin = false;
  if (_thresholdEngine && priceChanged && !isFirstVariantCheck && newPrice < Number(tracker.currentPrice)) {
    isHistMin = _thresholdEngine.isHistoricalMinimum(newPrice, tracker.minPrice);

    // Cross-store group minimum: check if this price beats all stores in the group
    if (tracker.productGroup && apiClient) {
      try {
        var groupTrackers = await apiClient.getTrackers();
        var groupMembers = groupTrackers.filter(function(t) {
          return t.productGroup === tracker.productGroup && t.id !== tracker.id && Number(t.minPrice) > 0;
        });
        if (groupMembers.length > 0) {
          var groupMin = Math.min.apply(null, groupMembers.map(function(t) { return Number(t.minPrice); }));
          if (newPrice < groupMin) {
            isCrossStoreMin = true;
            isHistMin = true;
          }
        }
      } catch (_g) {
        // Group check failure should not break the flow
      }
    }
  }

  // For grouped trackers: suppress price-drop alerts unless the new price
  // beats the current best price across all other stores in the group.
  var suppressedByGroup = false;
  if (priceChanged && !isFirstVariantCheck && newPrice < Number(tracker.currentPrice) && tracker.productGroup && apiClient) {
    try {
      var allTrackers = await apiClient.getTrackers();
      var groupMembers = allTrackers.filter(function(t) {
        return t.productGroup === tracker.productGroup && t.id !== tracker.id && Number(t.currentPrice) > 0;
      });
      if (groupMembers.length > 0) {
        var groupCurrentMin = Math.min.apply(null, groupMembers.map(function(t) { return Number(t.currentPrice); }));
        if (newPrice >= groupCurrentMin) {
          suppressedByGroup = true;
        }
      }
    } catch (_sg) {
      // Group check failure should not break the flow
    }
  }

  // Notify on change (but not on first variant price correction, not if suppressed by group)
  if (priceChanged && !isFirstVariantCheck && !suppressedByGroup && badgeManager) {
    badgeManager.incrementUnread();
  }

  if (priceChanged && !isFirstVariantCheck && !suppressedByGroup && notifier) {
    try {
      var settings = {};
      try { settings = await deps.apiClient.getSettings(); } catch (_s) {}
      var notifyOptions = isHistMin ? { isHistoricalMinimum: true, isCrossStoreMinimum: isCrossStoreMin } : undefined;
      await notifier.notify(tracker, tracker.currentPrice, newPrice, settings, notifyOptions);
    } catch (_) {
      // Notification errors should not break the check
    }
  }

  // Feed the digest collector
  if (deps.digestCollector) {
    if (priceChanged && !isFirstVariantCheck && !suppressedByGroup) {
      deps.digestCollector.addChange(tracker, tracker.currentPrice, newPrice, isHistMin, isCrossStoreMin);
    } else {
      deps.digestCollector.addUnchanged();
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

  // Normalize text for comparison to avoid false positives from HTML rendering
  // differences. Sites often render with varying whitespace between loads
  // (e.g. "305 грн" vs "305грн", extra spaces, non-breaking spaces).
  // We collapse all whitespace and remove spaces between digits and letters
  // to produce a canonical form for comparison only.
  function normalizeForComparison(text) {
    return String(text || '')
      .replace(/[\s\u00A0\u202F]+/g, '')  // remove all whitespace
      .toLowerCase()
      .trim();
  }

  const normalizedNew = normalizeForComparison(newContent);
  const normalizedOld = normalizeForComparison(tracker.currentContent);
  const contentChanged = normalizedNew !== normalizedOld;

  // Save content record to history with the contentValue field (server expects "contentValue")
  // Only include previousContent when content actually changed, so ContentDiff
  // doesn't show a false diff from formatting differences (e.g. whitespace changes)
  await apiClient.addPriceRecord(tracker.id, {
    contentValue: newContent,
    previousContent: contentChanged ? (tracker.currentContent || '') : '',
    checkedAt: now,
  });

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
      var settings = {};
      try { settings = await deps.apiClient.getSettings(); } catch (_s) {}
      await notifier.notify(tracker, tracker.currentContent, newContent, settings);
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

  // Create digest collector for this check cycle
  var collector = _digestComposer ? _digestComposer.createCollector() : null;
  var checkDeps = Object.assign({}, deps);
  if (collector) {
    checkDeps.digestCollector = collector;
  }

  // Fetch settings once for digest sending later
  var settings = {};
  try { settings = await apiClient.getSettings(); } catch (_s) {}

  // Check in parallel with concurrency limit
  const CONCURRENCY = 3;
  var i = 0;

  async function next() {
    while (i < activeTrackers.length) {
      var tracker = activeTrackers[i++];
      await checkPrice(tracker.id, checkDeps);
    }
  }

  var workers = [];
  for (var w = 0; w < Math.min(CONCURRENCY, activeTrackers.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);

  // Send digest via Telegram if there are changes and digest is enabled
  if (collector && collector.hasChanges() && settings.telegramDigestEnabled) {
    try {
      var messages = collector.compose();
      if (messages.length > 0 && settings.telegramBotToken && settings.telegramChatId) {
        var telegramUrl = 'https://api.telegram.org/bot' + settings.telegramBotToken + '/sendMessage';
        for (var m = 0; m < messages.length; m++) {
          await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: settings.telegramChatId,
              text: messages[m],
              parse_mode: 'HTML',
            }),
          });
        }
      }
    } catch (err) {
      // Digest send errors should not break the check cycle
      console.error('Digest send error:', err);
    }
  }

  // Attempt auto-grouping of ungrouped trackers after check cycle
  try {
    if (apiClient.getBaseUrl) {
      var autoGroupUrl = apiClient.getBaseUrl() + '/trackers/auto-group';
      await fetch(autoGroupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err) {
    // Auto-group errors should not break the check cycle
    console.error('Auto-group error:', err);
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

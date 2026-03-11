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
  const tab = await chrome.tabs.create({
    url: tracker.pageUrl,
    active: false,
    ...(pinned ? { pinned: true } : {}),
  });

  const tabId = tab.id;

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
  const priceChanged = Number(newPrice) !== Number(tracker.currentPrice);

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
      var settings = {};
      try { settings = await deps.apiClient.getSettings(); } catch (_s) {}
      await notifier.notify(tracker, tracker.currentPrice, newPrice, settings);
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

  // Check in parallel with concurrency limit
  const CONCURRENCY = 3;
  var i = 0;

  async function next() {
    while (i < activeTrackers.length) {
      var tracker = activeTrackers[i++];
      await checkPrice(tracker.id, deps);
    }
  }

  var workers = [];
  for (var w = 0; w < Math.min(CONCURRENCY, activeTrackers.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);
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

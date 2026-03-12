/**
 * Unit tests for lib/priceChecker.js
 */
const {
  checkPrice,
  checkAllPrices,
  _waitForTabLoad: waitForTabLoad,
  _waitForExtractionMessage: waitForExtractionMessage,
  _performExtraction: performExtraction,
  _handlePriceResult: handlePriceResult,
  _handleContentResult: handleContentResult,
  _setTrackerError: setTrackerError,
} = require('../../lib/priceChecker');

const {
  PAGE_LOAD_TIMEOUT_MS,
  TrackerStatus,
  CheckMode,
  TrackingType,
  MessageFromCS,
} = require('../../shared/constants');

// ─── Helpers ────────────────────────────────────────────────────────

function makeTracker(overrides = {}) {
  return {
    id: 'tracker-1',
    pageUrl: 'https://shop.com/product',
    cssSelector: '.price',
    productName: 'Test Product',
    imageUrl: 'https://shop.com/img.jpg',
    initialPrice: 100,
    currentPrice: 100,
    minPrice: 100,
    maxPrice: 100,
    checkIntervalHours: 12,
    notificationsEnabled: true,
    status: TrackerStatus.ACTIVE,
    trackingType: TrackingType.PRICE,
    checkMode: CheckMode.AUTO,
    unread: false,
    ...overrides,
  };
}

function makeDeps(overrides = {}) {
  return {
    apiClient: {
      getTracker: jest.fn(),
      getTrackers: jest.fn(),
      getSettings: jest.fn().mockResolvedValue({}),
      updateTracker: jest.fn().mockResolvedValue({}),
      addPriceRecord: jest.fn().mockResolvedValue({}),
    },
    badgeManager: {
      incrementUnread: jest.fn(),
    },
    notifier: {
      notify: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ─── waitForTabLoad ─────────────────────────────────────────────────

describe('waitForTabLoad', () => {
  test('resolves when tab status becomes complete', async () => {
    // Capture the listener added by waitForTabLoad
    let capturedListener;
    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForTabLoad(42, 5000);

    // Simulate tab load complete
    capturedListener(42, { status: 'complete' });

    await expect(promise).resolves.toBeUndefined();
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(capturedListener);
  });

  test('ignores updates for other tabs', async () => {
    let capturedListener;
    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForTabLoad(42, 5000);

    // Update for a different tab — should not resolve
    capturedListener(99, { status: 'complete' });

    // Now the correct tab
    capturedListener(42, { status: 'complete' });

    await expect(promise).resolves.toBeUndefined();
  });

  test('ignores non-complete status updates', async () => {
    let capturedListener;
    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForTabLoad(42, 5000);

    capturedListener(42, { status: 'loading' });
    capturedListener(42, { status: 'complete' });

    await expect(promise).resolves.toBeUndefined();
  });

  test('rejects on timeout', async () => {
    chrome.tabs.onUpdated.addListener.mockImplementation(() => {});

    const promise = waitForTabLoad(42, 1000);

    jest.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('Page load timeout');
  });
});

// ─── waitForExtractionMessage ───────────────────────────────────────

describe('waitForExtractionMessage', () => {
  test('resolves with priceExtracted message', async () => {
    let capturedListener;
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForExtractionMessage('t1', 5000);

    const msg = { action: MessageFromCS.PRICE_EXTRACTED, trackerId: 't1', price: 99 };
    capturedListener(msg, {}, jest.fn());

    await expect(promise).resolves.toEqual(msg);
    expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(capturedListener);
  });

  test('resolves with contentExtracted message', async () => {
    let capturedListener;
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForExtractionMessage('t1', 5000);

    const msg = { action: MessageFromCS.CONTENT_EXTRACTED, trackerId: 't1', content: 'In stock' };
    capturedListener(msg, {}, jest.fn());

    await expect(promise).resolves.toEqual(msg);
  });

  test('resolves with extractionFailed message', async () => {
    let capturedListener;
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForExtractionMessage('t1', 5000);

    const msg = { action: MessageFromCS.EXTRACTION_FAILED, trackerId: 't1', error: 'Not found' };
    capturedListener(msg, {}, jest.fn());

    await expect(promise).resolves.toEqual(msg);
  });

  test('ignores messages for other trackers', async () => {
    let capturedListener;
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      capturedListener = fn;
    });

    const promise = waitForExtractionMessage('t1', 5000);

    // Message for different tracker
    capturedListener({ action: MessageFromCS.PRICE_EXTRACTED, trackerId: 't2', price: 50 }, {}, jest.fn());

    // Correct tracker
    capturedListener({ action: MessageFromCS.PRICE_EXTRACTED, trackerId: 't1', price: 99 }, {}, jest.fn());

    const result = await promise;
    expect(result.trackerId).toBe('t1');
    expect(result.price).toBe(99);
  });

  test('rejects on timeout', async () => {
    chrome.runtime.onMessage.addListener.mockImplementation(() => {});

    const promise = waitForExtractionMessage('t1', 1000);

    jest.advanceTimersByTime(1001);

    await expect(promise).rejects.toThrow('Extraction message timeout');
  });
});

// ─── handlePriceResult ──────────────────────────────────────────────

describe('handlePriceResult', () => {
  test('saves price record and updates tracker on price change', async () => {
    const tracker = makeTracker({ currentPrice: 100, minPrice: 90, maxPrice: 110 });
    const deps = makeDeps();

    await handlePriceResult(tracker, 85, deps);

    expect(deps.apiClient.addPriceRecord).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      price: 85,
    }));

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      currentPrice: 85,
      minPrice: 85,
      maxPrice: 110,
      status: TrackerStatus.UPDATED,
      unread: true,
    }));

    expect(deps.badgeManager.incrementUnread).toHaveBeenCalled();
    // newPrice 85 < minPrice 90 → historical minimum, so options include isHistoricalMinimum
    expect(deps.notifier.notify).toHaveBeenCalledWith(tracker, 100, 85, {}, { isHistoricalMinimum: true });
  });

  test('does not set updated status when price unchanged', async () => {
    const tracker = makeTracker({ currentPrice: 100, minPrice: 100, maxPrice: 100 });
    const deps = makeDeps();

    await handlePriceResult(tracker, 100, deps);

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      currentPrice: 100,
      status: TrackerStatus.ACTIVE,
    }));

    // Should NOT have unread or badge increment
    const updateCall = deps.apiClient.updateTracker.mock.calls[0][1];
    expect(updateCall.unread).toBeUndefined();
    expect(deps.badgeManager.incrementUnread).not.toHaveBeenCalled();
    expect(deps.notifier.notify).not.toHaveBeenCalled();
  });

  test('updates minPrice when new price is lower', async () => {
    const tracker = makeTracker({ currentPrice: 100, minPrice: 90, maxPrice: 110 });
    const deps = makeDeps();

    await handlePriceResult(tracker, 80, deps);

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      minPrice: 80,
      maxPrice: 110,
    }));
  });

  test('updates maxPrice when new price is higher', async () => {
    const tracker = makeTracker({ currentPrice: 100, minPrice: 90, maxPrice: 110 });
    const deps = makeDeps();

    await handlePriceResult(tracker, 120, deps);

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      minPrice: 90,
      maxPrice: 120,
    }));
  });

  test('works without badgeManager and notifier', async () => {
    const tracker = makeTracker({ currentPrice: 100 });
    const deps = makeDeps({ badgeManager: null, notifier: null });

    await expect(handlePriceResult(tracker, 90, deps)).resolves.toBeUndefined();
  });
});

// ─── handleContentResult ────────────────────────────────────────────

describe('handleContentResult', () => {
  test('saves content record and updates tracker on content change', async () => {
    const tracker = makeTracker({
      trackingType: TrackingType.CONTENT,
      currentContent: 'In stock',
    });
    const deps = makeDeps();

    await handleContentResult(tracker, 'Out of stock', deps);

    expect(deps.apiClient.addPriceRecord).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      contentValue: 'Out of stock',
    }));

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      currentContent: 'Out of stock',
      previousContent: 'In stock',
      status: TrackerStatus.UPDATED,
      unread: true,
    }));

    expect(deps.badgeManager.incrementUnread).toHaveBeenCalled();
  });

  test('does not set updated status when content unchanged', async () => {
    const tracker = makeTracker({
      trackingType: TrackingType.CONTENT,
      currentContent: 'In stock',
    });
    const deps = makeDeps();

    await handleContentResult(tracker, 'In stock', deps);

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      status: TrackerStatus.ACTIVE,
    }));

    const updateCall = deps.apiClient.updateTracker.mock.calls[0][1];
    expect(updateCall.unread).toBeUndefined();
    expect(deps.badgeManager.incrementUnread).not.toHaveBeenCalled();
  });
});

// ─── setTrackerError ────────────────────────────────────────────────

describe('setTrackerError', () => {
  test('updates tracker with error status and message', async () => {
    const tracker = makeTracker();
    const apiClient = { updateTracker: jest.fn().mockResolvedValue({}) };

    await setTrackerError(tracker, 'Selector not found', apiClient);

    expect(apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      status: TrackerStatus.ERROR,
      errorMessage: 'Selector not found',
    }));
  });

  test('does not throw if updateTracker fails', async () => {
    const tracker = makeTracker();
    const apiClient = { updateTracker: jest.fn().mockRejectedValue(new Error('DB down')) };

    await expect(setTrackerError(tracker, 'err', apiClient)).resolves.toBeUndefined();
  });
});

// ─── checkPrice (integration-style) ────────────────────────────────

describe('checkPrice', () => {
  // For these tests we need to mock the Chrome APIs more carefully
  // since checkPrice calls performExtraction internally

  function setupTabAndExtraction(tracker, extractionMessage) {
    // Mock tab creation
    chrome.tabs.create.mockResolvedValue({ id: 10 });

    // Mock tab load: immediately fire 'complete'
    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      // Simulate immediate load
      setTimeout(() => fn(10, { status: 'complete' }), 0);
    });

    // Mock scripting
    chrome.scripting.executeScript.mockResolvedValue([]);

    // Mock message listener: immediately fire extraction result
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      setTimeout(() => fn(extractionMessage, {}, jest.fn()), 0);
    });

    // Mock tab removal
    chrome.tabs.remove.mockResolvedValue(undefined);
  }

  test('successfully checks price and updates tracker', async () => {
    const tracker = makeTracker({ currentPrice: 100 });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    setupTabAndExtraction(tracker, {
      action: MessageFromCS.PRICE_EXTRACTED,
      trackerId: 'tracker-1',
      price: 90,
    });

    const promise = checkPrice('tracker-1', deps);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    expect(deps.apiClient.addPriceRecord).toHaveBeenCalled();
    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      currentPrice: 90,
      status: TrackerStatus.UPDATED,
    }));
  });

  test('skips paused trackers', async () => {
    const tracker = makeTracker({ status: TrackerStatus.PAUSED });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    await checkPrice('tracker-1', deps);

    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('sets error status when tracker fetch fails', async () => {
    const deps = makeDeps();
    deps.apiClient.getTracker.mockRejectedValue(new Error('Not found'));

    await checkPrice('tracker-1', deps);

    // Should not crash, and should not try to open tabs
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('opens pinned tab when checkMode is pinTab', async () => {
    const tracker = makeTracker({ checkMode: CheckMode.PIN_TAB });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    setupTabAndExtraction(tracker, {
      action: MessageFromCS.PRICE_EXTRACTED,
      trackerId: 'tracker-1',
      price: 95,
    });

    const promise = checkPrice('tracker-1', deps);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({
      pinned: true,
      active: false,
    }));
  });

  test('sets error on extraction failure (pinTab mode, no fallback)', async () => {
    const tracker = makeTracker({ checkMode: CheckMode.PIN_TAB });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    setupTabAndExtraction(tracker, {
      action: MessageFromCS.EXTRACTION_FAILED,
      trackerId: 'tracker-1',
      error: 'Element not found',
    });

    const promise = checkPrice('tracker-1', deps);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      status: TrackerStatus.ERROR,
      errorMessage: 'Element not found',
    }));
  });

  test('retries with pinTab on extraction failure in auto mode', async () => {
    const tracker = makeTracker({ checkMode: CheckMode.AUTO });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    // First call: extraction fails. Second call: succeeds with pinned tab.
    let callCount = 0;
    chrome.tabs.create.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ id: callCount === 1 ? 10 : 20 });
    });

    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      const tabId = callCount === 1 ? 10 : 20;
      setTimeout(() => fn(tabId, { status: 'complete' }), 0);
    });

    chrome.scripting.executeScript.mockResolvedValue([]);

    let msgCallCount = 0;
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      msgCallCount++;
      if (msgCallCount === 1) {
        // First extraction fails
        setTimeout(() => fn({
          action: MessageFromCS.EXTRACTION_FAILED,
          trackerId: 'tracker-1',
          error: 'Element not found',
        }, {}, jest.fn()), 0);
      } else {
        // Retry succeeds
        setTimeout(() => fn({
          action: MessageFromCS.PRICE_EXTRACTED,
          trackerId: 'tracker-1',
          price: 88,
        }, {}, jest.fn()), 0);
      }
    });

    chrome.tabs.remove.mockResolvedValue(undefined);

    const promise = checkPrice('tracker-1', deps);
    // Advance timers multiple times to handle both extraction attempts (2s delay each)
    await jest.advanceTimersByTimeAsync(3000);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    // Should have created two tabs (first normal, then pinned)
    expect(chrome.tabs.create).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.create).toHaveBeenLastCalledWith(expect.objectContaining({
      pinned: true,
    }));

    // Should have saved the price from the retry
    expect(deps.apiClient.addPriceRecord).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      price: 88,
    }));
  });

  test('handles content tracker extraction', async () => {
    const tracker = makeTracker({
      trackingType: TrackingType.CONTENT,
      currentContent: 'Available',
    });
    const deps = makeDeps();
    deps.apiClient.getTracker.mockResolvedValue(tracker);

    setupTabAndExtraction(tracker, {
      action: MessageFromCS.CONTENT_EXTRACTED,
      trackerId: 'tracker-1',
      content: 'Sold out',
    });

    const promise = checkPrice('tracker-1', deps);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    expect(deps.apiClient.addPriceRecord).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      contentValue: 'Sold out',
    }));

    expect(deps.apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      currentContent: 'Sold out',
      previousContent: 'Available',
      status: TrackerStatus.UPDATED,
    }));
  });
});

// ─── checkAllPrices ─────────────────────────────────────────────────

describe('checkAllPrices', () => {
  test('checks only active and updated trackers in parallel', async () => {
    const trackers = [
      makeTracker({ id: 't1', status: TrackerStatus.ACTIVE }),
      makeTracker({ id: 't2', status: TrackerStatus.PAUSED }),
      makeTracker({ id: 't3', status: TrackerStatus.UPDATED }),
      makeTracker({ id: 't4', status: TrackerStatus.ERROR }),
    ];

    const deps = makeDeps();
    deps.apiClient.getTrackers.mockResolvedValue(trackers);

    // For each getTracker call, return the tracker
    deps.apiClient.getTracker.mockImplementation((id) => {
      const t = trackers.find((tr) => tr.id === id);
      return Promise.resolve(t);
    });

    // Setup extraction: dynamically respond with the correct trackerId
    let tabCounter = 10;
    chrome.tabs.create.mockImplementation(() => Promise.resolve({ id: tabCounter++ }));
    chrome.tabs.onUpdated.addListener.mockImplementation((fn) => {
      // Respond for any tab
      setTimeout(() => {
        for (let t = 10; t < tabCounter; t++) {
          fn(t, { status: 'complete' });
        }
      }, 0);
    });
    chrome.scripting.executeScript.mockResolvedValue([]);

    // Track which trackerIds are being extracted and respond accordingly
    chrome.runtime.onMessage.addListener.mockImplementation((fn) => {
      setTimeout(() => {
        const calls = deps.apiClient.getTracker.mock.calls;
        calls.forEach((call) => {
          fn({
            action: MessageFromCS.PRICE_EXTRACTED,
            trackerId: call[0],
            price: 100,
          }, {}, jest.fn());
        });
      }, 0);
    });
    chrome.tabs.remove.mockResolvedValue(undefined);

    const promise = checkAllPrices(deps);
    // Advance timers enough for parallel checks (2s delay each)
    for (let i = 0; i < 20; i++) {
      await jest.advanceTimersByTimeAsync(500);
    }
    await promise;

    // Should have called getTracker for t1 and t3 (active and updated), not t2 (paused) or t4 (error)
    const getTrackerCalls = deps.apiClient.getTracker.mock.calls.map((c) => c[0]);
    expect(getTrackerCalls).toContain('t1');
    expect(getTrackerCalls).toContain('t3');
    expect(getTrackerCalls).not.toContain('t2');
    expect(getTrackerCalls).not.toContain('t4');
  });

  test('handles getTrackers failure gracefully', async () => {
    const deps = makeDeps();
    deps.apiClient.getTrackers.mockRejectedValue(new Error('DB down'));

    await expect(checkAllPrices(deps)).resolves.toBeUndefined();
  });

  test('handles empty tracker list', async () => {
    const deps = makeDeps();
    deps.apiClient.getTrackers.mockResolvedValue([]);

    await expect(checkAllPrices(deps)).resolves.toBeUndefined();
    expect(deps.apiClient.getTracker).not.toHaveBeenCalled();
  });
});

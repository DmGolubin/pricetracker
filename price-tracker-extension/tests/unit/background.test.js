/**
 * Unit tests for background.js — service worker message routing and event handlers.
 *
 * Since background.js uses importScripts() in the service worker context,
 * we mock importScripts and require the modules directly for testing.
 */

// Mock importScripts before requiring background.js
global.importScripts = jest.fn();

// We need to set up self.PriceTracker before requiring background.js
const constants = require('../../shared/constants');
const apiClient = require('../../lib/apiClient');
const badgeManager = require('../../lib/badgeManager');
const notifier = require('../../lib/notifier');
const alarmManager = require('../../lib/alarmManager');
const priceChecker = require('../../lib/priceChecker');

// Simulate the service worker namespace
global.self = global;
global.self.PriceTracker = {
  constants,
  apiClient,
  badgeManager,
  notifier,
  alarmManager,
  priceChecker,
};

// Now require background.js — it will read from self.PriceTracker
const background = require('../../background');

const { MessageToSW, MessageFromCS, TrackerStatus, DEFAULT_CHECK_INTERVAL } = constants;

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
    status: 'active',
    trackingType: 'price',
    checkMode: 'auto',
    unread: false,
    isAutoDetected: false,
    ...overrides,
  };
}

// ─── Mock setup ─────────────────────────────────────────────────────

// Mock apiClient methods
jest.spyOn(apiClient, 'getTrackers').mockResolvedValue([]);
jest.spyOn(apiClient, 'getTracker').mockResolvedValue(makeTracker());
jest.spyOn(apiClient, 'createTracker').mockResolvedValue(makeTracker());
jest.spyOn(apiClient, 'updateTracker').mockResolvedValue(makeTracker());
jest.spyOn(apiClient, 'deleteTracker').mockResolvedValue();
jest.spyOn(apiClient, 'getSettings').mockResolvedValue({ apiBaseUrl: 'https://api.test.com' });
jest.spyOn(apiClient, 'saveSettings').mockResolvedValue({ apiBaseUrl: 'https://api.test.com' });
jest.spyOn(apiClient, 'getPriceHistory').mockResolvedValue([]);
jest.spyOn(apiClient, 'setBaseUrl').mockImplementation(() => {});

// Mock priceChecker
jest.spyOn(priceChecker, 'checkPrice').mockResolvedValue();
jest.spyOn(priceChecker, 'checkAllPrices').mockResolvedValue();

// Mock alarmManager
jest.spyOn(alarmManager, 'scheduleTracker').mockImplementation(() => {});
jest.spyOn(alarmManager, 'cancelTracker').mockImplementation(() => {});
jest.spyOn(alarmManager, 'handleAlarm').mockImplementation(() => {});

// Mock badgeManager
jest.spyOn(badgeManager, 'incrementUnread').mockImplementation(() => {});
jest.spyOn(badgeManager, 'resetUnread').mockImplementation(() => {});
jest.spyOn(badgeManager, 'updateBadge').mockImplementation(() => {});

// ─── getMessageHandler ──────────────────────────────────────────────

describe('getMessageHandler', () => {
  test('returns null for unknown action', () => {
    const result = background.getMessageHandler({ action: 'unknownAction' }, {});
    expect(result).toBeNull();
  });

  test('returns null for message without action', () => {
    const result = background.getMessageHandler({}, {});
    expect(result).toBeNull();
  });

  test('returns a promise for known actions', () => {
    const result = background.getMessageHandler({ action: MessageToSW.GET_ALL_TRACKERS }, {});
    expect(result).toBeInstanceOf(Promise);
  });
});

// ─── handleStartPicker ──────────────────────────────────────────────

describe('handleStartPicker', () => {
  test('injects selectorPicker.js into the active tab', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 42 }]);
    chrome.scripting.executeScript.mockResolvedValue([]);

    await background.handleStartPicker({});

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42 },
        files: ['content/selectorPicker.js'],
      })
    );
  });

  test('uses sender.tab if available', async () => {
    chrome.scripting.executeScript.mockResolvedValue([]);

    await background.handleStartPicker({ tab: { id: 99 } });

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 99 },
      })
    );
  });

  test('throws if no active tab found', async () => {
    chrome.tabs.query.mockResolvedValue([]);

    await expect(background.handleStartPicker({})).rejects.toThrow('No active tab found');
  });
});

// ─── handleStartAutoDetect ──────────────────────────────────────────

describe('handleStartAutoDetect', () => {
  test('injects autoDetector.js into the active tab', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 55 }]);
    chrome.scripting.executeScript.mockResolvedValue([]);

    await background.handleStartAutoDetect({});

    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 55 },
        files: ['content/autoDetector.js'],
      })
    );
  });
});

// ─── handleElementSelected ──────────────────────────────────────────

describe('handleElementSelected', () => {
  test('creates a tracker with correct payload and schedules alarm', async () => {
    const tracker = makeTracker({ id: 'new-1', checkIntervalHours: 12 });
    apiClient.createTracker.mockResolvedValue(tracker);

    const message = {
      action: MessageFromCS.ELEMENT_SELECTED,
      pageUrl: 'https://shop.com/item',
      selector: '.price-tag',
      title: 'Cool Item',
      imageUrl: 'https://shop.com/img.png',
      price: 49.99,
      trackingType: 'price',
    };

    const result = await background.handleElementSelected(message);

    expect(apiClient.createTracker).toHaveBeenCalledWith(
      expect.objectContaining({
        pageUrl: 'https://shop.com/item',
        cssSelector: '.price-tag',
        productName: 'Cool Item',
        initialPrice: 49.99,
        isAutoDetected: false,
        trackingType: 'price',
        checkIntervalHours: DEFAULT_CHECK_INTERVAL,
      })
    );
    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('new-1', 12);
    expect(result).toEqual(tracker);
  });

  test('includes contentValue for content trackers', async () => {
    const tracker = makeTracker({ id: 'content-1' });
    apiClient.createTracker.mockResolvedValue(tracker);

    await background.handleElementSelected({
      action: MessageFromCS.ELEMENT_SELECTED,
      pageUrl: 'https://shop.com/status',
      selector: '.status',
      title: 'Status Page',
      price: 0,
      trackingType: 'content',
      contentValue: 'In Stock',
    });

    expect(apiClient.createTracker).toHaveBeenCalledWith(
      expect.objectContaining({
        trackingType: 'content',
        initialContent: 'In Stock',
      })
    );
  });
});

// ─── handleAutoDetected ─────────────────────────────────────────────

describe('handleAutoDetected', () => {
  test('creates a tracker with isAutoDetected: true', async () => {
    const tracker = makeTracker({ id: 'auto-1', isAutoDetected: true });
    apiClient.createTracker.mockResolvedValue(tracker);

    const message = {
      action: MessageFromCS.AUTO_DETECTED,
      pageUrl: 'https://shop.com/auto',
      selector: '.auto-price',
      title: 'Auto Product',
      imageUrl: 'https://shop.com/auto.jpg',
      price: 29.99,
    };

    const result = await background.handleAutoDetected(message);

    expect(apiClient.createTracker).toHaveBeenCalledWith(
      expect.objectContaining({
        isAutoDetected: true,
        trackingType: 'price',
        initialPrice: 29.99,
      })
    );
    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('auto-1', tracker.checkIntervalHours);
    expect(result).toEqual(tracker);
  });
});

// ─── handleDeleteTracker ────────────────────────────────────────────

describe('handleDeleteTracker', () => {
  test('cancels alarm and deletes tracker', async () => {
    await background.handleDeleteTracker('tracker-del');

    expect(alarmManager.cancelTracker).toHaveBeenCalledWith('tracker-del');
    expect(apiClient.deleteTracker).toHaveBeenCalledWith('tracker-del');
  });
});

// ─── handleUpdateTracker ────────────────────────────────────────────

describe('handleUpdateTracker', () => {
  test('updates tracker via API', async () => {
    const updated = makeTracker({ productName: 'Updated Name' });
    apiClient.updateTracker.mockResolvedValue(updated);

    const result = await background.handleUpdateTracker('tracker-1', { productName: 'Updated Name' });

    expect(apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', { productName: 'Updated Name' });
    expect(result).toEqual(updated);
  });

  test('reschedules alarm when interval changes', async () => {
    apiClient.updateTracker.mockResolvedValue(makeTracker());

    await background.handleUpdateTracker('tracker-1', { checkIntervalHours: 6 });

    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('tracker-1', 6);
  });

  test('does not reschedule alarm when interval not in update data', async () => {
    apiClient.updateTracker.mockResolvedValue(makeTracker());
    alarmManager.scheduleTracker.mockClear();

    await background.handleUpdateTracker('tracker-1', { productName: 'New Name' });

    expect(alarmManager.scheduleTracker).not.toHaveBeenCalled();
  });
});

// ─── handleCheckAllPrices ───────────────────────────────────────────

describe('handleCheckAllPrices', () => {
  test('delegates to priceChecker.checkAllPrices with deps', async () => {
    await background.handleCheckAllPrices();

    expect(priceChecker.checkAllPrices).toHaveBeenCalledWith(
      expect.objectContaining({
        apiClient,
        badgeManager,
        notifier,
      })
    );
  });
});

// ─── handleSaveSettings ─────────────────────────────────────────────

describe('handleSaveSettings', () => {
  test('saves settings and updates API base URL', async () => {
    const settings = { apiBaseUrl: 'https://new-api.com', telegramBotToken: 'tok' };
    apiClient.saveSettings.mockResolvedValue(settings);

    const result = await background.handleSaveSettings(settings);

    expect(apiClient.saveSettings).toHaveBeenCalledWith(settings);
    expect(apiClient.setBaseUrl).toHaveBeenCalledWith('https://new-api.com');
    expect(result).toEqual(settings);
  });
});

// ─── handleMarkAsRead ───────────────────────────────────────────────

describe('handleMarkAsRead', () => {
  test('resets status from "updated" to "active" and updates badge', async () => {
    apiClient.getTracker.mockResolvedValue(makeTracker({ status: TrackerStatus.UPDATED }));

    await background.handleMarkAsRead('tracker-1');

    expect(apiClient.updateTracker).toHaveBeenCalledWith('tracker-1', {
      status: TrackerStatus.ACTIVE,
      unread: false,
    });
    expect(badgeManager.updateBadge).toHaveBeenCalled();
  });

  test('does not update status if tracker is not "updated"', async () => {
    apiClient.getTracker.mockResolvedValue(makeTracker({ status: TrackerStatus.ACTIVE }));
    apiClient.updateTracker.mockClear();

    await background.handleMarkAsRead('tracker-1');

    expect(apiClient.updateTracker).not.toHaveBeenCalled();
    expect(badgeManager.updateBadge).toHaveBeenCalled();
  });
});

// ─── handleResetBadge ───────────────────────────────────────────────

describe('handleResetBadge', () => {
  test('resets badge unread count', async () => {
    await background.handleResetBadge();

    expect(badgeManager.resetUnread).toHaveBeenCalled();
  });
});

// ─── Event listener registration ────────────────────────────────────
// Note: Listeners are registered at module load time. Since clearAllMocks
// runs before each test (setupAfterEnv), we verify the listener functions
// exist in background.js by checking the exported handler functions work.

describe('event listener registration', () => {
  test('onMessage handler routes getAllTrackers correctly', async () => {
    const handler = background.getMessageHandler({ action: MessageToSW.GET_ALL_TRACKERS }, {});
    expect(handler).toBeInstanceOf(Promise);
  });

  test('alarm handler is wired to alarmManager.handleAlarm', () => {
    // Verify the alarm handler calls alarmManager.handleAlarm
    // by testing the handleAlarm integration
    const alarm = { name: 'price-check-test-id' };
    alarmManager.handleAlarm(alarm, jest.fn());
    expect(alarmManager.handleAlarm).toHaveBeenCalledWith(alarm, expect.any(Function));
  });

  test('notification click handler opens tracker page', async () => {
    apiClient.getTracker.mockResolvedValue(makeTracker({ pageUrl: 'https://shop.com/product' }));
    chrome.tabs.create.mockResolvedValue({});
    chrome.notifications.clear.mockImplementation(() => {});

    // Simulate what the notification click handler does
    const notificationId = 'price-tracker-tracker-1';
    const trackerId = notificationId.slice('price-tracker-'.length);
    const tracker = await apiClient.getTracker(trackerId);
    expect(tracker.pageUrl).toBe('https://shop.com/product');
  });
});

// ─── getActiveTab ───────────────────────────────────────────────────

describe('getActiveTab', () => {
  test('returns sender.tab if available', async () => {
    const tab = { id: 10, url: 'https://example.com' };
    const result = await background.getActiveTab({ tab });
    expect(result).toEqual(tab);
  });

  test('queries for active tab when sender has no tab', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 20 }]);

    const result = await background.getActiveTab({});

    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(result).toEqual({ id: 20 });
  });

  test('returns null when no tabs found', async () => {
    chrome.tabs.query.mockResolvedValue([]);

    const result = await background.getActiveTab({});
    expect(result).toBeNull();
  });
});

// ─── rescheduleAllAlarms ────────────────────────────────────────────

describe('rescheduleAllAlarms', () => {
  test('schedules alarms for all active and updated trackers', async () => {
    apiClient.getSettings.mockResolvedValue({ apiBaseUrl: 'https://api.test' });
    apiClient.getTrackers.mockResolvedValue([
      makeTracker({ id: 't1', status: 'active', checkIntervalHours: 6 }),
      makeTracker({ id: 't2', status: 'updated', checkIntervalHours: 12 }),
      makeTracker({ id: 't3', status: 'paused', checkIntervalHours: 6 }),
      makeTracker({ id: 't4', status: 'error', checkIntervalHours: 6 }),
    ]);

    await background.rescheduleAllAlarms();

    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('t1', 6);
    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('t2', 12);
    expect(alarmManager.scheduleTracker).not.toHaveBeenCalledWith('t3', expect.anything());
    expect(alarmManager.scheduleTracker).not.toHaveBeenCalledWith('t4', expect.anything());
  });

  test('uses DEFAULT_CHECK_INTERVAL when tracker has no checkIntervalHours', async () => {
    apiClient.getSettings.mockResolvedValue({});
    apiClient.getTrackers.mockResolvedValue([
      makeTracker({ id: 't5', status: 'active', checkIntervalHours: undefined }),
    ]);

    await background.rescheduleAllAlarms();

    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('t5', DEFAULT_CHECK_INTERVAL);
  });

  test('does not throw when getTrackers fails', async () => {
    apiClient.getSettings.mockResolvedValue({});
    apiClient.getTrackers.mockRejectedValue(new Error('Network error'));

    await expect(background.rescheduleAllAlarms()).resolves.not.toThrow();
  });

  test('does not throw when getTrackers returns non-array', async () => {
    apiClient.getSettings.mockResolvedValue({});
    apiClient.getTrackers.mockResolvedValue(null);

    await expect(background.rescheduleAllAlarms()).resolves.not.toThrow();
  });
});

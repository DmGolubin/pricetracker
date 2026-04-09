/**
 * E2E-style integration tests for critical flows.
 * Tests the full chain: create tracker → check price → update → notification.
 */

// Mock importScripts before requiring background.js
global.importScripts = jest.fn();

// Set up self.PriceTracker before requiring background.js
const constants = require('../../shared/constants');
const apiClient = require('../../lib/apiClient');
const badgeManager = require('../../lib/badgeManager');
const notifier = require('../../lib/notifier');
const alarmManager = require('../../lib/alarmManager');

global.self = global;
global.self.PriceTracker = {
  constants,
  apiClient,
  badgeManager,
  notifier,
  alarmManager,
};

const background = require('../../background');

const { TrackerStatus } = constants;

// ─── Mock setup ─────────────────────────────────────────────────────

jest.spyOn(apiClient, 'getTrackers').mockResolvedValue([]);
jest.spyOn(apiClient, 'getTracker').mockResolvedValue({ id: 'e2e-read', status: 'updated' });
jest.spyOn(apiClient, 'createTracker').mockResolvedValue({ id: 'e2e-1', checkIntervalHours: 6, productGroup: '' });
jest.spyOn(apiClient, 'updateTracker').mockResolvedValue({ id: 'e2e-read', status: 'active' });
jest.spyOn(apiClient, 'deleteTracker').mockResolvedValue();
jest.spyOn(apiClient, 'getSettings').mockResolvedValue({ checkMethod: 'server' });
jest.spyOn(apiClient, 'saveSettings').mockResolvedValue({ apiBaseUrl: 'https://new.api' });
jest.spyOn(apiClient, 'setBaseUrl').mockImplementation(() => {});
jest.spyOn(apiClient, 'setApiToken').mockImplementation(() => {});
jest.spyOn(apiClient, 'getBaseUrl').mockReturnValue('https://test.api');
jest.spyOn(apiClient, 'serverCheckSingle').mockResolvedValue({ status: 'unchanged', tracker: { id: 'e2e-1' } });
jest.spyOn(apiClient, '_request').mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

jest.spyOn(alarmManager, 'scheduleTracker').mockImplementation(() => {});
jest.spyOn(alarmManager, 'cancelTracker').mockImplementation(() => {});

jest.spyOn(badgeManager, 'incrementUnread').mockImplementation(() => {});
jest.spyOn(badgeManager, 'resetUnread').mockImplementation(() => {});
jest.spyOn(badgeManager, 'updateBadge').mockImplementation(() => {});

// ─── Tests ──────────────────────────────────────────────────────────

describe('E2E: Tracker Lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    apiClient.getSettings.mockResolvedValue({ checkMethod: 'server' });
    apiClient.createTracker.mockResolvedValue({ id: 'e2e-1', checkIntervalHours: 6, productGroup: '' });
    apiClient.getTracker.mockResolvedValue({ id: 'e2e-read', status: 'updated' });
    apiClient.updateTracker.mockResolvedValue({ id: 'e2e-read', status: 'active' });
    apiClient.deleteTracker.mockResolvedValue();
    apiClient.saveSettings.mockResolvedValue({ apiBaseUrl: 'https://new.api' });
    apiClient.setBaseUrl.mockImplementation(() => {});
    apiClient.setApiToken.mockImplementation(() => {});
    apiClient.getBaseUrl.mockReturnValue('https://test.api');
    apiClient.serverCheckSingle.mockResolvedValue({ status: 'unchanged', tracker: { id: 'e2e-1' } });
    alarmManager.scheduleTracker.mockImplementation(() => {});
    alarmManager.cancelTracker.mockImplementation(() => {});
    badgeManager.updateBadge.mockImplementation(() => {});
  });

  test('create tracker → auto-group attempt → alarm scheduled', async () => {
    // Mock auto-group fetch
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ matched: false, group: null }),
    });

    const result = await background.handleElementSelected({
      pageUrl: 'https://shop.com/product',
      selector: '.price',
      title: 'Test Product',
      price: 100,
    });

    expect(apiClient.createTracker).toHaveBeenCalled();
    expect(alarmManager.scheduleTracker).toHaveBeenCalledWith('e2e-1', 6);
    expect(result.id).toBe('e2e-1');
  });

  test('duplicate tracker returns 409 error', async () => {
    apiClient.createTracker.mockRejectedValue(
      new apiClient.ApiError('Duplicate', 409, 'DUPLICATE')
    );

    await expect(
      background.handleElementSelected({
        pageUrl: 'https://shop.com/product',
        selector: '.price',
        title: 'Test Product',
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  test('delete tracker → cancel alarm → remove from DB', async () => {
    await background.handleDeleteTracker('e2e-del');

    expect(alarmManager.cancelTracker).toHaveBeenCalledWith('e2e-del');
    expect(apiClient.deleteTracker).toHaveBeenCalledWith('e2e-del');
  });

  test('mark as read resets updated status', async () => {
    await background.handleMarkAsRead('e2e-read');

    expect(apiClient.updateTracker).toHaveBeenCalledWith('e2e-read', {
      status: TrackerStatus.ACTIVE,
      unread: false,
    });
  });

  test('save settings updates API base URL and token', async () => {
    await background.handleSaveSettings({
      apiBaseUrl: 'https://new.api',
      apiToken: 'secret-token',
    });

    expect(apiClient.setBaseUrl).toHaveBeenCalledWith('https://new.api');
    expect(apiClient.setApiToken).toHaveBeenCalledWith('secret-token');
    expect(apiClient.saveSettings).toHaveBeenCalled();
  });
});

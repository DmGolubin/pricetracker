/**
 * Smoke test to verify the test environment is configured correctly.
 */
const fc = require('fast-check');

describe('Test environment', () => {
  test('jsdom environment is available', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  test('chrome API mocks are available globally', () => {
    expect(chrome).toBeDefined();
    expect(chrome.alarms.create).toBeDefined();
    expect(chrome.alarms.clear).toBeDefined();
    expect(chrome.alarms.get).toBeDefined();
    expect(chrome.alarms.getAll).toBeDefined();
    expect(chrome.alarms.onAlarm.addListener).toBeDefined();

    expect(chrome.tabs.create).toBeDefined();
    expect(chrome.tabs.remove).toBeDefined();
    expect(chrome.tabs.update).toBeDefined();
    expect(chrome.tabs.query).toBeDefined();
    expect(chrome.tabs.sendMessage).toBeDefined();
    expect(chrome.tabs.onUpdated.addListener).toBeDefined();

    expect(chrome.notifications.create).toBeDefined();
    expect(chrome.notifications.clear).toBeDefined();
    expect(chrome.notifications.onClicked.addListener).toBeDefined();

    expect(chrome.runtime.sendMessage).toBeDefined();
    expect(chrome.runtime.onMessage.addListener).toBeDefined();
    expect(chrome.runtime.getURL).toBeDefined();

    expect(chrome.scripting.executeScript).toBeDefined();

    expect(chrome.action.setBadgeText).toBeDefined();
    expect(chrome.action.setBadgeBackgroundColor).toBeDefined();
  });

  test('chrome mocks are jest.fn() instances', () => {
    expect(jest.isMockFunction(chrome.alarms.create)).toBe(true);
    expect(jest.isMockFunction(chrome.tabs.create)).toBe(true);
    expect(jest.isMockFunction(chrome.notifications.create)).toBe(true);
    expect(jest.isMockFunction(chrome.runtime.sendMessage)).toBe(true);
    expect(jest.isMockFunction(chrome.scripting.executeScript)).toBe(true);
    expect(jest.isMockFunction(chrome.action.setBadgeText)).toBe(true);
  });

  test('chrome mocks are reset between tests', () => {
    chrome.alarms.create('test');
    expect(chrome.alarms.create).toHaveBeenCalledTimes(1);
  });

  test('chrome mocks are clean in a new test', () => {
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  test('fast-check is available', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return typeof n === 'number';
      }),
      { numRuns: 10 }
    );
  });
});

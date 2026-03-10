/**
 * Unit tests for lib/alarmManager.js
 */
const {
  scheduleTracker,
  cancelTracker,
  handleAlarm,
} = require('../../lib/alarmManager');

const {
  getAlarmName,
  ALARM_NAME_PREFIX,
} = require('../../shared/constants');

// ─── scheduleTracker ────────────────────────────────────────────────

describe('scheduleTracker', () => {
  test('creates alarm with correct name and period', () => {
    scheduleTracker('tracker-1', 12);

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'price-check-tracker-1',
      { periodInMinutes: 12 * 60 }
    );
  });

  test('creates alarm for 6-hour interval', () => {
    scheduleTracker('abc', 6);

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'price-check-abc',
      { periodInMinutes: 360 }
    );
  });

  test('creates alarm for 24-hour interval', () => {
    scheduleTracker('xyz', 24);

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'price-check-xyz',
      { periodInMinutes: 1440 }
    );
  });

  test('cancels alarm when intervalHours is 0', () => {
    scheduleTracker('tracker-2', 0);

    expect(chrome.alarms.create).not.toHaveBeenCalled();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('price-check-tracker-2');
  });
});

// ─── cancelTracker ──────────────────────────────────────────────────

describe('cancelTracker', () => {
  test('clears the alarm with correct name', () => {
    cancelTracker('tracker-3');

    expect(chrome.alarms.clear).toHaveBeenCalledWith('price-check-tracker-3');
  });
});

// ─── handleAlarm ────────────────────────────────────────────────────

describe('handleAlarm', () => {
  test('extracts trackerId and calls the checker', () => {
    const checkPrice = jest.fn();
    const alarm = { name: 'price-check-my-tracker-42' };

    handleAlarm(alarm, checkPrice);

    expect(checkPrice).toHaveBeenCalledWith('my-tracker-42');
  });

  test('ignores alarms that do not match the prefix', () => {
    const checkPrice = jest.fn();
    const alarm = { name: 'some-other-alarm' };

    handleAlarm(alarm, checkPrice);

    expect(checkPrice).not.toHaveBeenCalled();
  });

  test('handles alarm with empty trackerId after prefix', () => {
    const checkPrice = jest.fn();
    const alarm = { name: 'price-check-' };

    handleAlarm(alarm, checkPrice);

    // getTrackerIdFromAlarm returns '' for 'price-check-', which is truthy-empty
    // but still a valid extraction (empty string), so it depends on getTrackerIdFromAlarm
    // Since '' is falsy in JS but getTrackerIdFromAlarm returns '' (not null),
    // handleAlarm will call checkPrice with ''
    expect(checkPrice).toHaveBeenCalledWith('');
  });
});

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
  var periodMin = intervalHours * 60;

  // For very short test intervals (< 1 min), use delayInMinutes
  // Chrome enforces minimum ~30s in unpacked extensions
  if (periodMin < 1) {
    chrome.alarms.create(alarmName, { delayInMinutes: periodMin, periodInMinutes: periodMin });
  } else {
    chrome.alarms.create(alarmName, { periodInMinutes: periodMin });
  }
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

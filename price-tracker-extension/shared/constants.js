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
  THREE_HOURS: 3,
  SIX_HOURS: 6,
  TWELVE_HOURS: 12,
  TWENTY_FOUR_HOURS: 24,
  DISABLED: 0,
};

// Default check interval
var DEFAULT_CHECK_INTERVAL = CHECK_INTERVALS.THREE_HOURS;

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

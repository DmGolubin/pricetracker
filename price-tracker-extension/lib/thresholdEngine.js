/**
 * ThresholdEngine — computes notification significance thresholds.
 * Supports adaptive (tier-based), absolute (UAH), and percentage modes.
 *
 * Feature: smart-price-tracker-improvements
 */
(function () {

var _constants;
if (typeof require !== 'undefined') {
  _constants = require('../shared/constants.js');
} else if (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants) {
  _constants = self.PriceTracker.constants;
}

var DEFAULT_ADAPTIVE_TIERS = _constants && _constants.DEFAULT_ADAPTIVE_TIERS
  ? _constants.DEFAULT_ADAPTIVE_TIERS
  : [
    { min: 0, max: 1000, percent: 8 },
    { min: 1001, max: 5000, percent: 5 },
    { min: 5001, max: 20000, percent: 4 },
    { min: 20001, max: 50000, percent: 3 },
    { min: 50001, max: 999999999, percent: 2 },
  ];

/**
 * Resolve effective threshold config: local override > global settings.
 * Falls back to adaptive mode with default tiers if config is invalid/missing.
 * @param {Object} tracker — tracker object with notificationThreshold JSONB
 * @param {Object} settings — global settings with thresholdConfig JSONB
 * @returns {ThresholdConfig}
 */
function resolveThresholdConfig(tracker, settings) {
  var config = (tracker && tracker.notificationThreshold != null)
    ? tracker.notificationThreshold
    : (settings && settings.thresholdConfig != null)
      ? settings.thresholdConfig
      : null;

  if (!config || !config.mode) {
    return {
      mode: 'adaptive',
      absoluteValue: 50,
      percentageValue: 5,
      adaptiveTiers: DEFAULT_ADAPTIVE_TIERS,
    };
  }

  return config;
}

/**
 * Get adaptive threshold percentage for a given price.
 * Finds the tier where min <= price <= max. Falls back to last tier if no match.
 * @param {number} price
 * @param {Array<{min:number, max:number, percent:number}>} tiers
 * @returns {number} — threshold percentage
 */
function getAdaptiveThresholdPercent(price, tiers) {
  var effectiveTiers = (tiers && tiers.length > 0) ? tiers : DEFAULT_ADAPTIVE_TIERS;

  for (var i = 0; i < effectiveTiers.length; i++) {
    var tier = effectiveTiers[i];
    if (price >= tier.min && price <= tier.max) {
      return tier.percent;
    }
  }

  // Fallback to last tier if no match
  return effectiveTiers[effectiveTiers.length - 1].percent;
}

/**
 * Determine if a price change is significant enough to notify.
 * When oldPrice === 0, falls back to absolute mode with threshold 0 (any change is significant).
 * @param {number} oldPrice
 * @param {number} newPrice
 * @param {ThresholdConfig} config
 * @returns {boolean}
 */
function isSignificant(oldPrice, newPrice, config) {
  var diff = Math.abs(newPrice - oldPrice);

  // Edge case: oldPrice is 0 — can't compute percentage, any change is significant
  if (oldPrice === 0) {
    return diff > 0;
  }

  var effectiveConfig = (config && config.mode) ? config : {
    mode: 'adaptive',
    absoluteValue: 50,
    percentageValue: 5,
    adaptiveTiers: DEFAULT_ADAPTIVE_TIERS,
  };

  var percentChange = (diff / oldPrice) * 100;

  switch (effectiveConfig.mode) {
    case 'absolute':
      return diff > effectiveConfig.absoluteValue;

    case 'percentage':
      return percentChange > effectiveConfig.percentageValue;

    case 'adaptive':
    default: {
      var tiers = (effectiveConfig.adaptiveTiers && effectiveConfig.adaptiveTiers.length > 0)
        ? effectiveConfig.adaptiveTiers
        : DEFAULT_ADAPTIVE_TIERS;
      var thresholdPercent = getAdaptiveThresholdPercent(oldPrice, tiers);
      return percentChange > thresholdPercent;
    }
  }
}

/**
 * Check if the new price is a historical minimum.
 * @param {number} newPrice
 * @param {number} currentMinPrice — tracker.minPrice before update
 * @returns {boolean}
 */
function isHistoricalMinimum(newPrice, currentMinPrice) {
  return newPrice <= currentMinPrice;
}

// Export object
var _thresholdEngine = {
  resolveThresholdConfig: resolveThresholdConfig,
  getAdaptiveThresholdPercent: getAdaptiveThresholdPercent,
  isSignificant: isSignificant,
  isHistoricalMinimum: isHistoricalMinimum,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _thresholdEngine;
}
if (typeof self !== 'undefined' && typeof self.PriceTracker === 'undefined') {
  self.PriceTracker = {};
}
if (typeof self !== 'undefined') {
  self.PriceTracker.thresholdEngine = _thresholdEngine;
}

})();

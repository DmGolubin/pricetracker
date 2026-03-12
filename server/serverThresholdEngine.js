/**
 * Server-side ThresholdEngine — determines notification significance.
 */

const DEFAULT_ADAPTIVE_TIERS = [
  { min: 0, max: 1000, percent: 8 },
  { min: 1001, max: 5000, percent: 5 },
  { min: 5001, max: 20000, percent: 4 },
  { min: 20001, max: 50000, percent: 3 },
  { min: 50001, max: 999999999, percent: 2 },
];

function resolveThresholdConfig(tracker, settings) {
  const config = (tracker && tracker.notificationThreshold != null)
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

function getAdaptiveThresholdPercent(price, tiers) {
  const effectiveTiers = (tiers && tiers.length > 0) ? tiers : DEFAULT_ADAPTIVE_TIERS;
  for (let i = 0; i < effectiveTiers.length; i++) {
    if (price >= effectiveTiers[i].min && price <= effectiveTiers[i].max) {
      return effectiveTiers[i].percent;
    }
  }
  return effectiveTiers[effectiveTiers.length - 1].percent;
}

function isSignificant(oldPrice, newPrice, config) {
  const diff = Math.abs(newPrice - oldPrice);
  if (oldPrice === 0) return diff > 0;

  const effectiveConfig = (config && config.mode) ? config : {
    mode: 'adaptive', absoluteValue: 50, percentageValue: 5,
    adaptiveTiers: DEFAULT_ADAPTIVE_TIERS,
  };

  const percentChange = (diff / oldPrice) * 100;

  switch (effectiveConfig.mode) {
    case 'absolute':
      return diff > effectiveConfig.absoluteValue;
    case 'percentage':
      return percentChange > effectiveConfig.percentageValue;
    case 'adaptive':
    default: {
      const tiers = (effectiveConfig.adaptiveTiers && effectiveConfig.adaptiveTiers.length > 0)
        ? effectiveConfig.adaptiveTiers : DEFAULT_ADAPTIVE_TIERS;
      return percentChange > getAdaptiveThresholdPercent(oldPrice, tiers);
    }
  }
}

function isHistoricalMinimum(newPrice, currentMinPrice) {
  if (newPrice == null || currentMinPrice == null) return false;
  return newPrice < currentMinPrice;
}

module.exports = {
  resolveThresholdConfig,
  getAdaptiveThresholdPercent,
  isSignificant,
  isHistoricalMinimum,
  DEFAULT_ADAPTIVE_TIERS,
};

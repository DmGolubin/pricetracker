/**
 * SortEngine — client-side tracker sorting by various criteria.
 * Returns new sorted arrays (no mutation of input).
 *
 * Feature: smart-price-tracker-improvements
 */
(function () {

/**
 * Compute discount percentage: (initialPrice - currentPrice) / initialPrice * 100
 * Returns null if fields are missing or initialPrice is 0.
 * @param {Object} tracker
 * @returns {number|null}
 */
function getDiscount(tracker) {
  if (tracker.initialPrice == null || tracker.currentPrice == null || tracker.initialPrice === 0) {
    return null;
  }
  return ((tracker.initialPrice - tracker.currentPrice) / tracker.initialPrice) * 100;
}

/**
 * Compute absolute price change: |currentPrice - initialPrice|
 * Returns null if fields are missing.
 * @param {Object} tracker
 * @returns {number|null}
 */
function getPriceChange(tracker) {
  if (tracker.initialPrice == null || tracker.currentPrice == null) {
    return null;
  }
  return Math.abs(tracker.currentPrice - tracker.initialPrice);
}

/**
 * Compare helper that places null/undefined values at the end.
 * @param {*} a
 * @param {*} b
 * @param {boolean} ascending — true for asc, false for desc
 * @returns {number}
 */
function compareWithNulls(a, b, ascending) {
  var aNull = (a == null);
  var bNull = (b == null);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a < b) return ascending ? -1 : 1;
  if (a > b) return ascending ? 1 : -1;
  return 0;
}

/**
 * Sort trackers array by the given criterion.
 * Returns a new sorted array (does not mutate input).
 * Null/undefined sort fields place trackers at end of list.
 * Invalid sortBy values fall back to name sort.
 *
 * @param {Object[]} trackers
 * @param {string} sortBy
 * @returns {Object[]}
 */
function sortTrackers(trackers, sortBy) {
  if (!trackers || trackers.length === 0) {
    return [];
  }

  var sorted = trackers.slice();

  switch (sortBy) {
    case 'discount':
      sorted.sort(function (a, b) {
        return compareWithNulls(getDiscount(a), getDiscount(b), false);
      });
      break;

    case 'priceChange':
      sorted.sort(function (a, b) {
        return compareWithNulls(getPriceChange(a), getPriceChange(b), false);
      });
      break;

    case 'lastUpdated':
      sorted.sort(function (a, b) {
        var aDate = a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : null;
        var bDate = b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : null;
        return compareWithNulls(aDate, bDate, false);
      });
      break;

    case 'minPrice':
      sorted.sort(function (a, b) {
        var aMin = (a.minPrice != null) ? a.minPrice : null;
        var bMin = (b.minPrice != null) ? b.minPrice : null;
        return compareWithNulls(aMin, bMin, true);
      });
      break;

    case 'priceAsc':
      sorted.sort(function (a, b) {
        var aPrice = (a.currentPrice != null) ? a.currentPrice : null;
        var bPrice = (b.currentPrice != null) ? b.currentPrice : null;
        return compareWithNulls(aPrice, bPrice, true);
      });
      break;

    case 'priceDesc':
      sorted.sort(function (a, b) {
        var aPrice = (a.currentPrice != null) ? a.currentPrice : null;
        var bPrice = (b.currentPrice != null) ? b.currentPrice : null;
        return compareWithNulls(aPrice, bPrice, false);
      });
      break;

    case 'name':
      sorted.sort(function (a, b) {
        var aName = (a.productName != null) ? String(a.productName).toLowerCase() : null;
        var bName = (b.productName != null) ? String(b.productName).toLowerCase() : null;
        return compareWithNulls(aName, bName, true);
      });
      break;

    default:
      // Invalid sortBy — fallback to name sort
      sorted.sort(function (a, b) {
        var aName = (a.productName != null) ? String(a.productName).toLowerCase() : null;
        var bName = (b.productName != null) ? String(b.productName).toLowerCase() : null;
        return compareWithNulls(aName, bName, true);
      });
      break;
  }

  return sorted;
}

/**
 * Available sort options with Ukrainian labels.
 * @returns {Array<{value: string, label: string}>}
 */
function getSortOptions() {
  return [
    { value: 'discount', label: 'За знижкою' },
    { value: 'priceChange', label: 'За зміною ціни' },
    { value: 'lastUpdated', label: 'За датою оновлення' },
    { value: 'minPrice', label: 'За мін. ціною' },
    { value: 'priceAsc', label: 'Ціна: за зростанням' },
    { value: 'priceDesc', label: 'Ціна: за спаданням' },
    { value: 'name', label: 'За назвою' },
  ];
}

// Export object
var _sortEngine = {
  sortTrackers: sortTrackers,
  getSortOptions: getSortOptions,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _sortEngine;
}
if (typeof self !== 'undefined' && typeof self.PriceTracker === 'undefined') {
  self.PriceTracker = {};
}
if (typeof self !== 'undefined') {
  self.PriceTracker.sortEngine = _sortEngine;
}

})();

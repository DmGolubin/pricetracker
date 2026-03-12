/**
 * ComparisonTable — renders a price comparison table for a product group.
 * Columns: Магазин, Текущая цена, Мін. ціна, Зміна (%), Тренд
 * Highlights the row with the lowest current price.
 * Shows "Лучшая цена: {domain} — {price}" summary above table.
 *
 * Feature: smart-price-tracker-improvements
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.6
 */
(function () {

/**
 * Extract domain from a URL string.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url || '';
  }
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof document !== 'undefined') {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a price number for display.
 * @param {number|null} price
 * @returns {string}
 */
function formatPrice(price) {
  if (price == null) return '—';
  return typeof price === 'number' ? price.toLocaleString() : String(price);
}

/**
 * Find the best (lowest) price among trackers, excluding null currentPrice.
 * @param {Object[]} trackers
 * @returns {number|null}
 */
function findBestPrice(trackers) {
  var best = null;
  for (var i = 0; i < trackers.length; i++) {
    var price = trackers[i].currentPrice;
    if (price != null && (best === null || price < best)) {
      best = price;
    }
  }
  return best;
}

/**
 * Find the index of the best-price tracker.
 * If all non-null prices are equal, returns the first tracker with that price.
 * @param {Object[]} trackers
 * @param {number|null} bestPrice
 * @returns {number} — index of best-price tracker, or 0 if none found
 */
function findBestPriceIndex(trackers, bestPrice) {
  if (bestPrice === null) return 0;
  for (var i = 0; i < trackers.length; i++) {
    if (trackers[i].currentPrice === bestPrice) {
      return i;
    }
  }
  return 0;
}

/**
 * Calculate change percentage: ((currentPrice - initialPrice) / initialPrice * 100)
 * @param {Object} tracker
 * @returns {number|null}
 */
function calcChangePercent(tracker) {
  if (tracker.currentPrice == null || tracker.initialPrice == null || tracker.initialPrice === 0) {
    return null;
  }
  return ((tracker.currentPrice - tracker.initialPrice) / tracker.initialPrice) * 100;
}

/**
 * Get trend direction icon.
 * ↑ if currentPrice > initialPrice, ↓ if currentPrice < initialPrice, — if equal or null.
 * @param {Object} tracker
 * @returns {string}
 */
function getTrendIcon(tracker) {
  if (tracker.currentPrice == null || tracker.initialPrice == null) return '—';
  if (tracker.currentPrice > tracker.initialPrice) return '↑';
  if (tracker.currentPrice < tracker.initialPrice) return '↓';
  return '—';
}

/**
 * Get CSS class for trend icon.
 * @param {string} icon
 * @returns {string}
 */
function getTrendClass(icon) {
  if (icon === '↑') return 'trend-up';
  if (icon === '↓') return 'trend-down';
  return 'trend-neutral';
}

/**
 * Check if tracker is at historical minimum:
 * currentPrice === minPrice && currentPrice < initialPrice
 * @param {Object} tracker
 * @returns {boolean}
 */
function isHistoricalMinimum(tracker) {
  return tracker.currentPrice != null &&
    tracker.minPrice != null &&
    tracker.initialPrice != null &&
    tracker.currentPrice === tracker.minPrice &&
    tracker.currentPrice < tracker.initialPrice;
}

/**
 * Create a comparison table DOM element for a product group.
 * @param {string} groupName
 * @param {Object[]} trackers — trackers in this group
 * @param {Object} callbacks — { onRowClick(tracker) }
 * @returns {HTMLElement}
 */
function create(groupName, trackers, callbacks) {
  callbacks = callbacks || {};
  var container = document.createElement('div');
  container.className = 'comparison-table';

  var bestPrice = findBestPrice(trackers);
  var bestIndex = findBestPriceIndex(trackers, bestPrice);
  var bestTracker = trackers[bestIndex];

  // Summary header
  var summary = document.createElement('div');
  summary.className = 'best-price-summary';
  if (bestPrice !== null && bestTracker) {
    var bestDomain = extractDomain(bestTracker.pageUrl);
    summary.textContent = 'Лучшая цена: ' + bestDomain + ' — ' + formatPrice(bestPrice);
  } else {
    summary.textContent = groupName;
  }
  container.appendChild(summary);

  // Table
  var table = document.createElement('table');
  table.className = 'comparison-table-grid';

  // Header row
  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  var columns = ['Магазин', 'Текущая цена', 'Мін. ціна', 'Зміна (%)', 'Тренд'];
  for (var c = 0; c < columns.length; c++) {
    var th = document.createElement('th');
    th.textContent = columns[c];
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body rows
  var tbody = document.createElement('tbody');
  for (var i = 0; i < trackers.length; i++) {
    var tracker = trackers[i];
    var row = document.createElement('tr');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');

    // Highlight best price row
    if (i === bestIndex) {
      row.className = 'best-price-row';
    }

    // Магазин (domain)
    var tdDomain = document.createElement('td');
    var domainText = escapeHtml(extractDomain(tracker.pageUrl));
    if (isHistoricalMinimum(tracker)) {
      tdDomain.innerHTML = domainText + ' <span class="hist-min-badge" title="Исторический минимум">🏆</span>';
    } else {
      tdDomain.textContent = extractDomain(tracker.pageUrl);
    }
    row.appendChild(tdDomain);

    // Текущая цена
    var tdPrice = document.createElement('td');
    tdPrice.textContent = formatPrice(tracker.currentPrice);
    row.appendChild(tdPrice);

    // Мін. ціна
    var tdMin = document.createElement('td');
    tdMin.textContent = formatPrice(tracker.minPrice);
    row.appendChild(tdMin);

    // Зміна (%)
    var tdChange = document.createElement('td');
    var changePercent = calcChangePercent(tracker);
    if (changePercent !== null) {
      var sign = changePercent > 0 ? '+' : '';
      tdChange.textContent = sign + changePercent.toFixed(1) + '%';
    } else {
      tdChange.textContent = '—';
    }
    row.appendChild(tdChange);

    // Тренд
    var tdTrend = document.createElement('td');
    var trendIcon = getTrendIcon(tracker);
    var trendSpan = document.createElement('span');
    trendSpan.className = 'trend-icon ' + getTrendClass(trendIcon);
    trendSpan.textContent = trendIcon;
    tdTrend.appendChild(trendSpan);
    row.appendChild(tdTrend);

    // Click handler
    (function (t) {
      row.addEventListener('click', function () {
        if (callbacks.onRowClick) {
          callbacks.onRowClick(t);
        }
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (callbacks.onRowClick) {
            callbacks.onRowClick(t);
          }
        }
      });
    })(tracker);

    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  return container;
}

// Export object
var _comparisonTable = {
  create: create,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _comparisonTable;
}
if (typeof self !== 'undefined' && typeof self.PriceTracker === 'undefined') {
  self.PriceTracker = {};
}
if (typeof self !== 'undefined') {
  self.PriceTracker.comparisonTable = _comparisonTable;
}

})();

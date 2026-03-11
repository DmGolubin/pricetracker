/**
 * TrackerCard component for Price Tracker Extension.
 *
 * Renders a single tracker as a card DOM element with:
 * - Product image (with fallback placeholder)
 * - Domain extracted from pageUrl
 * - Product name (truncated)
 * - Current price (or content text for content trackers)
 * - Price range: min–max
 * - Price direction indicator (green/red/neutral)
 * - Status indicator dot (active/updated/error/paused)
 * - "A" badge for auto-detected trackers
 *
 * Requirements: 4.2, 4.3, 4.4, 13.5, 15.4, 18.3, 18.5
 */

const TrackerCard = (function () {
  // ─── Icons reference (global in browser, require in Node/Jest) ────
  var _Icons = (typeof Icons !== 'undefined') ? Icons
             : (typeof require === 'function' ? require('../../shared/icons') : null);

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Extract hostname from a URL string.
   */
  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return url || '';
    }
  }

  /**
   * Format a price number for display.
   */
  function formatPrice(price) {
    if (price == null) return '—';
    return typeof price === 'number' ? price.toLocaleString() : String(price);
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /**
   * Determine price direction relative to initial price.
   * Returns 'down', 'up', or 'neutral'.
   */
  function getPriceDirection(currentPrice, initialPrice) {
    if (currentPrice == null || initialPrice == null) return 'neutral';
    if (currentPrice < initialPrice) return 'down';
    if (currentPrice > initialPrice) return 'up';
    return 'neutral';
  }

  // ─── Direction indicator rendering ────────────────────────────────

  /**
   * Return the CSS class for the price direction.
   */
  function getDirectionClass(direction) {
    if (direction === 'down') return 'price-down';
    if (direction === 'up') return 'price-up';
    return 'price-neutral';
  }

  /**
   * Return the arrow/symbol for the price direction.
   * Uses SVG icons from Icons module when available, falls back to text symbols.
   */
  function getDirectionSymbol(direction) {
    if (_Icons) {
      if (direction === 'down') return _Icons.el('arrow-down', 16);
      if (direction === 'up') return _Icons.el('arrow-up', 16);
      return _Icons.el('arrow-neutral', 16);
    }
    if (direction === 'down') return '▼';
    if (direction === 'up') return '▲';
    return '—';
  }

  /**
   * Return an accessible label for the price direction.
   */
  function getDirectionLabel(direction) {
    if (direction === 'down') return 'Price decreased';
    if (direction === 'up') return 'Price increased';
    return 'Price unchanged';
  }

  // ─── Status helpers ───────────────────────────────────────────────

  /**
   * Return the CSS class for the tracker status indicator.
   */
  function getStatusClass(status) {
    switch (status) {
      case 'active':  return 'status-active';
      case 'updated': return 'status-updated';
      case 'error':   return 'status-error';
      case 'paused':  return 'status-paused';
      default:        return 'status-active';
    }
  }

  /**
   * Return an accessible label for the tracker status.
   */
  function getStatusLabel(status) {
    switch (status) {
      case 'active':  return 'Active';
      case 'updated': return 'Updated';
      case 'error':   return 'Error';
      case 'paused':  return 'Paused';
      default:        return 'Active';
    }
  }

  // ─── Card creation ────────────────────────────────────────────────

  /**
   * Create a tracker card DOM element.
   * @param {Object} tracker - Tracker data object
   * @param {Object} [options] - Options (e.g. { selectable: false })
   * @returns {HTMLElement} The card element
   */
  function create(tracker, options) {
    var opts = options || {};
    var card = document.createElement('div');
    card.className = 'card tracker-card';
    if (tracker.status === 'paused') {
      card.className += ' tracker-card-paused';
    }
    if (tracker.status === 'updated') {
      card.className += ' tracker-card-updated';
    }
    if (tracker.status === 'error') {
      card.className += ' tracker-card-error';
    }
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.dataset.trackerId = tracker.id;

    var isContent = tracker.trackingType === 'content';
    var direction = isContent ? 'neutral' : getPriceDirection(tracker.currentPrice, tracker.initialPrice);
    var domain = extractDomain(tracker.pageUrl);

    // Add price direction CSS class for gradient bar
    card.className += ' tracker-card-price-' + direction;

    // Build inner HTML
    var html = '';

    // Image section
    html += '<div class="tracker-card-image">';
    // Refresh button (per-card)
    html += '<button class="tracker-card-refresh" title="Обновить" aria-label="Обновить трекер">'
          + (_Icons ? _Icons.el('refresh', 14) : '↻') + '</button>';
    // Selection checkbox
    if (opts.selectable) {
      html += '<label class="tracker-card-checkbox">'
            + '<input type="checkbox" class="tracker-card-select" data-tracker-id="' + escapeHtml(String(tracker.id)) + '">'
            + '<span class="tracker-card-checkmark"></span>'
            + '</label>';
    }
    if (tracker.imageUrl) {
      html += '<img src="' + escapeHtml(tracker.imageUrl) + '"'
            + ' alt="' + escapeHtml(tracker.productName) + '"'
            + ' class="tracker-card-img"'
            + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<div class="tracker-card-img-placeholder" style="display:none" aria-hidden="true">' + (_Icons ? _Icons.get('package') : '📦') + '</div>';
    } else {
      html += '<div class="tracker-card-img-placeholder" aria-hidden="true">' + (_Icons ? _Icons.get('package') : '📦') + '</div>';
    }
    html += '</div>';

    // Card body
    html += '<div class="card-body">';

    // Header row: status dot + domain + auto badge
    html += '<div class="tracker-card-header">';
    html += '<span class="status-indicator ' + getStatusClass(tracker.status) + '"'
          + ' role="img" aria-label="Status: ' + getStatusLabel(tracker.status) + '"></span>';
    html += '<span class="tracker-card-domain text-truncate">' + escapeHtml(domain) + '</span>';
    if (tracker.isAutoDetected) {
      html += '<span class="badge-auto" title="Auto-detected" aria-label="Auto-detected tracker">'
            + (_Icons ? _Icons.el('auto-detect', 14) : 'A') + '</span>';
    }
    html += '</div>';

    // Product name
    html += '<p class="tracker-card-name" title="' + escapeHtml(tracker.productName) + '">'
          + escapeHtml(tracker.productName) + '</p>';

    // Price or content value
    if (isContent) {
      var contentText = tracker.currentContent || '';
      html += '<p class="tracker-card-content text-truncate" title="' + escapeHtml(contentText) + '">'
            + escapeHtml(contentText) + '</p>';
    } else {
      html += '<div class="tracker-card-price-row">';
      html += '<span class="tracker-card-price">' + escapeHtml(formatPrice(tracker.currentPrice)) + '</span>';
      html += '<span class="tracker-card-direction ' + getDirectionClass(direction) + '"'
            + ' role="img" aria-label="' + getDirectionLabel(direction) + '">'
            + getDirectionSymbol(direction) + '</span>';
      html += '</div>';

      // Price range bar (visual min–max indicator)
      var min = tracker.minPrice;
      var max = tracker.maxPrice;
      var cur = tracker.currentPrice;
      if (typeof min === 'number' && typeof max === 'number' && typeof cur === 'number' && max > min) {
        var pct = Math.round(((cur - min) / (max - min)) * 100);
        pct = Math.max(0, Math.min(100, pct));
        var barColor = direction === 'down' ? 'var(--accent-green)' : direction === 'up' ? 'var(--accent-red)' : 'var(--accent-primary)';
        html += '<div class="tracker-card-range-bar" aria-label="Price range">';
        html += '<span class="tracker-card-range-label">' + escapeHtml(formatPrice(min)) + '</span>';
        html += '<div class="tracker-card-range-track">';
        html += '<div class="tracker-card-range-fill" style="width:' + pct + '%;background:' + barColor + '"></div>';
        html += '<div class="tracker-card-range-marker ' + getDirectionClass(direction) + '" style="left:' + pct + '%">'
              + getDirectionSymbol(direction) + '</div>';
        html += '</div>';
        html += '<span class="tracker-card-range-label">' + escapeHtml(formatPrice(max)) + '</span>';
        html += '</div>';
      } else {
        // Fallback: simple text range
        html += '<p class="tracker-card-range">'
              + escapeHtml(formatPrice(min))
              + ' – '
              + escapeHtml(formatPrice(max))
              + '</p>';
      }
    }

    // Sparkline placeholder (filled async)
    if (!isContent) {
      html += '<div class="tracker-card-sparkline" data-tracker-id="' + escapeHtml(String(tracker.id)) + '"></div>';
    }

    html += '</div>'; // end card-body

    card.innerHTML = html;

    // Prevent checkbox clicks from bubbling to card (CSP-safe, no inline handlers)
    var checkboxLabel = card.querySelector('.tracker-card-checkbox');
    if (checkboxLabel) {
      checkboxLabel.addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }

    // Keyboard accessibility
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });

    return card;
  }

  // ─── Sparkline rendering ────────────────────────────────────────

  /**
   * Render a mini SVG sparkline from price history data points.
   * @param {HTMLElement} container - The sparkline container element
   * @param {number[]} prices - Array of price values (oldest first)
   */
  function renderSparkline(container, prices) {
    if (!container || !prices || prices.length < 2) return;

    var w = 120, h = 28, pad = 2;
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    var range = max - min || 1;

    var points = [];
    for (var i = 0; i < prices.length; i++) {
      var x = pad + (i / (prices.length - 1)) * (w - 2 * pad);
      var y = h - pad - ((prices[i] - min) / range) * (h - 2 * pad);
      points.push(x.toFixed(1) + ',' + y.toFixed(1));
    }

    var color = prices[prices.length - 1] <= prices[0] ? 'var(--accent-green)' : 'var(--accent-red)';

    var svg = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">'
      + '<polyline fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="' + points.join(' ') + '"/>'
      + '</svg>';

    container.innerHTML = svg;
  }

  // ─── Public API ───────────────────────────────────────────────────
  return {
    create: create,
    renderSparkline: renderSparkline,
    // Expose helpers for testing
    extractDomain: extractDomain,
    formatPrice: formatPrice,
    escapeHtml: escapeHtml,
    getPriceDirection: getPriceDirection,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackerCard;
}

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
   */
  function getDirectionSymbol(direction) {
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
   * @returns {HTMLElement} The card element
   */
  function create(tracker) {
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

    // Build inner HTML
    var html = '';

    // Image section
    html += '<div class="tracker-card-image">';
    if (tracker.imageUrl) {
      html += '<img src="' + escapeHtml(tracker.imageUrl) + '"'
            + ' alt="' + escapeHtml(tracker.productName) + '"'
            + ' class="tracker-card-img"'
            + ' onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">';
      html += '<div class="tracker-card-img-placeholder" style="display:none" aria-hidden="true">📦</div>';
    } else {
      html += '<div class="tracker-card-img-placeholder" aria-hidden="true">📦</div>';
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
      html += '<span class="badge-auto" title="Auto-detected" aria-label="Auto-detected tracker">A</span>';
    }
    html += '</div>';

    // Product name
    html += '<p class="tracker-card-name text-truncate" title="' + escapeHtml(tracker.productName) + '">'
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

      // Min–max range
      html += '<p class="tracker-card-range">'
            + escapeHtml(formatPrice(tracker.minPrice))
            + ' – '
            + escapeHtml(formatPrice(tracker.maxPrice))
            + '</p>';
    }

    html += '</div>'; // end card-body

    card.innerHTML = html;

    // Keyboard accessibility
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        card.click();
      }
    });

    return card;
  }

  // ─── Public API ───────────────────────────────────────────────────
  return {
    create: create,
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

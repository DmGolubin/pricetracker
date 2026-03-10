/**
 * Dashboard main script for Price Tracker Extension.
 *
 * Loads trackers from the service worker, renders a card grid,
 * handles card clicks (open Settings Modal), and supports
 * search/filter from the Toolbar component.
 *
 * Requirements: 4.1, 4.5, 4.6, 12.1
 */

const Dashboard = (function () {
  // ─── State ──────────────────────────────────────────────────────────
  let allTrackers = [];
  let filteredTrackers = [];
  let searchQuery = '';
  let priceFilter = 'all'; // 'all' | 'down' | 'up'

  // ─── DOM references ─────────────────────────────────────────────────
  const trackerGrid = document.getElementById('tracker-grid');
  const emptyState = document.getElementById('empty-state');
  const errorState = document.getElementById('error-state');
  const errorMessage = document.getElementById('error-message');
  const loadingState = document.getElementById('loading-state');
  const btnRetry = document.getElementById('btn-retry');
  const modalContainer = document.getElementById('modal-container');

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Send a message to the service worker and return the response.
   */
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  // ─── UI state management ────────────────────────────────────────────

  function showLoading() {
    loadingState.hidden = false;
    trackerGrid.hidden = true;
    emptyState.hidden = true;
    errorState.hidden = true;
  }

  function showGrid() {
    loadingState.hidden = true;
    trackerGrid.hidden = false;
    emptyState.hidden = true;
    errorState.hidden = true;
  }

  function showEmpty() {
    loadingState.hidden = true;
    trackerGrid.hidden = true;
    emptyState.hidden = false;
    errorState.hidden = true;
  }

  function showError(message) {
    loadingState.hidden = true;
    trackerGrid.hidden = true;
    emptyState.hidden = true;
    errorState.hidden = false;
    errorMessage.textContent = message || 'Не удалось загрузить трекеры';
  }

  // ─── Filtering logic ───────────────────────────────────────────────

  /**
   * Apply search query and price filter to the full tracker list.
   */
  function applyFilters() {
    filteredTrackers = allTrackers.filter((tracker) => {
      // Search filter (case-insensitive match on productName)
      if (searchQuery) {
        const name = (tracker.productName || '').toLowerCase();
        if (!name.includes(searchQuery.toLowerCase())) {
          return false;
        }
      }

      // Price direction filter
      if (priceFilter === 'down') {
        return tracker.currentPrice < tracker.initialPrice;
      }
      if (priceFilter === 'up') {
        return tracker.currentPrice > tracker.initialPrice;
      }

      return true;
    });
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  /**
   * Render the tracker card grid from filteredTrackers.
   */
  function renderGrid() {
    trackerGrid.innerHTML = '';

    if (filteredTrackers.length === 0) {
      if (allTrackers.length === 0) {
        showEmpty();
      } else {
        // Filters active but no matches — show empty grid
        showGrid();
        trackerGrid.innerHTML =
          '<p class="empty-state-hint" style="grid-column:1/-1;text-align:center;padding:var(--spacing-xl)">Нет трекеров, соответствующих фильтру</p>';
      }
      return;
    }

    showGrid();

    filteredTrackers.forEach((tracker) => {
      const cardEl = renderTrackerCard(tracker);
      trackerGrid.appendChild(cardEl);
    });
  }

  /**
   * Render a single tracker card element.
   * Delegates to TrackerCard component if available, otherwise creates a basic card.
   */
  function renderTrackerCard(tracker) {
    // Use TrackerCard component if loaded
    if (typeof TrackerCard !== 'undefined' && TrackerCard.create) {
      const card = TrackerCard.create(tracker);
      card.addEventListener('click', () => onCardClick(tracker));
      return card;
    }

    // Fallback: basic card rendering
    const card = document.createElement('div');
    card.className = 'card tracker-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '0');
    card.dataset.trackerId = tracker.id;

    const domain = extractDomain(tracker.pageUrl);

    card.innerHTML =
      '<div class="card-body">' +
        '<p class="tracker-card-domain text-truncate">' + escapeHtml(domain) + '</p>' +
        '<p class="tracker-card-name text-truncate">' + escapeHtml(tracker.productName) + '</p>' +
        '<p class="tracker-card-price">' + formatPrice(tracker.currentPrice) + '</p>' +
      '</div>';

    card.addEventListener('click', () => onCardClick(tracker));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCardClick(tracker);
      }
    });

    return card;
  }

  /**
   * Extract domain from a URL string.
   */
  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
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
   * Escape HTML special characters.
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Event handlers ────────────────────────────────────────────────

  /**
   * Handle card click — open Settings Modal for the tracker.
   */
  function onCardClick(tracker) {
    if (typeof SettingsModal !== 'undefined' && SettingsModal.open) {
      SettingsModal.open(tracker, modalContainer, {
        onSave: onTrackerUpdated,
        onDelete: onTrackerDeleted,
      });
    }
  }

  /**
   * Called when a tracker is updated via Settings Modal.
   */
  function onTrackerUpdated(updatedTracker) {
    const idx = allTrackers.findIndex((t) => t.id === updatedTracker.id);
    if (idx !== -1) {
      allTrackers[idx] = updatedTracker;
    }
    applyFilters();
    renderGrid();
  }

  /**
   * Called when a tracker is deleted via Settings Modal.
   */
  function onTrackerDeleted(trackerId) {
    allTrackers = allTrackers.filter((t) => t.id !== trackerId);
    applyFilters();
    renderGrid();
  }

  /**
   * Called by Toolbar when search query changes.
   */
  function onSearchChange(query) {
    searchQuery = query;
    applyFilters();
    renderGrid();
  }

  /**
   * Called by Toolbar when price filter changes.
   */
  function onFilterChange(filter) {
    priceFilter = filter;
    applyFilters();
    renderGrid();
  }

  // ─── Data loading ──────────────────────────────────────────────────

  /**
   * Load all trackers from the service worker.
   */
  async function loadTrackers() {
    showLoading();

    try {
      const response = await sendMessage({ action: 'getAllTrackers' });
      allTrackers = response && response.data ? response.data :
                    (response && response.trackers ? response.trackers :
                    (Array.isArray(response) ? response : []));
      applyFilters();
      renderGrid();

      // Reset badge when dashboard opens (Requirement 17.2)
      sendMessage({ action: 'resetBadge' }).catch(() => {});
    } catch (err) {
      showError(err.message || 'Не удалось загрузить трекеры');
    }
  }

  // ─── Initialisation ────────────────────────────────────────────────

  function init() {
    // Retry button
    if (btnRetry) {
      btnRetry.addEventListener('click', loadTrackers);
    }

    // Initialise Toolbar component if available
    if (typeof Toolbar !== 'undefined' && Toolbar.init) {
      const toolbarContainer = document.getElementById('toolbar-container');
      Toolbar.init(toolbarContainer, {
        onSearch: onSearchChange,
        onFilter: onFilterChange,
        onRefreshAll: () => {
          sendMessage({ action: 'checkAllPrices' }).catch(() => {});
        },
        onSettingsClick: () => {
          if (typeof GlobalSettings !== 'undefined' && GlobalSettings.open) {
            GlobalSettings.open(modalContainer);
          }
        },
      });
    }

    // Load trackers
    loadTrackers();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Public API (for testing and component communication) ──────────
  return {
    loadTrackers,
    onSearchChange,
    onFilterChange,
    onCardClick,
    onTrackerUpdated,
    onTrackerDeleted,
    applyFilters,
    renderGrid,
    sendMessage,
    extractDomain,
    formatPrice,
    escapeHtml,
    // Expose state getters for testing
    getAllTrackers: () => allTrackers,
    getFilteredTrackers: () => filteredTrackers,
    getSearchQuery: () => searchQuery,
    getPriceFilter: () => priceFilter,
    // Allow setting state for testing
    _setTrackers: (trackers) => { allTrackers = trackers; },
    _setSearchQuery: (q) => { searchQuery = q; },
    _setPriceFilter: (f) => { priceFilter = f; },
  };
})();

// ─── Exports for CommonJS (Jest tests) ──────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Dashboard;
}

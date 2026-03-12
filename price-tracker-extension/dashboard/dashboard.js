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
  let selectedIds = new Set();
  let selectMode = false;

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

  // ─── Skeleton Loader ─────────────────────────────────────────────────

  /**
   * Render 6 skeleton placeholder cards in the loading state area.
   * Each card mimics the structure of a real tracker card with shimmer animation.
   */
  function renderSkeletons() {
    loadingState.innerHTML = '';
    loadingState.classList.add('tracker-grid');
    for (var i = 0; i < 6; i++) {
      var card = document.createElement('div');
      card.className = 'skeleton-card';
      card.innerHTML =
        '<div class="skeleton-image"></div>' +
        '<div class="skeleton-line"></div>' +
        '<div class="skeleton-line"></div>' +
        '<div class="skeleton-price"></div>';
      loadingState.appendChild(card);
    }
  }

  // ─── Crossfade state transitions ───────────────────────────────────

  /**
   * Get the currently visible state element (loading, grid, empty, or error).
   */
  function getCurrentVisibleState() {
    if (!loadingState.hidden) return loadingState;
    if (!trackerGrid.hidden) return trackerGrid;
    if (!emptyState.hidden) return emptyState;
    if (!errorState.hidden) return errorState;
    return null;
  }

  /**
   * Crossfade from the current visible state to the target element.
   * Fades out the current state (150ms), then fades in the new state (150ms).
   */
  function crossfadeTo(targetEl, setupFn) {
    var current = getCurrentVisibleState();

    // If no current visible state or same element, just show directly
    if (!current || current === targetEl) {
      loadingState.hidden = true;
      trackerGrid.hidden = true;
      emptyState.hidden = true;
      errorState.hidden = true;
      if (setupFn) setupFn();
      targetEl.hidden = false;
      targetEl.classList.add('state-fade-enter');
      // Clean up class after animation
      setTimeout(function () {
        targetEl.classList.remove('state-fade-enter');
      }, 300);
      return;
    }

    // Fade out current
    current.classList.add('state-fade-exit');
    setTimeout(function () {
      current.classList.remove('state-fade-exit');
      // Hide all states
      loadingState.hidden = true;
      trackerGrid.hidden = true;
      emptyState.hidden = true;
      errorState.hidden = true;

      if (setupFn) setupFn();

      // Fade in target
      targetEl.hidden = false;
      targetEl.classList.add('state-fade-enter');
      setTimeout(function () {
        targetEl.classList.remove('state-fade-enter');
      }, 300);
    }, 150);
  }

  // ─── UI state management ────────────────────────────────────────────

  function showLoading() {
    renderSkeletons();
    loadingState.hidden = false;
    trackerGrid.hidden = true;
    emptyState.hidden = true;
    errorState.hidden = true;
  }

  function showGrid() {
    crossfadeTo(trackerGrid);
  }

  function showEmpty() {
    crossfadeTo(emptyState);
  }

  function showError(message) {
    crossfadeTo(errorState, function () {
      errorMessage.textContent = message || 'Не удалось загрузить трекеры';
    });
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
   * Applies stagger animation: each card gets .tracker-card-enter, then
   * via requestAnimationFrame + 50ms × index delay, .visible is added.
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

    // Group view
    if (priceFilter === 'groups') {
      renderGroupedView();
      return;
    }

    filteredTrackers.forEach((tracker, index) => {
      const cardEl = renderTrackerCard(tracker);
      cardEl.classList.add('tracker-card-enter');
      trackerGrid.appendChild(cardEl);

      requestAnimationFrame(function () {
        setTimeout(function () {
          cardEl.classList.add('visible');
        }, 50 * index);
      });
    });
  }

  /**
   * Render trackers grouped by productGroup field.
   * Shows comparison table for each group.
   */
  function renderGroupedView() {
    var groups = {};
    var ungrouped = [];

    filteredTrackers.forEach(function (t) {
      if (t.productGroup) {
        if (!groups[t.productGroup]) groups[t.productGroup] = [];
        groups[t.productGroup].push(t);
      } else {
        ungrouped.push(t);
      }
    });

    var groupNames = Object.keys(groups).sort();

    groupNames.forEach(function (name) {
      var section = document.createElement('div');
      section.className = 'product-group-section';
      section.style.cssText = 'grid-column:1/-1;margin-bottom:var(--spacing-lg)';

      var header = document.createElement('h3');
      header.className = 'product-group-title';
      header.textContent = name;
      header.style.cssText = 'color:var(--text-primary);margin-bottom:var(--spacing-sm);font-size:var(--font-lg)';
      section.appendChild(header);

      var table = document.createElement('div');
      table.className = 'product-group-table';
      table.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--spacing-sm)';

      groups[name].forEach(function (tracker) {
        var cardEl = renderTrackerCard(tracker);
        cardEl.classList.add('tracker-card-enter', 'visible');
        table.appendChild(cardEl);
      });

      section.appendChild(table);
      trackerGrid.appendChild(section);
    });

    // Ungrouped trackers
    ungrouped.forEach(function (tracker, index) {
      var cardEl = renderTrackerCard(tracker);
      cardEl.classList.add('tracker-card-enter');
      trackerGrid.appendChild(cardEl);
      requestAnimationFrame(function () {
        setTimeout(function () { cardEl.classList.add('visible'); }, 50 * index);
      });
    });
  }

  /**
   * Animate filter/search changes: fade out current cards, then render new ones.
   * Cards fadeOut/fadeIn with 200ms duration.
   */
  function animateFilterChange(renderFn) {
    var cards = trackerGrid.querySelectorAll('.tracker-card, .card');
    if (cards.length === 0) {
      renderFn();
      return;
    }

    // Fade out existing cards
    cards.forEach(function (card) {
      card.style.transition = 'opacity 200ms ease';
      card.style.opacity = '0';
    });

    setTimeout(function () {
      renderFn();
    }, 200);
  }

  /**
   * Render a single tracker card element.
   * Delegates to TrackerCard component if available, otherwise creates a basic card.
   */
  function renderTrackerCard(tracker) {
    // Use TrackerCard component if loaded
    if (typeof TrackerCard !== 'undefined' && TrackerCard.create) {
      const card = TrackerCard.create(tracker, { selectable: selectMode });
      card.addEventListener('click', function (e) {
        if (e.target.closest('.tracker-card-checkbox')) return;
        if (e.target.closest('.tracker-card-refresh')) return;
        if (e.ctrlKey || e.metaKey) {
          window.open(tracker.pageUrl, '_blank');
          return;
        }
        onCardClick(tracker);
      });
      // Wire per-card refresh button
      var refreshBtn = card.querySelector('.tracker-card-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          refreshBtn.classList.add('toolbar-refresh-spin');
          sendMessage({ action: 'checkPrice', trackerId: tracker.id })
            .then(function () {
              // Reload this tracker's data after check
              return fetch(API_BASE + '/trackers/' + encodeURIComponent(tracker.id));
            })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (updated) {
              refreshBtn.classList.remove('toolbar-refresh-spin');
              if (updated) onTrackerUpdated(updated);
            })
            .catch(function () {
              refreshBtn.classList.remove('toolbar-refresh-spin');
            });
        });
      }
      // Wire checkbox change for multiselect
      var cb = card.querySelector('.tracker-card-select');
      if (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) {
            selectedIds.add(tracker.id);
            card.classList.add('selected');
          } else {
            selectedIds.delete(tracker.id);
            card.classList.remove('selected');
          }
          updateBulkBar();
        });
        if (selectedIds.has(tracker.id)) {
          cb.checked = true;
          card.classList.add('selected');
        }
      }
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

    card.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        window.open(tracker.pageUrl, '_blank');
        return;
      }
      onCardClick(tracker);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          window.open(tracker.pageUrl, '_blank');
          return;
        }
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
   * Animates filter transition with fadeOut/fadeIn.
   */
  function onSearchChange(query) {
    searchQuery = query;
    applyFilters();
    animateFilterChange(function () {
      renderGrid();
    });
  }

  /**
   * Called by Toolbar when price filter changes.
   * Animates filter transition with fadeOut/fadeIn.
   */
  function onFilterChange(filter) {
    priceFilter = filter;
    applyFilters();
    animateFilterChange(function () {
      renderGrid();
    });
  }

  // ─── Data loading ──────────────────────────────────────────────────

  /**
   * Default API base URL (same as in apiClient.js).
   */
  const API_BASE = 'https://pricetracker-production-ac69.up.railway.app';

  /**
   * Load all trackers directly from API.
   */
  async function loadTrackers() {
    showLoading();

    try {
      const res = await fetch(API_BASE + '/trackers');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      allTrackers = await res.json();
      if (!Array.isArray(allTrackers)) allTrackers = [];
    } catch (err) {
      showError(err.message || 'Не удалось загрузить трекеры');
      return;
    }

    applyFilters();
    renderGrid();

    // Load sparklines after a short delay to ensure DOM is ready
    setTimeout(function () { loadSparklines(); }, 300);

    // Reset badge when dashboard opens (Requirement 17.2)
    sendMessage({ action: 'resetBadge' }).catch(() => {});
  }

  // ─── Multiselect / Bulk Operations ─────────────────────────────

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) {
      selectedIds.clear();
    }
    applyFilters();
    renderGrid();
    updateBulkBar();
  }

  function updateBulkBar() {
    var existing = document.getElementById('bulk-bar');
    if (!selectMode) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'bulk-bar';
      existing.className = 'bulk-bar';
      var main = document.querySelector('.dashboard-main');
      if (main) main.parentNode.insertBefore(existing, main);
    }
    existing.innerHTML = '';

    // ─── Top row: count + domain chips ──────────────────────────
    var topRow = document.createElement('div');
    topRow.className = 'bulk-bar-top';

    var countSpan = document.createElement('span');
    countSpan.className = 'bulk-bar-count';
    countSpan.textContent = 'Выбрано: ' + selectedIds.size;
    topRow.appendChild(countSpan);

    // Select all / deselect all toggle
    var allSelected = selectedIds.size === filteredTrackers.length && filteredTrackers.length > 0;
    var toggleAllBtn = document.createElement('button');
    toggleAllBtn.className = 'btn bulk-bar-toggle-all';
    toggleAllBtn.textContent = allSelected ? 'Снять все' : 'Выбрать все';
    toggleAllBtn.addEventListener('click', function () {
      if (allSelected) {
        selectedIds.clear();
      } else {
        filteredTrackers.forEach(function (t) { selectedIds.add(t.id); });
      }
      applyFilters();
      renderGrid();
      updateBulkBar();
    });
    topRow.appendChild(toggleAllBtn);

    existing.appendChild(topRow);

    // ─── Domain chips row ───────────────────────────────────────
    var domains = {};
    allTrackers.forEach(function (t) {
      var d = extractDomain(t.pageUrl);
      if (!domains[d]) domains[d] = [];
      domains[d].push(t.id);
    });

    var domainNames = Object.keys(domains).sort();
    if (domainNames.length > 1) {
      var chipRow = document.createElement('div');
      chipRow.className = 'bulk-bar-chips';

      domainNames.forEach(function (domain) {
        var ids = domains[domain];
        var chip = document.createElement('button');
        chip.className = 'bulk-bar-chip';
        // Check if all trackers of this domain are selected
        var domainAllSelected = ids.every(function (id) { return selectedIds.has(id); });
        if (domainAllSelected) chip.classList.add('active');
        chip.textContent = domain + ' (' + ids.length + ')';
        chip.addEventListener('click', function () {
          if (domainAllSelected) {
            ids.forEach(function (id) { selectedIds.delete(id); });
          } else {
            ids.forEach(function (id) { selectedIds.add(id); });
          }
          applyFilters();
          renderGrid();
          updateBulkBar();
        });
        chipRow.appendChild(chip);
      });

      existing.appendChild(chipRow);
    }

    // ─── Action buttons row ─────────────────────────────────────
    var actionsRow = document.createElement('div');
    actionsRow.className = 'bulk-bar-actions';

    var pauseBtn = document.createElement('button');
    pauseBtn.className = 'btn';
    pauseBtn.textContent = 'Приостановить';
    pauseBtn.addEventListener('click', function () { bulkAction('pause'); });
    actionsRow.appendChild(pauseBtn);

    var resumeBtn = document.createElement('button');
    resumeBtn.className = 'btn';
    resumeBtn.textContent = 'Возобновить';
    resumeBtn.addEventListener('click', function () { bulkAction('resume'); });
    actionsRow.appendChild(resumeBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', function () { bulkAction('delete'); });
    actionsRow.appendChild(deleteBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', function () {
      selectMode = false;
      selectedIds.clear();
      applyFilters();
      renderGrid();
      updateBulkBar();
    });
    actionsRow.appendChild(cancelBtn);

    existing.appendChild(actionsRow);
  }

  async function bulkAction(action) {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === 'delete') {
      if (!confirm('Удалить ' + ids.length + ' трекеров?')) return;
    }

    for (var i = 0; i < ids.length; i++) {
      try {
        if (action === 'delete') {
          await sendMessage({ action: 'deleteTracker', trackerId: ids[i] });
          allTrackers = allTrackers.filter(function (t) { return t.id !== ids[i]; });
        } else if (action === 'pause') {
          await sendMessage({ action: 'updateTracker', trackerId: ids[i], data: { status: 'paused' } });
          var t = allTrackers.find(function (t) { return t.id === ids[i]; });
          if (t) t.status = 'paused';
        } else if (action === 'resume') {
          await sendMessage({ action: 'updateTracker', trackerId: ids[i], data: { status: 'active' } });
          var t2 = allTrackers.find(function (t) { return t.id === ids[i]; });
          if (t2) t2.status = 'active';
        }
      } catch (_) {}
    }

    selectedIds.clear();
    selectMode = false;
    applyFilters();
    renderGrid();
    updateBulkBar();
  }

  // ─── Import / Export ─────────────────────────────────────────────

  function handleExport() {
    var data = JSON.stringify(allTrackers, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'price-tracker-export-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', function () {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var trackers = JSON.parse(reader.result);
          if (!Array.isArray(trackers)) throw new Error('Invalid format');
          var count = 0;
          for (var i = 0; i < trackers.length; i++) {
            var t = trackers[i];
            if (!t.pageUrl || !t.cssSelector) continue;
            try {
              await fetch(API_BASE + '/trackers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  pageUrl: t.pageUrl,
                  cssSelector: t.cssSelector,
                  productName: t.productName || '',
                  imageUrl: t.imageUrl || '',
                  initialPrice: t.initialPrice || t.currentPrice || 0,
                  checkIntervalHours: t.checkIntervalHours || 3,
                  trackingType: t.trackingType || 'price',
                  isAutoDetected: t.isAutoDetected || false,
                  initialContent: t.initialContent || t.currentContent || '',
                  excludedSelectors: t.excludedSelectors || [],
                }),
              });
              count++;
            } catch (_) {}
          }
          alert('Импортировано трекеров: ' + count);
          loadTrackers();
        } catch (e) {
          alert('Ошибка импорта: ' + e.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // ─── Sparklines ──────────────────────────────────────────────────

  /**
   * Load price history for all price trackers and render sparklines.
   */
  async function loadSparklines() {
    if (typeof TrackerCard === 'undefined' || !TrackerCard.renderSparkline) return;

    var containers = document.querySelectorAll('.tracker-card-sparkline[data-tracker-id]');
    for (var i = 0; i < containers.length; i++) {
      var el = containers[i];
      var tid = el.getAttribute('data-tracker-id');
      try {
        var res = await fetch(API_BASE + '/priceHistory?trackerId=' + encodeURIComponent(tid));
        if (!res.ok) continue;
        var records = await res.json();
        if (!Array.isArray(records) || records.length < 2) continue;
        // Sort oldest first
        records.sort(function (a, b) { return new Date(a.checkedAt) - new Date(b.checkedAt); });
        var prices = records.map(function (r) { return Number(r.price); }).filter(function (p) { return !isNaN(p) && p > 0; });
        TrackerCard.renderSparkline(el, prices);
      } catch (_) {}
    }
  }

  // ─── Ripple Effect ──────────────────────────────────────────────────

  /**
   * Initialize ripple effect via delegated click handler on document.body.
   * Creates a .ripple span at click position for all .btn elements.
   */
  function initRipple() {
    document.body.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn');
      if (!btn) return;

      // Ensure the button has ripple-container class for overflow:hidden
      if (!btn.classList.contains('ripple-container')) {
        btn.classList.add('ripple-container');
      }

      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var x = e.clientX - rect.left - size / 2;
      var y = e.clientY - rect.top - size / 2;

      var ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = size + 'px';
      ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';

      btn.appendChild(ripple);

      // Remove ripple element after animation completes (400ms)
      setTimeout(function () {
        if (ripple.parentNode) {
          ripple.parentNode.removeChild(ripple);
        }
      }, 400);
    });
  }

  // ─── Initialisation ────────────────────────────────────────────────

  function init() {
    // Replace emoji icons with SVG icons
    if (typeof Icons !== 'undefined') {
      var emptyIcon = document.getElementById('empty-state-icon');
      if (emptyIcon) emptyIcon.innerHTML = Icons.el('chart', 48);
      var errorIcon = document.getElementById('error-state-icon');
      if (errorIcon) errorIcon.innerHTML = Icons.el('warning', 48);
    }

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
        onExport: handleExport,
        onImport: handleImport,
        onSelectMode: toggleSelectMode,
      });
    }

    // Initialise ripple effect for all .btn elements
    initRipple();

    // Load trackers
    loadTrackers();

    // Listen for tracker updates from the service worker (e.g. variant price corrections)
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.action !== 'trackerUpdated') return;
      var tid = message.trackerId;
      if (!tid) return;
      // Reload the updated tracker from API and refresh its card
      fetch(API_BASE + '/trackers/' + encodeURIComponent(tid))
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (updated) {
          if (updated) onTrackerUpdated(updated);
        })
        .catch(function () {});
    });
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
    renderSkeletons,
    animateFilterChange,
    initRipple,
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
    toggleSelectMode,
    bulkAction,
  };
})();

// ─── Exports for CommonJS (Jest tests) ──────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Dashboard;
}

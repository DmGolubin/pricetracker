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
  let priceFilter = 'all'; // 'all' | 'down' | 'up' | 'groups'
  let selectedGroup = null; // specific group name or null for all
  let selectedIds = new Set();
  let selectMode = false;
  let refreshAbortController = null;
  let openFolder = null; // currently open folder name, or null for folder grid view
  // Empty groups stored locally (not in DB — just group names with no trackers)
  let emptyGroups = new Set();

  // Hidden groups — persisted in localStorage, excluded from sidebar and grid
  var HIDDEN_GROUPS_KEY = 'priceTracker_hiddenGroups';
  let hiddenGroups = (function () {
    try {
      var stored = localStorage.getItem(HIDDEN_GROUPS_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch (e) { return new Set(); }
  })();
  var showHiddenGroups = false; // toggle to temporarily show hidden groups in sidebar

  function saveHiddenGroups() {
    try { localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(Array.from(hiddenGroups))); } catch (e) { /* noop */ }
  }

  // Sort state — persisted in localStorage
  var SORT_STORAGE_KEY = 'priceTracker_sortBy';
  let sortBy = (function () {
    try { return localStorage.getItem(SORT_STORAGE_KEY) || 'priceAsc'; } catch (e) { return 'priceAsc'; }
  })();

  // ─── Module references (browser globals or Node requires) ──────────
  var _sortEngine = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.sortEngine)
    ? self.PriceTracker.sortEngine
    : (typeof require === 'function' ? (function () { try { return require('./components/sortEngine'); } catch (e) { return null; } })() : null);

  var _comparisonTable = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.comparisonTable)
    ? self.PriceTracker.comparisonTable
    : (typeof require === 'function' ? (function () { try { return require('./components/comparisonTable'); } catch (e) { return null; } })() : null);

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
   * Apply search query and price filter to the full tracker list,
   * then sort using the current sortBy criterion.
   */
  function applyFilters() {
    filteredTrackers = allTrackers.filter((tracker) => {
      // Hide trackers from hidden groups (unless viewing that specific group)
      if (!showHiddenGroups && hiddenGroups.has(tracker.productGroup) && sidebarFilterGroup !== tracker.productGroup) {
        return false;
      }

      // Sidebar folder filter (applies on top of other filters)
      if (sidebarFilterGroup !== null) {
        if (sidebarFilterGroup === '__ungrouped__') {
          if (tracker.productGroup) return false;
        } else {
          if (tracker.productGroup !== sidebarFilterGroup) return false;
        }
      }

      // Search filter (case-insensitive match on productName)
      if (searchQuery) {
        const name = (tracker.productName || '').toLowerCase();
        if (!name.includes(searchQuery.toLowerCase())) {
          return false;
        }
      }

      // Group filter (when a specific group is selected)
      if (priceFilter === 'groups' && selectedGroup) {
        return tracker.productGroup === selectedGroup;
      }

      // Unread / notifications filter
      if (priceFilter === 'unread') {
        return tracker.unread === true || tracker.status === 'updated';
      }

      // Status filters
      if (priceFilter === 'paused') {
        return tracker.status === 'paused';
      }
      if (priceFilter === 'error') {
        return tracker.status === 'error';
      }

      // Starred / favorites filter
      if (priceFilter === 'starred') {
        return tracker.starred === true;
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

    // Apply sorting after filtering
    if (_sortEngine && sortBy) {
      filteredTrackers = _sortEngine.sortTrackers(filteredTrackers, sortBy);
    }
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

    // Check if table view is active
    var gridEl = document.getElementById('tracker-grid');
    var isTableView = gridEl && gridEl.classList.contains('grid-table');
    if (isTableView) {
      renderTableView();
      return;
    }

    var trackersToShow = filteredTrackers.slice(0, displayCount);
    trackersToShow.forEach((tracker, index) => {
      const cardEl = renderTrackerCard(tracker);
      cardEl.classList.add('tracker-card-enter', 'sort-transition');
      trackerGrid.appendChild(cardEl);

      requestAnimationFrame(function () {
        setTimeout(function () {
          cardEl.classList.add('visible');
        }, 50 * index);
      });
    });

    // Search highlighting
    highlightSearchMatches();

    // "Load more" button for pagination
    renderLoadMoreButton();
  }

  /**
   * Render trackers as a compact table view.
   */
  function renderTableView() {
    var trackersToShow = filteredTrackers.slice(0, displayCount);
    var table = document.createElement('table');
    table.className = 'tracker-table';

    // Header
    var thead = document.createElement('thead');
    thead.innerHTML = '<tr>' +
      '<th>⭐</th>' +
      '<th>Название</th>' +
      '<th>Магазин</th>' +
      '<th>Цена</th>' +
      '<th>Мин</th>' +
      '<th>Макс</th>' +
      '<th>Статус</th>' +
      '<th>Проверено</th>' +
      '</tr>';
    table.appendChild(thead);

    // Body
    var tbody = document.createElement('tbody');
    trackersToShow.forEach(function (tracker) {
      var tr = document.createElement('tr');
      if (tracker.status === 'updated' || tracker.unread) {
        tr.style.background = 'rgba(99, 102, 241, 0.05)';
      }

      var starClass = tracker.starred ? 'table-star starred' : 'table-star';
      var domain = extractDomain(tracker.pageUrl);
      var price = formatPrice(tracker.currentPrice);
      var minP = formatPrice(tracker.minPrice);
      var maxP = formatPrice(tracker.maxPrice);

      var statusMap = {
        active: '🟢',
        updated: '🔵',
        paused: '⏸️',
        error: '🔴'
      };
      var statusIcon = statusMap[tracker.status] || '⚪';

      var checkedAt = '';
      if (tracker.lastCheckedAt) {
        var d = new Date(tracker.lastCheckedAt);
        var now = new Date();
        var diffMs = now - d;
        var diffH = Math.floor(diffMs / 3600000);
        if (diffH < 1) {
          checkedAt = Math.floor(diffMs / 60000) + ' мин';
        } else if (diffH < 24) {
          checkedAt = diffH + ' ч';
        } else {
          checkedAt = Math.floor(diffH / 24) + ' д';
        }
      }

      var name = escapeHtml(tracker.productName || 'Без названия');

      tr.innerHTML = '<td><span class="' + starClass + '">★</span></td>' +
        '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + name + '</td>' +
        '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(domain) + '</td>' +
        '<td class="table-price">' + price + '</td>' +
        '<td>' + minP + '</td>' +
        '<td>' + maxP + '</td>' +
        '<td style="text-align:center">' + statusIcon + '</td>' +
        '<td>' + checkedAt + '</td>';

      tr.addEventListener('click', function (e) {
        if (e.target.closest('.table-star')) {
          e.stopPropagation();
          return;
        }
        onCardClick(tracker);
      });

      // Star toggle
      var starEl = tr.querySelector('.table-star');
      if (starEl) {
        starEl.addEventListener('click', function (e) {
          e.stopPropagation();
          var newStarred = !tracker.starred;
          apiFetch(API_BASE + '/trackers/' + encodeURIComponent(tracker.id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ starred: newStarred })
          }).then(function (res) { return res.json(); })
            .then(function (updated) {
              if (updated && updated.id) {
                onTrackerUpdated(updated);
              }
            }).catch(function () {});
        });
      }

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    trackerGrid.appendChild(table);

    // "Load more" button for pagination
    renderLoadMoreButton();
  }

  /**
   * Render trackers grouped by productGroup field.
   * Shows group header + card grid for each group.
   */
  function renderGroupedView() {
    // If a folder is open, render its contents
    if (openFolder !== null) {
      renderFolderContents(openFolder);
      return;
    }

    // Render folder grid
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

    // Include empty groups
    emptyGroups.forEach(function (name) {
      if (!groups[name]) groups[name] = [];
    });

    var groupNames = Object.keys(groups).sort();

    // Toolbar: Create folder button
    var toolbarRow = document.createElement('div');
    toolbarRow.className = 'folder-toolbar';
    var createBtn = document.createElement('button');
    createBtn.className = 'btn';
    createBtn.innerHTML = ((typeof Icons !== 'undefined') ? Icons.el('plus', 16) : '+') + ' Создать папку';
    createBtn.addEventListener('click', function () {
      var name = prompt('Название новой папки:');
      if (name && name.trim()) {
        emptyGroups.add(name.trim());
        applyFilters();
        renderGrid();
      }
    });
    toolbarRow.appendChild(createBtn);
    trackerGrid.appendChild(toolbarRow);

    // Folder cards grid
    var folderGrid = document.createElement('div');
    folderGrid.className = 'folder-grid';

    groupNames.forEach(function (name, idx) {
      var trackersInGroup = groups[name] || [];
      var folderCard = createFolderCard(name, trackersInGroup);
      folderCard.classList.add('tracker-card-enter');
      folderGrid.appendChild(folderCard);
      requestAnimationFrame(function () {
        setTimeout(function () { folderCard.classList.add('visible'); }, 40 * idx);
      });
    });

    if (ungrouped.length > 0) {
      var ungroupedCard = createFolderCard(null, ungrouped);
      ungroupedCard.classList.add('tracker-card-enter');
      folderGrid.appendChild(ungroupedCard);
      requestAnimationFrame(function () {
        setTimeout(function () { ungroupedCard.classList.add('visible'); }, 40 * groupNames.length);
      });
    }

    trackerGrid.appendChild(folderGrid);
  }

  function createFolderCard(groupName, trackers) {
    var card = document.createElement('div');
    card.className = 'folder-card card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    var isUngrouped = groupName === null;
    var displayName = isUngrouped ? '📎 Без группы' : groupName;

    var bestPrice = null;
    var bestDomain = '';
    trackers.forEach(function (t) {
      var p = Number(t.currentPrice);
      if (p > 0 && (bestPrice === null || p < bestPrice)) {
        bestPrice = p;
        bestDomain = extractDomain(t.pageUrl);
      }
    });

    var thumbs = trackers.slice(0, 4).filter(function (t) { return t.imageUrl; });

    var html = '<div class="folder-card-thumbs">';
    if (thumbs.length > 0) {
      thumbs.forEach(function (t) {
        html += '<img class="folder-card-thumb" src="' + escapeHtml(t.imageUrl) + '" alt="" loading="lazy">';
      });
    } else {
      html += '<div class="folder-card-empty-icon">📦</div>';
    }
    html += '</div>';
    html += '<div class="folder-card-info">';
    html += '<div class="folder-card-name">' + escapeHtml(displayName) + '</div>';
    html += '<div class="folder-card-meta">';
    html += '<span class="folder-card-count">' + trackers.length + ' трекеров</span>';
    if (bestPrice) html += '<span class="folder-card-best">💰 ' + formatPrice(bestPrice) + '</span>';
    html += '</div></div>';
    if (!isUngrouped) {
      html += '<button class="folder-card-menu btn-icon" aria-label="Действия с папкой" title="Действия">⋮</button>';
    }

    card.innerHTML = html;

    card.addEventListener('click', function (e) {
      if (e.target.closest('.folder-card-menu')) return;
      openFolder = isUngrouped ? '__ungrouped__' : groupName;
      applyFilters();
      renderGrid();
    });

    if (!isUngrouped) {
      var menuBtn = card.querySelector('.folder-card-menu');
      if (menuBtn) {
        menuBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          showFolderContextMenu(groupName, trackers, menuBtn);
        });
      }
    }

    return card;
  }

  function showFolderContextMenu(groupName, trackers, anchorEl) {
    var existing = document.querySelector('.folder-context-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.className = 'folder-context-menu';

    var renameItem = document.createElement('button');
    renameItem.className = 'folder-context-item';
    renameItem.textContent = '✏️ Переименовать';
    renameItem.addEventListener('click', function () {
      menu.remove();
      var newName = prompt('Новое название:', groupName);
      if (newName && newName.trim() && newName.trim() !== groupName) {
        renameFolderGroup(groupName, newName.trim());
      }
    });

    var deleteKeepItem = document.createElement('button');
    deleteKeepItem.className = 'folder-context-item';
    deleteKeepItem.textContent = '📎 Удалить папку (оставить трекеры)';
    deleteKeepItem.addEventListener('click', function () {
      menu.remove();
      deleteFolderGroup(groupName, false);
    });

    var deleteAllItem = document.createElement('button');
    deleteAllItem.className = 'folder-context-item folder-context-danger';
    deleteAllItem.textContent = '🗑️ Удалить папку и трекеры';
    deleteAllItem.addEventListener('click', function () {
      menu.remove();
      if (confirm('Удалить папку "' + groupName + '" и все ' + trackers.length + ' трекеров?')) {
        deleteFolderGroup(groupName, true);
      }
    });

    menu.appendChild(renameItem);
    menu.appendChild(deleteKeepItem);
    if (trackers.length > 0) menu.appendChild(deleteAllItem);

    document.body.appendChild(menu);
    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';

    setTimeout(function () {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      });
    }, 0);
  }

  async function renameFolderGroup(oldName, newName) {
    var trackersInGroup = allTrackers.filter(function (t) { return t.productGroup === oldName; });
    for (var i = 0; i < trackersInGroup.length; i++) {
      try {
        await sendMessage({ action: 'updateTracker', trackerId: trackersInGroup[i].id, data: { productGroup: newName } });
        trackersInGroup[i].productGroup = newName;
      } catch (_) {}
    }
    emptyGroups.delete(oldName);
    applyFilters();
    renderGrid();
  }

  async function deleteFolderGroup(groupName, deleteTrackers) {
    var trackersInGroup = allTrackers.filter(function (t) { return t.productGroup === groupName; });
    for (var i = 0; i < trackersInGroup.length; i++) {
      try {
        if (deleteTrackers) {
          await sendMessage({ action: 'deleteTracker', trackerId: trackersInGroup[i].id });
        } else {
          await sendMessage({ action: 'updateTracker', trackerId: trackersInGroup[i].id, data: { productGroup: '' } });
          trackersInGroup[i].productGroup = '';
        }
      } catch (_) {}
    }
    emptyGroups.delete(groupName);
    if (deleteTrackers) {
      allTrackers = allTrackers.filter(function (t) { return t.productGroup !== groupName; });
    }
    openFolder = null;
    applyFilters();
    renderGrid();
  }

  function renderFolderContents(folderName) {
    var isUngrouped = folderName === '__ungrouped__';
    var trackersInFolder = filteredTrackers.filter(function (t) {
      return isUngrouped ? !t.productGroup : t.productGroup === folderName;
    });

    // Back button row
    var backRow = document.createElement('div');
    backRow.className = 'folder-back-row';
    var backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.innerHTML = ((typeof Icons !== 'undefined') ? Icons.el('chevron-up', 16) : '←') + ' Назад к папкам';
    backBtn.addEventListener('click', function () {
      openFolder = null;
      applyFilters();
      renderGrid();
    });
    backRow.appendChild(backBtn);

    var folderTitle = document.createElement('h2');
    folderTitle.className = 'folder-title';
    folderTitle.textContent = isUngrouped ? '📎 Без группы' : folderName;
    backRow.appendChild(folderTitle);

    var countBadge = document.createElement('span');
    countBadge.className = 'product-group-count';
    countBadge.textContent = trackersInFolder.length;
    backRow.appendChild(countBadge);

    trackerGrid.appendChild(backRow);

    // Comparison table for named groups with 2+ trackers
    if (!isUngrouped && trackersInFolder.length >= 2 && _comparisonTable) {
      var compContainer = document.createElement('div');
      compContainer.className = 'product-group-comparison';
      compContainer.style.display = '';
      var table = _comparisonTable.create(folderName, trackersInFolder, {
        onRowClick: function (tracker) { onCardClick(tracker); },
      });
      compContainer.appendChild(table);
      trackerGrid.appendChild(compContainer);
    }

    // Tracker cards
    var grid = document.createElement('div');
    grid.className = 'product-group-grid';
    trackersInFolder.forEach(function (tracker, idx) {
      var cardEl = renderTrackerCard(tracker);
      cardEl.classList.add('tracker-card-enter');
      grid.appendChild(cardEl);
      requestAnimationFrame(function () {
        setTimeout(function () { cardEl.classList.add('visible'); }, 50 * idx);
      });
    });
    trackerGrid.appendChild(grid);

    if (trackersInFolder.length === 0) {
      var emptyMsg = document.createElement('p');
      emptyMsg.className = 'empty-state-hint';
      emptyMsg.style.cssText = 'text-align:center;padding:var(--spacing-xl);color:var(--text-muted)';
      emptyMsg.textContent = 'Папка пуста';
      trackerGrid.appendChild(emptyMsg);
    }
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
              return apiFetch(API_BASE + '/trackers/' + encodeURIComponent(tracker.id));
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
      // Wire star button for favorites toggle
      var starBtn = card.querySelector('.tracker-card-star');
      if (starBtn) {
        starBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var newStarred = !tracker.starred;
          sendMessage({ action: 'updateTracker', trackerId: tracker.id, data: { starred: newStarred } })
            .then(function () {
              tracker.starred = newStarred;
              starBtn.classList.toggle('starred', newStarred);
              starBtn.textContent = newStarred ? '⭐' : '☆';
              starBtn.title = newStarred ? 'Убрать из избранного' : 'В избранное';
            })
            .catch(function () {});
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
      var oldPrice = allTrackers[idx].currentPrice;
      allTrackers[idx] = updatedTracker;

      // Price flash animation
      var newPrice = updatedTracker.currentPrice;
      if (typeof oldPrice === 'number' && typeof newPrice === 'number' && oldPrice !== newPrice) {
        var cardEl = trackerGrid.querySelector('[data-tracker-id="' + updatedTracker.id + '"]');
        if (cardEl) {
          var flashClass = newPrice < oldPrice ? 'price-flash-down' : 'price-flash-up';
          cardEl.classList.add(flashClass);
          cardEl.addEventListener('animationend', function () {
            cardEl.classList.remove(flashClass);
          }, { once: true });
        }
      }
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
    displayCount = 50;
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
    openFolder = null;
    displayCount = 50;
    applyFilters();
    animateFilterChange(function () {
      renderGrid();
    });
  }

  /**
   * Called by Toolbar when sort option changes.
   * Saves to localStorage and re-renders with transition animation.
   */
  function onSortChange(newSortBy) {
    sortBy = newSortBy;
    try { localStorage.setItem(SORT_STORAGE_KEY, sortBy); } catch (e) { /* noop */ }
    applyFilters();
    animateFilterChange(function () {
      renderGrid();
    });
  }

  /**
   * Called by Toolbar when a specific group is selected.
   */
  function onGroupSelect(groupName) {
    selectedGroup = groupName;
    applyFilters();
    animateFilterChange(function () {
      renderGrid();
    });
  }

  // ─── Server-side Refresh ──────────────────────────────────────────

  /**
   * Determine the current check method from global settings.
   * @returns {Promise<string>} 'server' | 'extension' | 'hybrid'
   */
  async function getGlobalCheckMethod() {
    try {
      var res = await apiFetch(API_BASE + '/settings/global');
      var settings = await res.json();
      return (settings && settings.checkMethod) || 'server';
    } catch (_) {
      return 'server';
    }
  }

  /**
   * Main refresh handler — respects the global checkMethod setting.
   */
  async function handleRefreshAll() {
    // If a folder is selected in sidebar, refresh only those trackers
    if (sidebarFilterGroup !== null) {
      return handleRefreshFiltered();
    }
    // Dashboard manual refresh always uses browser (extension) tabs
    return handleExtensionRefresh();
  }

  /**
   * Refresh only the currently filtered/visible trackers (e.g. a specific folder).
   */
  /**
   * Run async tasks with concurrency limit.
   * @param {Array} items
   * @param {number} concurrency
   * @param {Function} fn - async function(item, index)
   * @param {Function} [onProgress] - callback(completed, total)
   * @returns {Promise<{errors: number}>}
   */
  async function runConcurrent(items, concurrency, fn, onProgress) {
    var completed = 0;
    var errors = 0;
    var idx = 0;

    async function worker() {
      while (idx < items.length) {
        var i = idx++;
        try {
          await fn(items[i], i);
        } catch (_) {
          errors++;
        }
        completed++;
        if (onProgress) onProgress(completed, items.length);
      }
    }

    var workers = [];
    for (var w = 0; w < Math.min(concurrency, items.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return { errors: errors };
  }

  async function handleRefreshFiltered() {
    var ids = filteredTrackers.map(function (t) { return t.id; });
    if (ids.length === 0) {
      showToast('Нет трекеров для обновления', 'info');
      return;
    }

    var folderName = sidebarFilterGroup === '__ungrouped__' ? 'Без группы' : sidebarFilterGroup;
    if (!confirm('Обновить ' + ids.length + ' трекеров в "' + folderName + '"?')) return;

    var refreshBtn = document.getElementById('toolbar-refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="save-spinner"></span> ' + ids.length + '...';
    }

    showRefreshStatus('🔄 Обновление "' + folderName + '": 0/' + ids.length, false);

    var result = await runConcurrent(ids, 3, function (id) {
      return sendMessage({ action: 'checkPriceExtension', trackerId: id });
    }, function (done, total) {
      showRefreshStatus('🔄 Обновление "' + folderName + '": ' + done + '/' + total, false);
    });

    var msg = '✅ ' + folderName + ': обновлено ' + (ids.length - result.errors) + '/' + ids.length;
    if (result.errors > 0) msg += ' (ошибок: ' + result.errors + ')';
    showRefreshStatus(msg, false);
    setTimeout(hideRefreshStatus, 5000);

    if (refreshBtn) {
      refreshBtn.disabled = false;
      var refreshIcon = (typeof Icons !== 'undefined') ? Icons.el('refresh', 18) : '';
      refreshBtn.innerHTML = refreshIcon + ' Обновить все';
    }

    await loadTrackers();
  }

  /**
   * Hybrid refresh: try server first, fallback to extension on error.
   */
  async function handleHybridRefresh() {
    var refreshBtn = document.getElementById('toolbar-refresh-btn');

    if (!confirm('Запустить проверку цен? Сначала сервер, при ошибке — через браузер.')) return;

    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="save-spinner"></span> Проверка...';
    }

    showRefreshStatus('🔄 Гибрид: пробуем сервер...', true);

    try {
      refreshAbortController = new AbortController();
      var res = await apiFetch(API_BASE + '/server-check', {
        method: 'POST',
        signal: refreshAbortController.signal,
      });
      var result = await res.json();

      if (result.error) {
        throw new Error(result.error);
      }

      showRefreshStatus(
        '✅ Сервер: проверено ' + result.checked + ' | изменилось ' + result.changed + ' | ошибок ' + result.errors,
        false
      );
      await loadTrackers();
    } catch (serverErr) {
      if (serverErr.name === 'AbortError') {
        showRefreshStatus('Проверка отменена', false);
        return;
      }
      // Fallback to extension
      showRefreshStatus('⚠️ Сервер недоступен, переключаюсь на браузер...', false);
      try {
        await new Promise(function (resolve, reject) {
          chrome.runtime.sendMessage(
            { action: 'checkAllPricesExtension' },
            function (resp) {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (resp && resp.error) return reject(new Error(resp.error));
              resolve(resp);
            }
          );
        });
        showRefreshStatus('✅ Проверка через браузер завершена (fallback)', false);
        await loadTrackers();
      } catch (extErr) {
        showRefreshStatus('Ошибка: ' + (extErr.message || 'неизвестная ошибка'), false);
      }
    } finally {
      refreshAbortController = null;
      if (refreshBtn) {
        refreshBtn.disabled = false;
        var refreshIcon = (typeof Icons !== 'undefined') ? Icons.el('refresh', 18) : '';
        refreshBtn.innerHTML = refreshIcon + ' Обновить все';
      }
      setTimeout(hideRefreshStatus, 8000);
    }
  }

  /**
   * Trigger server-side price check with progress UI.
   */
  async function handleServerRefresh() {
    var refreshBtn = document.getElementById('toolbar-refresh-btn');
    var toolbarContainer = document.getElementById('toolbar-container');

    // Check if already running — show cancel option
    try {
      var statusRes = await apiFetch(API_BASE + '/server-check/status');
      var status = await statusRes.json();
      if (status.running) {
        showRefreshStatus('Проверка уже выполняется...', true);
        return;
      }
    } catch (_) {}

    // Confirmation dialog
    if (!confirm('Запустить проверку цен? Это может занять несколько минут.')) return;

    // Update button state
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="save-spinner"></span> Проверка...';
    }

    showRefreshStatus('Запуск проверки цен на сервере...', true);

    // Start the check
    refreshAbortController = new AbortController();
    try {
      var res = await apiFetch(API_BASE + '/server-check', {
        method: 'POST',
        signal: refreshAbortController.signal,
      });
      var result = await res.json();

      if (result.skipped) {
        showRefreshStatus('Проверка уже выполняется. Дождитесь завершения.', true);
      } else if (result.cancelled) {
        showRefreshStatus('⛔ Проверка отменена. Проверено: ' + result.checked + ' | Изменилось: ' + result.changed, false);
        await loadTrackers();
      } else if (result.error) {
        showRefreshStatus('Ошибка: ' + result.error, false);
      } else {
        showRefreshStatus(
          '✅ Проверено: ' + result.checked + ' | Изменилось: ' + result.changed + ' | Ошибок: ' + result.errors,
          false
        );
        // Reload trackers to show updated prices
        await loadTrackers();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        showRefreshStatus('Проверка отменена', false);
      } else {
        showRefreshStatus('Ошибка: ' + (err.message || 'неизвестная ошибка'), false);
      }
    } finally {
      refreshAbortController = null;
      if (refreshBtn) {
        refreshBtn.disabled = false;
        var refreshIcon = (typeof Icons !== 'undefined') ? Icons.el('refresh', 18) : '';
        refreshBtn.innerHTML = refreshIcon + ' Обновить все';
      }
      // Auto-hide status after 8 seconds
      setTimeout(hideRefreshStatus, 8000);
    }
  }

  function showRefreshStatus(text, showCancel) {
    var existing = document.getElementById('refresh-status-bar');
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'refresh-status-bar';
      existing.className = 'refresh-status-bar';
      var toolbarEl = document.querySelector('.toolbar');
      if (toolbarEl && toolbarEl.parentNode) {
        toolbarEl.parentNode.insertBefore(existing, toolbarEl.nextSibling);
      } else {
        document.body.prepend(existing);
      }
    }

    existing.innerHTML = '';
    var textSpan = document.createElement('span');
    textSpan.className = 'refresh-status-text';
    textSpan.textContent = text;
    existing.appendChild(textSpan);

    if (showCancel) {
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn';
      cancelBtn.textContent = 'Отменить';
      cancelBtn.addEventListener('click', function () {
        // Cancel server-side check
        apiFetch(API_BASE + '/server-check/cancel', { method: 'POST' }).catch(function () {});
        // Cancel client-side fetch
        if (refreshAbortController) {
          refreshAbortController.abort();
        }
      });
      existing.appendChild(cancelBtn);
    }
  }

  function hideRefreshStatus() {
    var el = document.getElementById('refresh-status-bar');
    if (el) el.remove();
  }

  // ─── Extension-based Refresh ──────────────────────────────────────

  /**
   * Trigger extension-based price check (opens tabs in browser).
   * Sends message to service worker which delegates to priceChecker.
   */
  async function handleExtensionRefresh() {
    var extBtn = document.getElementById('toolbar-ext-refresh-btn');
    var refreshBtn = document.getElementById('toolbar-refresh-btn');

    if (!confirm('Проверить цены через браузер? Будут открываться и закрываться вкладки.')) return;

    // Disable both buttons
    if (extBtn) {
      extBtn.disabled = true;
      extBtn.innerHTML = '<span class="save-spinner"></span> Проверка...';
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    showRefreshStatus('🌐 Проверка цен через браузер...', false);

    try {
      var response = await new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage(
          { action: 'checkAllPricesExtension' },
          function (resp) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (resp && resp.error) {
              reject(new Error(resp.error));
              return;
            }
            resolve(resp);
          }
        );
      });

      showRefreshStatus('✅ Проверка через браузер завершена', false);
      await loadTrackers();
    } catch (err) {
      showRefreshStatus('Ошибка: ' + (err.message || 'неизвестная ошибка'), false);
    } finally {
      if (extBtn) {
        extBtn.disabled = false;
        var globeIcon = (typeof Icons !== 'undefined') ? Icons.el('globe', 18) : '🌐';
        extBtn.innerHTML = globeIcon + ' Браузер';
      }
      if (refreshBtn) {
        refreshBtn.disabled = false;
      }
      setTimeout(hideRefreshStatus, 8000);
    }
  }

  // ─── Data loading ──────────────────────────────────────────────────

  /**
   * Default API base URL (same as in apiClient.js).
   */
  const API_BASE = 'http://85.115.209.141';

  // ─── API Token for direct fetch calls ─────────────────────────────
  var _apiToken = '';
  try { _apiToken = localStorage.getItem('priceTracker_apiToken') || ''; } catch(_) {}

  /**
   * Fetch wrapper that adds Authorization header when API token is set.
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  function apiFetch(url, options) {
    var opts = options || {};
    opts.headers = Object.assign({
      'Content-Type': 'application/json',
    }, _apiToken ? { 'Authorization': 'Bearer ' + _apiToken } : {}, opts.headers || {});
    return fetch(url, opts);
  }

  /**
   * Update favicon with unread/updated tracker count badge.
   */
  function updateFaviconBadge() {
    var unreadCount = allTrackers.filter(function (t) {
      return t.unread === true || t.status === 'updated';
    }).length;

    var link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    if (unreadCount === 0) {
      link.href = '../icons/icon16.png';
      document.title = 'Price Tracker — Dashboard';
      return;
    }

    // Draw badge on canvas
    var canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    var ctx = canvas.getContext('2d');

    // Draw base icon (simple chart icon)
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PT', 16, 16);

    // Draw red badge
    var badgeText = unreadCount > 99 ? '99+' : String(unreadCount);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(26, 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(badgeText, 26, 8);

    link.href = canvas.toDataURL('image/png');
    document.title = '(' + unreadCount + ') Price Tracker — Dashboard';
  }

  /**
   * Load all trackers directly from API.
   */
  async function loadTrackers() {
    showLoading();

    try {
      const res = await apiFetch(API_BASE + '/trackers');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      allTrackers = await res.json();
      if (!Array.isArray(allTrackers)) allTrackers = [];
    } catch (err) {
      showError(err.message || 'Не удалось загрузить трекеры');
      return;
    }

    applyFilters();
    renderGrid();

    // Update group chips in toolbar
    var groups = {};
    allTrackers.forEach(function (t) {
      if (t.productGroup) groups[t.productGroup] = true;
    });
    if (typeof Toolbar !== 'undefined' && Toolbar.setGroups) {
      Toolbar.setGroups(Object.keys(groups).sort());
    }

    // Update folder sidebar
    renderFolderSidebar();

    // Update favicon badge with unread count
    updateFaviconBadge();

    // Update last checked indicator
    updateLastCheckedIndicator();

    // Load sparklines after a short delay to ensure DOM is ready
    setTimeout(function () { loadSparklines(); }, 300);

    // Reset badge when dashboard opens (Requirement 17.2)
    sendMessage({ action: 'resetBadge' }).catch(() => {});
  }

  // ─── Last Checked Indicator ─────────────────────────────────────

  function updateLastCheckedIndicator() {
    var el = document.getElementById('toolbar-last-checked');
    if (!el) {
      // Create indicator next to refresh button
      el = document.createElement('span');
      el.id = 'toolbar-last-checked';
      el.className = 'toolbar-last-checked';
      var refreshBtn = document.getElementById('toolbar-refresh-btn');
      if (refreshBtn && refreshBtn.parentNode) {
        refreshBtn.parentNode.insertBefore(el, refreshBtn.nextSibling);
      }
    }

    // Find most recent lastCheckedAt
    var latest = null;
    allTrackers.forEach(function (t) {
      if (t.lastCheckedAt) {
        var d = new Date(t.lastCheckedAt).getTime();
        if (!latest || d > latest) latest = d;
      }
    });

    if (!latest) {
      el.textContent = '';
      return;
    }

    function formatAgo(ms) {
      var mins = Math.floor(ms / 60000);
      if (mins < 1) return 'только что';
      if (mins < 60) return mins + 'м назад';
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + 'ч назад';
      return Math.floor(hours / 24) + 'д назад';
    }

    el.textContent = '🕐 ' + formatAgo(Date.now() - latest);
  }

  // Update indicator every minute
  setInterval(updateLastCheckedIndicator, 60000);

  // ─── Folder Sidebar ─────────────────────────────────────────────

  var sidebarSearchQuery = ''; // search query for filtering sidebar folders
  var sidebarFilterGroup = null; // currently selected group in sidebar, null = all

  function renderFolderSidebar() {
    var list = document.getElementById('folder-sidebar-list');
    if (!list) return;
    list.innerHTML = '';

    // Search input
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input folder-sidebar-search';
    searchInput.placeholder = '🔍 Поиск папки...';
    searchInput.value = sidebarSearchQuery;
    searchInput.addEventListener('input', function () {
      sidebarSearchQuery = searchInput.value;
      renderFolderSidebar();
      // Re-focus input after re-render
      var newInput = document.querySelector('.folder-sidebar-search');
      if (newInput) { newInput.focus(); newInput.selectionStart = newInput.selectionEnd = newInput.value.length; }
    });
    list.appendChild(searchInput);

    // Collect groups
    var groupMap = {};
    var ungroupedCount = 0;
    allTrackers.forEach(function (t) {
      if (t.productGroup) {
        if (!groupMap[t.productGroup]) groupMap[t.productGroup] = { count: 0, bestPrice: null };
        groupMap[t.productGroup].count++;
        var p = Number(t.currentPrice);
        if (p > 0 && (groupMap[t.productGroup].bestPrice === null || p < groupMap[t.productGroup].bestPrice)) {
          groupMap[t.productGroup].bestPrice = p;
        }
      } else {
        ungroupedCount++;
      }
    });

    // Include empty groups
    emptyGroups.forEach(function (name) {
      if (!groupMap[name]) groupMap[name] = { count: 0, bestPrice: null };
    });

    var groupNames = Object.keys(groupMap).sort();

    // Separate hidden and visible groups
    var visibleGroupNames = groupNames.filter(function (name) { return !hiddenGroups.has(name); });
    var hiddenGroupNames = groupNames.filter(function (name) { return hiddenGroups.has(name); });

    // Filter by search query
    var query = sidebarSearchQuery.toLowerCase().trim();
    if (query) {
      visibleGroupNames = visibleGroupNames.filter(function (name) {
        return name.toLowerCase().includes(query);
      });
      hiddenGroupNames = hiddenGroupNames.filter(function (name) {
        return name.toLowerCase().includes(query);
      });
    }

    // "All" item (always visible)
    if (!query) {
      var allItem = document.createElement('button');
      allItem.className = 'folder-sidebar-item' + (sidebarFilterGroup === null ? ' active' : '');
      allItem.dataset.groupName = '__all__';
      allItem.innerHTML = '<span class="folder-sidebar-item-name">📋 Все трекеры</span>'
        + '<span class="folder-sidebar-item-count">' + allTrackers.filter(function (t) { return !hiddenGroups.has(t.productGroup); }).length + '</span>';
      allItem.addEventListener('click', function () {
        sidebarFilterGroup = null;
        sidebarSearchQuery = '';
        renderFolderSidebar();
        applyFilters();
        renderGrid();
      });
      list.appendChild(allItem);
    }

    // Group items
    visibleGroupNames.forEach(function (name) {
      var info = groupMap[name];
      var item = document.createElement('button');
      item.className = 'folder-sidebar-item' + (sidebarFilterGroup === name ? ' active' : '');
      item.dataset.groupName = name;
      var shortName = name.length > 28 ? name.slice(0, 28) + '…' : name;
      var priceHtml = info.bestPrice ? '<span class="folder-sidebar-item-price">💰 ' + formatPrice(info.bestPrice) + '</span>' : '';
      item.innerHTML = '<span class="folder-sidebar-item-name">📦 ' + escapeHtml(shortName) + '</span>'
        + priceHtml
        + '<span class="folder-sidebar-item-count">' + info.count + '</span>';
      item.title = name; // full name on hover
      item.addEventListener('click', function () {
        sidebarFilterGroup = name;
        renderFolderSidebar();
        applyFilters();
        renderGrid();
      });
      item.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showFolderContextMenu(e, name);
      });
      list.appendChild(item);
    });

    // Ungrouped item (hidden when searching)
    if (ungroupedCount > 0 && !query) {
      var ugItem = document.createElement('button');
      ugItem.className = 'folder-sidebar-item' + (sidebarFilterGroup === '__ungrouped__' ? ' active' : '');
      ugItem.dataset.groupName = '__ungrouped__';
      ugItem.innerHTML = '<span class="folder-sidebar-item-name">📎 Без группы</span>'
        + '<span class="folder-sidebar-item-count">' + ungroupedCount + '</span>';
      ugItem.addEventListener('click', function () {
        sidebarFilterGroup = '__ungrouped__';
        renderFolderSidebar();
        applyFilters();
        renderGrid();
      });
      list.appendChild(ugItem);
    }

    // Hidden groups toggle
    if (hiddenGroupNames.length > 0 && !query) {
      var toggleBtn = document.createElement('button');
      toggleBtn.className = 'folder-sidebar-item folder-sidebar-hidden-toggle';
      toggleBtn.innerHTML = '<span class="folder-sidebar-item-name">' + (showHiddenGroups ? '🙈 Скрыть скрытые' : '👁️ Скрытые папки') + '</span>'
        + '<span class="folder-sidebar-item-count">' + hiddenGroupNames.length + '</span>';
      toggleBtn.addEventListener('click', function () {
        showHiddenGroups = !showHiddenGroups;
        renderFolderSidebar();
      });
      list.appendChild(toggleBtn);

      if (showHiddenGroups) {
        hiddenGroupNames.forEach(function (name) {
          var info = groupMap[name];
          var item = document.createElement('button');
          item.className = 'folder-sidebar-item folder-sidebar-item-hidden' + (sidebarFilterGroup === name ? ' active' : '');
          item.dataset.groupName = name;
          var shortName = name.length > 28 ? name.slice(0, 28) + '…' : name;
          item.innerHTML = '<span class="folder-sidebar-item-name">🙈 ' + escapeHtml(shortName) + '</span>'
            + '<span class="folder-sidebar-item-count">' + info.count + '</span>';
          item.title = name;
          item.addEventListener('click', function () {
            sidebarFilterGroup = name;
            renderFolderSidebar();
            applyFilters();
            renderGrid();
          });
          item.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            showFolderContextMenu(e, name);
          });
          list.appendChild(item);
        });
      }
    }

    // Create folder button
    var createBtn = document.createElement('button');
    createBtn.className = 'folder-sidebar-create';
    createBtn.innerHTML = '+ Создать папку';
    createBtn.addEventListener('click', function () {
      var name = prompt('Название новой папки:');
      if (name && name.trim()) {
        emptyGroups.add(name.trim());
        renderFolderSidebar();
      }
    });
    list.appendChild(createBtn);
  }

  /**
   * Show context menu for a folder with management actions.
   */
  function showFolderContextMenu(event, groupName) {
    // Remove any existing context menu
    var old = document.querySelector('.folder-context-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.className = 'folder-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
    menu.style.zIndex = '10000';

    var trackersInGroup = allTrackers.filter(function (t) { return t.productGroup === groupName; });

    var isHidden = hiddenGroups.has(groupName);
    var actions = [
      { icon: '✏️', label: 'Переименовать', action: function () { renameFolderAction(groupName); } },
      { icon: '🔗', label: 'Открыть все (' + trackersInGroup.length + ')', action: function () { openFolderTabs(groupName); } },
      { icon: '☑️', label: 'Выделить все', action: function () { selectFolderTrackers(groupName); } },
      isHidden
        ? { icon: '👁️', label: 'Показать папку', action: function () { unhideFolderAction(groupName); } }
        : { icon: '🙈', label: 'Скрыть папку', action: function () { hideFolderAction(groupName); } },
      { icon: '🗑️', label: 'Удалить папку', danger: true, action: function () { deleteFolderAction(groupName); } },
    ];

    actions.forEach(function (a) {
      var btn = document.createElement('button');
      btn.className = 'folder-context-item' + (a.danger ? ' folder-context-danger' : '');
      btn.textContent = a.icon + ' ' + a.label;
      btn.addEventListener('click', function () {
        menu.remove();
        a.action();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Close on click outside
    function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    }
    setTimeout(function () { document.addEventListener('click', closeMenu, true); }, 0);
  }

  /**
   * Rename a folder (group) — updates all trackers in that group.
   */
  async function renameFolderAction(oldName) {
    var newName = prompt('Новое название папки:', oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    newName = newName.trim();

    var ids = allTrackers.filter(function (t) { return t.productGroup === oldName; }).map(function (t) { return t.id; });
    if (ids.length === 0) {
      // Empty folder — just rename in local set
      emptyGroups.delete(oldName);
      emptyGroups.add(newName);
      if (sidebarFilterGroup === oldName) sidebarFilterGroup = newName;
      renderFolderSidebar();
      showToast('✏️ Папка переименована', 'success');
      return;
    }

    showToast('✏️ Переименование...', 'info');
    try {
      var updates = ids.map(function (id) { return { id: id, data: { productGroup: newName } }; });
      await apiFetch(API_BASE + '/trackers/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: updates })
      });
      ids.forEach(function (id) {
        var t = allTrackers.find(function (tr) { return tr.id === id; });
        if (t) t.productGroup = newName;
      });
    } catch (e) {
      showToast('Ошибка переименования: ' + e.message, 'error');
      return;
    }
    emptyGroups.delete(oldName);
    if (sidebarFilterGroup === oldName) sidebarFilterGroup = newName;
    renderFolderSidebar();
    applyFilters();
    renderGrid();
    showToast('✏️ Папка «' + oldName + '» → «' + newName + '» (' + ids.length + ')', 'success');
  }

  /**
   * Delete a folder — removes group from all trackers (trackers stay, become ungrouped).
   */
  async function deleteFolderAction(groupName) {
    var ids = allTrackers.filter(function (t) { return t.productGroup === groupName; }).map(function (t) { return t.id; });

    if (ids.length === 0) {
      // Empty folder
      emptyGroups.delete(groupName);
      if (sidebarFilterGroup === groupName) sidebarFilterGroup = null;
      renderFolderSidebar();
      showToast('🗑️ Пустая папка удалена', 'success');
      return;
    }

    if (!confirm('Удалить папку «' + groupName + '»?\n\n' + ids.length + ' трекеров станут без группы.\nСами трекеры НЕ удаляются.')) return;

    showToast('🗑️ Удаление папки...', 'info');
    try {
      var updates = ids.map(function (id) { return { id: id, data: { productGroup: '' } }; });
      await apiFetch(API_BASE + '/trackers/batch', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: updates })
      });
      ids.forEach(function (id) {
        var t = allTrackers.find(function (tr) { return tr.id === id; });
        if (t) t.productGroup = '';
      });
    } catch (e) {
      showToast('Ошибка удаления папки: ' + e.message, 'error');
      return;
    }
    emptyGroups.delete(groupName);
    if (sidebarFilterGroup === groupName) sidebarFilterGroup = null;
    renderFolderSidebar();
    applyFilters();
    renderGrid();
    showToast('🗑️ Папка «' + groupName + '» удалена (' + ids.length + ' трекеров без группы)', 'success');
  }

  /**
   * Hide a folder — pauses all trackers in it and hides from sidebar.
   */
  async function hideFolderAction(groupName) {
    var trackersInGroup = allTrackers.filter(function (t) { return t.productGroup === groupName; });
    var activeIds = trackersInGroup.filter(function (t) { return t.status === 'active' || t.status === 'updated'; }).map(function (t) { return t.id; });

    hiddenGroups.add(groupName);
    saveHiddenGroups();

    // Pause active trackers in this group
    if (activeIds.length > 0) {
      try {
        var updates = activeIds.map(function (id) { return { id: id, data: { status: 'paused' } }; });
        await apiFetch(API_BASE + '/trackers/batch', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: updates })
        });
        activeIds.forEach(function (id) {
          var t = allTrackers.find(function (tr) { return tr.id === id; });
          if (t) t.status = 'paused';
        });
      } catch (e) {
        showToast('Ошибка при паузе трекеров: ' + e.message, 'error');
      }
    }

    if (sidebarFilterGroup === groupName) sidebarFilterGroup = null;
    renderFolderSidebar();
    applyFilters();
    renderGrid();
    showToast('🙈 Папка «' + groupName + '» скрыта' + (activeIds.length ? ' (' + activeIds.length + ' трекеров на паузе)' : ''), 'success');
  }

  /**
   * Unhide a folder — makes it visible again (trackers stay paused, user can resume manually).
   */
  function unhideFolderAction(groupName) {
    hiddenGroups.delete(groupName);
    saveHiddenGroups();
    renderFolderSidebar();
    applyFilters();
    renderGrid();
    showToast('👁️ Папка «' + groupName + '» снова видна', 'success');
  }

  /**
   * Open all tracker URLs in a folder in new tabs.
   */
  function openFolderTabs(groupName) {
    var urls = allTrackers
      .filter(function (t) { return t.productGroup === groupName && t.pageUrl; })
      .map(function (t) { return t.pageUrl; });
    if (urls.length === 0) { showToast('Нет URL для открытия', 'error'); return; }
    if (urls.length > 10 && !confirm('Открыть ' + urls.length + ' вкладок?')) return;
    urls.forEach(function (url) { window.open(url, '_blank'); });
    showToast('🔗 Открыто ' + urls.length + ' вкладок', 'success');
  }

  /**
   * Select all trackers in a folder (enter select mode).
   */
  function selectFolderTrackers(groupName) {
    var ids = allTrackers.filter(function (t) { return t.productGroup === groupName; }).map(function (t) { return t.id; });
    if (ids.length === 0) return;
    selectMode = true;
    selectedIds.clear();
    ids.forEach(function (id) { selectedIds.add(id); });
    sidebarFilterGroup = groupName;
    renderFolderSidebar();
    applyFilters();
    renderGrid();
    updateBulkBar();
  }

  function initFolderSidebar() {
    var toggleBtn = document.getElementById('folder-sidebar-toggle');
    var sidebar = document.getElementById('folder-sidebar');
    if (!toggleBtn || !sidebar) return;

    // Restore collapsed state from localStorage
    var SIDEBAR_KEY = 'priceTracker_sidebarCollapsed';
    try {
      if (localStorage.getItem(SIDEBAR_KEY) === 'true') {
        sidebar.classList.add('collapsed');
      }
    } catch (_) {}

    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      try {
        localStorage.setItem(SIDEBAR_KEY, sidebar.classList.contains('collapsed'));
      } catch (_) {}
    });
  }

  // ─── Drag & Drop to Sidebar Folders ────────────────────────────

  var dragState = null; // { trackerIds: [], ghost: HTMLElement }

  function initDragAndDrop() {
    document.addEventListener('mousedown', onDragMouseDown);
  }

  function onDragMouseDown(e) {
    var card = e.target.closest('.tracker-card');
    if (!card) return;
    if (e.target.closest('.tracker-card-refresh') || e.target.closest('.tracker-card-checkbox') || e.target.closest('.btn-icon')) return;
    if (e.button !== 0) return;

    var trackerId = card.dataset.trackerId;
    if (!trackerId) return;

    var ids = [];
    if (selectMode && selectedIds.size > 0 && selectedIds.has(Number(trackerId))) {
      ids = Array.from(selectedIds);
    } else {
      ids = [Number(trackerId)];
    }

    dragState = {
      trackerIds: ids,
      startX: e.clientX,
      startY: e.clientY,
      ghost: null,
      dragging: false,
      sourceCard: card,
      rafId: null,
      lastX: e.clientX,
      lastY: e.clientY,
    };

    // Bind move/up only while mouse is down (avoids constant listeners)
    document.addEventListener('mousemove', onDragMouseMove);
    document.addEventListener('mouseup', onDragMouseUp);
  }

  function onDragMouseMove(e) {
    if (!dragState) return;

    if (!dragState.dragging) {
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;

      // Prevent text selection
      e.preventDefault();
      dragState.dragging = true;
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      dragState.sourceCard.classList.add('dragging');
      createDragGhost(e);

      // Expand sidebar if collapsed
      var sidebar = document.getElementById('folder-sidebar');
      if (sidebar && sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        renderFolderSidebar();
      }
    }

    if (!dragState.dragging) return;
    e.preventDefault();

    // Store position, use rAF for smooth ghost movement
    dragState.lastX = e.clientX;
    dragState.lastY = e.clientY;

    if (!dragState.rafId) {
      dragState.rafId = requestAnimationFrame(function () {
        dragState.rafId = null;
        if (!dragState || !dragState.ghost) return;
        dragState.ghost.style.transform = 'translate(' + (dragState.lastX + 12) + 'px,' + (dragState.lastY - 20) + 'px) rotate(2deg) scale(0.8)';
      });
    }

    // Highlight sidebar item under cursor
    var sidebarItems = document.querySelectorAll('.folder-sidebar-item');
    for (var i = 0; i < sidebarItems.length; i++) {
      var rect = sidebarItems[i].getBoundingClientRect();
      var isOver = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      sidebarItems[i].classList.toggle('drag-over', isOver);
    }
  }

  function onDragMouseUp(e) {
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragMouseUp);

    if (!dragState) return;

    // Restore text selection
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';

    if (dragState.dragging) {
      var dropTarget = document.querySelector('.folder-sidebar-item.drag-over');
      if (dropTarget) {
        var groupName = dropTarget.dataset.groupName || '';
        if (groupName !== '__all__') {
          var targetGroup = groupName === '__ungrouped__' ? '' : groupName;
          applyDragDrop(dragState.trackerIds, targetGroup);
        }
      }

      dragState.sourceCard.classList.remove('dragging');
      if (dragState.ghost) dragState.ghost.remove();
      if (dragState.rafId) cancelAnimationFrame(dragState.rafId);
      document.querySelectorAll('.folder-sidebar-item.drag-over').forEach(function (el) {
        el.classList.remove('drag-over');
      });
    }

    dragState = null;
  }

  function createDragGhost(e) {
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost';

    // Show first tracker's image or name
    var tracker = allTrackers.find(function (t) { return t.id === dragState.trackerIds[0]; });
    if (tracker && tracker.imageUrl) {
      var img = document.createElement('img');
      img.src = tracker.imageUrl;
      img.style.cssText = 'width:100%;height:80px;object-fit:cover;display:block';
      ghost.appendChild(img);
    }
    var label = document.createElement('div');
    label.style.cssText = 'padding:6px 10px;font-size:11px;color:var(--text-primary);background:var(--bg-card)';
    label.textContent = (tracker ? tracker.productName : '').slice(0, 30);
    ghost.appendChild(label);

    // Count badge if multiple
    if (dragState.trackerIds.length > 1) {
      var badge = document.createElement('div');
      badge.className = 'drag-count-badge';
      badge.textContent = dragState.trackerIds.length;
      ghost.appendChild(badge);
    }

    ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY - 20) + 'px) rotate(2deg) scale(0.8)';
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
  }

  async function applyDragDrop(trackerIds, groupName) {
    for (var i = 0; i < trackerIds.length; i++) {
      try {
        await sendMessage({ action: 'updateTracker', trackerId: trackerIds[i], data: { productGroup: groupName } });
        var t = allTrackers.find(function (t) { return t.id === trackerIds[i]; });
        if (t) t.productGroup = groupName;
      } catch (_) {}
    }
    var msg = groupName ? '📦 Перемещено в "' + groupName + '"' : '📎 Убрано из группы';
    showRefreshStatus(msg + ' (' + trackerIds.length + ')', false);
    setTimeout(hideRefreshStatus, 3000);
    // Reset selection after successful drag
    selectedIds.clear();
    selectMode = false;
    applyFilters();
    renderGrid();
    updateBulkBar();
    renderFolderSidebar();
  }

  // ─── Card Context Menu ───────────────────────────────────────────

  function initCardContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      var card = e.target.closest('.tracker-card');
      if (!card) return;
      e.preventDefault();

      var trackerId = Number(card.dataset.trackerId);
      var tracker = allTrackers.find(function (t) { return t.id === trackerId; });
      if (!tracker) return;

      // Remove any existing context menu
      var existing = document.querySelector('.card-context-menu');
      if (existing) existing.remove();

      var menu = document.createElement('div');
      menu.className = 'card-context-menu';

      // Open on site
      var openItem = document.createElement('button');
      openItem.className = 'card-context-item';
      openItem.textContent = '🔗 Открыть на сайте';
      openItem.addEventListener('click', function () {
        menu.remove();
        window.open(tracker.pageUrl, '_blank');
      });
      menu.appendChild(openItem);

      // Pause / Resume
      var pauseItem = document.createElement('button');
      pauseItem.className = 'card-context-item';
      pauseItem.textContent = tracker.status === 'paused' ? '▶ Возобновить' : '⏸ Пауза';
      pauseItem.addEventListener('click', function () {
        menu.remove();
        var newStatus = tracker.status === 'paused' ? 'active' : 'paused';
        sendMessage({ action: 'updateTracker', trackerId: tracker.id, data: { status: newStatus } })
          .then(function () {
            tracker.status = newStatus;
            applyFilters();
            renderGrid();
          })
          .catch(function () {});
      });
      menu.appendChild(pauseItem);

      // Move to folder
      var moveItem = document.createElement('button');
      moveItem.className = 'card-context-item';
      moveItem.textContent = '📦 Переместить в папку';
      moveItem.addEventListener('click', function () {
        menu.remove();
        // Use bulk group picker for single tracker
        selectedIds.clear();
        selectedIds.add(tracker.id);
        showBulkGroupPicker();
      });
      menu.appendChild(moveItem);

      // Star / Unstar
      var starItem = document.createElement('button');
      starItem.className = 'card-context-item';
      starItem.textContent = tracker.starred ? '⭐ Убрать из избранного' : '⭐ В избранное';
      starItem.addEventListener('click', function () {
        menu.remove();
        var newStarred = !tracker.starred;
        sendMessage({ action: 'updateTracker', trackerId: tracker.id, data: { starred: newStarred } })
          .then(function () {
            tracker.starred = newStarred;
            var starBtn = card.querySelector('.tracker-card-star');
            if (starBtn) {
              starBtn.classList.toggle('starred', newStarred);
              starBtn.textContent = newStarred ? '⭐' : '☆';
            }
          })
          .catch(function () {});
      });
      menu.appendChild(starItem);

      // Delete
      var deleteItem = document.createElement('button');
      deleteItem.className = 'card-context-item card-context-danger';
      deleteItem.textContent = '🗑️ Удалить';
      deleteItem.addEventListener('click', function () {
        menu.remove();
        if (!confirm('Удалить трекер "' + (tracker.productName || '') + '"?')) return;
        sendMessage({ action: 'deleteTracker', trackerId: tracker.id })
          .then(function () {
            onTrackerDeleted(tracker.id);
          })
          .catch(function () {});
      });
      menu.appendChild(deleteItem);

      document.body.appendChild(menu);
      menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10) + 'px';
      menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';

      setTimeout(function () {
        document.addEventListener('click', function closeMenu() {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        });
      }, 0);
    });
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

    var hasSelection = selectedIds.size > 0;
    var allSelected = selectedIds.size === filteredTrackers.length && filteredTrackers.length > 0;

    // Single compact row
    var row = document.createElement('div');
    row.className = 'bulk-bar-row';

    var countSpan = document.createElement('span');
    countSpan.className = 'bulk-bar-count';
    countSpan.textContent = 'Выбрано: ' + selectedIds.size;
    row.appendChild(countSpan);

    if (hasSelection) {
      row.appendChild(createBulkSep());

      var groupBtn = document.createElement('button');
      groupBtn.className = 'btn btn-primary btn-sm';
      groupBtn.textContent = '📦 В папку';
      groupBtn.addEventListener('click', function () { showBulkGroupPicker(); });
      row.appendChild(groupBtn);

      var refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn btn-sm';
      refreshBtn.textContent = '🔄';
      refreshBtn.title = 'Обновить выбранные';
      refreshBtn.addEventListener('click', function () { bulkAction('refresh'); });
      row.appendChild(refreshBtn);

      var pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-sm';
      pauseBtn.textContent = '⏸';
      pauseBtn.title = 'Приостановить';
      pauseBtn.addEventListener('click', function () { bulkAction('pause'); });
      row.appendChild(pauseBtn);

      var resumeBtn = document.createElement('button');
      resumeBtn.className = 'btn btn-sm';
      resumeBtn.textContent = '▶';
      resumeBtn.title = 'Возобновить';
      resumeBtn.addEventListener('click', function () { bulkAction('resume'); });
      row.appendChild(resumeBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-danger btn-sm';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Удалить';
      deleteBtn.addEventListener('click', function () { bulkAction('delete'); });
      row.appendChild(deleteBtn);

      var intervalBtn = document.createElement('button');
      intervalBtn.className = 'btn btn-sm';
      intervalBtn.textContent = '⏱';
      intervalBtn.title = 'Интервал';
      intervalBtn.addEventListener('click', function () { showBulkIntervalPicker(); });
      row.appendChild(intervalBtn);

      var openTabsBtn = document.createElement('button');
      openTabsBtn.className = 'btn btn-sm';
      openTabsBtn.textContent = '🔗';
      openTabsBtn.title = 'Открыть в новых вкладках';
      openTabsBtn.addEventListener('click', function () { bulkOpenTabs(); });
      row.appendChild(openTabsBtn);
    }

    row.appendChild(createBulkSep());

    var toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.textContent = allSelected ? 'Снять все' : 'Выбрать все';
    toggleBtn.addEventListener('click', function () {
      if (allSelected) { selectedIds.clear(); }
      else { filteredTrackers.forEach(function (t) { selectedIds.add(t.id); }); }
      applyFilters(); renderGrid(); updateBulkBar();
    });
    row.appendChild(toggleBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm';
    cancelBtn.textContent = '✕';
    cancelBtn.title = 'Выйти из режима выбора';
    cancelBtn.addEventListener('click', function () {
      selectMode = false; selectedIds.clear();
      applyFilters(); renderGrid(); updateBulkBar();
    });
    row.appendChild(cancelBtn);

    existing.appendChild(row);

    // Progress bar
    var progressContainer = document.createElement('div');
    progressContainer.id = 'bulk-progress';
    progressContainer.className = 'bulk-progress';
    progressContainer.style.display = 'none';
    progressContainer.innerHTML = '<div class="bulk-progress-bar"><div class="bulk-progress-fill"></div></div>'
      + '<span class="bulk-progress-text"></span>';
    existing.appendChild(progressContainer);
  }

  function createBulkSep() {
    var sep = document.createElement('div');
    sep.className = 'bulk-bar-sep';
    return sep;
  }

  /**
   * Show a group picker dropdown for bulk assigning a group.
   */
  function showBulkGroupPicker() {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Collect existing groups
    var existingGroups = {};
    allTrackers.forEach(function (t) {
      if (t.productGroup) existingGroups[t.productGroup] = true;
    });
    var groupList = Object.keys(existingGroups).sort();

    // Build modal
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.setAttribute('data-testid', 'bulk-group-overlay');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Назначить группу');

    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = 'Назначить группу (' + ids.length + ' трекеров)';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.type = 'button';
    closeBtn.innerHTML = (typeof Icons !== 'undefined') ? Icons.el('close', 20) : '×';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'modal-body';

    // New group input
    var newGroupLabel = document.createElement('label');
    newGroupLabel.textContent = 'Новая группа';
    var newGroupInput = document.createElement('input');
    newGroupInput.type = 'text';
    newGroupInput.className = 'input';
    newGroupInput.placeholder = 'Введите название новой группы';
    body.appendChild(newGroupLabel);
    body.appendChild(newGroupInput);

    // Existing groups list
    if (groupList.length > 0) {
      var existLabel = document.createElement('label');
      existLabel.textContent = 'Или выберите существующую';
      existLabel.style.marginTop = 'var(--spacing-md)';
      body.appendChild(existLabel);

      var listEl = document.createElement('div');
      listEl.className = 'bulk-group-list';
      groupList.forEach(function (gName) {
        var item = document.createElement('button');
        item.className = 'btn bulk-group-item';
        item.textContent = gName;
        item.addEventListener('click', function () {
          applyBulkGroup(ids, gName);
          overlay.remove();
        });
        listEl.appendChild(item);
      });
      body.appendChild(listEl);
    }

    // Remove from group option
    var removeLabel = document.createElement('label');
    removeLabel.textContent = 'Или';
    removeLabel.style.marginTop = 'var(--spacing-md)';
    body.appendChild(removeLabel);
    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn';
    removeBtn.textContent = '📎 Убрать из группы';
    removeBtn.addEventListener('click', function () {
      applyBulkGroup(ids, '');
      overlay.remove();
    });
    body.appendChild(removeBtn);

    var footer = document.createElement('div');
    footer.className = 'modal-footer';
    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Создать и назначить';
    saveBtn.addEventListener('click', function () {
      var name = newGroupInput.value.trim();
      if (!name) return;
      applyBulkGroup(ids, name);
      overlay.remove();
    });
    footer.appendChild(saveBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    modalContainer.appendChild(overlay);
    newGroupInput.focus();
  }

  /**
   * Apply a group name to multiple trackers.
   */
  async function applyBulkGroup(ids, groupName) {
    showBulkProgress(0, ids.length, 'Назначение группы...');
    for (var i = 0; i < ids.length; i++) {
      try {
        await sendMessage({ action: 'updateTracker', trackerId: ids[i], data: { productGroup: groupName } });
        var t = allTrackers.find(function (t) { return t.id === ids[i]; });
        if (t) t.productGroup = groupName;
      } catch (_) {}
      showBulkProgress(i + 1, ids.length, 'Назначение группы...');
    }
    hideBulkProgress();
    showRefreshStatus('📦 Группа назначена: ' + (groupName || 'убрана') + ' (' + ids.length + ' трекеров)', false);
    setTimeout(hideRefreshStatus, 5000);
    selectedIds.clear();
    selectMode = false;
    updateBulkBar();
    await loadTrackers();
  }

  /**
   * Show a modal with interval options for bulk interval change.
   */
  function showBulkIntervalPicker() {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Изменить интервал');

    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = 'Интервал проверки (' + ids.length + ' трекеров)';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.type = 'button';
    closeBtn.innerHTML = (typeof Icons !== 'undefined') ? Icons.el('close', 20) : '×';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'modal-body';

    var intervals = [
      { value: 3, label: '3 часа' },
      { value: 6, label: '6 часов' },
      { value: 12, label: '12 часов' },
      { value: 24, label: '24 часа' },
    ];

    var optionsDiv = document.createElement('div');
    optionsDiv.className = 'bulk-interval-options';

    intervals.forEach(function (opt) {
      var label = document.createElement('label');
      label.className = 'bulk-interval-option';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'bulk-interval';
      radio.value = opt.value;
      if (opt.value === 3) radio.checked = true;
      label.appendChild(radio);
      var span = document.createElement('span');
      span.textContent = opt.label;
      label.appendChild(span);
      optionsDiv.appendChild(label);
    });

    body.appendChild(optionsDiv);

    var footer = document.createElement('div');
    footer.className = 'modal-footer';
    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = 'Применить';
    applyBtn.addEventListener('click', async function () {
      var selected = overlay.querySelector('input[name="bulk-interval"]:checked');
      if (!selected) return;
      var hours = Number(selected.value);
      overlay.remove();
      showBulkProgress(0, ids.length, 'Изменение интервала...');
      for (var i = 0; i < ids.length; i++) {
        try {
          await sendMessage({ action: 'updateTracker', trackerId: ids[i], data: { checkIntervalHours: hours } });
          var t = allTrackers.find(function (t) { return t.id === ids[i]; });
          if (t) t.checkIntervalHours = hours;
        } catch (_) {}
        showBulkProgress(i + 1, ids.length, 'Изменение интервала...');
      }
      hideBulkProgress();
      showToast('⏱ Интервал изменён на ' + hours + 'ч (' + ids.length + ' трекеров)', 'success');
      selectedIds.clear();
      selectMode = false;
      updateBulkBar();
      applyFilters();
      renderGrid();
    });
    footer.appendChild(applyBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    modalContainer.appendChild(overlay);
  }

  /**
   * Open all selected trackers in new browser tabs.
   */
  function bulkOpenTabs() {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    // Collect URLs from selected trackers
    var urls = [];
    ids.forEach(function (id) {
      var t = allTrackers.find(function (tr) { return tr.id === id; });
      if (t && t.pageUrl) urls.push(t.pageUrl);
    });

    if (urls.length === 0) {
      showToast('Нет URL для открытия', 'error');
      return;
    }

    // Warn if opening many tabs
    if (urls.length > 10) {
      if (!confirm('Открыть ' + urls.length + ' вкладок?')) return;
    }

    urls.forEach(function (url) {
      window.open(url, '_blank');
    });

    showToast('🔗 Открыто ' + urls.length + ' вкладок', 'success');
  }

  function showBulkProgress(current, total, text) {
    var el = document.getElementById('bulk-progress');
    if (!el) return;
    el.style.display = '';
    var fill = el.querySelector('.bulk-progress-fill');
    var label = el.querySelector('.bulk-progress-text');
    var pct = total > 0 ? (current / total * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (label) label.textContent = text + ' ' + current + '/' + total;
  }

  function hideBulkProgress() {
    var el = document.getElementById('bulk-progress');
    if (el) el.style.display = 'none';
  }

  async function bulkAction(action) {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    if (action === 'delete') {
      if (!confirm('Удалить ' + ids.length + ' трекеров?')) return;
    }

    if (action === 'refresh') {
      showBulkProgress(0, ids.length, 'Обновление цен...');

      var result = await runConcurrent(ids, 3, function (id) {
        return sendMessage({ action: 'checkPriceExtension', trackerId: id });
      }, function (done, total) {
        showBulkProgress(done, total, 'Обновление цен...');
      });

      hideBulkProgress();
      var msg = '✅ Обновлено: ' + (ids.length - result.errors) + '/' + ids.length;
      if (result.errors > 0) msg += ' (ошибок: ' + result.errors + ')';
      showRefreshStatus(msg, false);
      setTimeout(hideRefreshStatus, 5000);
      await loadTrackers();

      selectedIds.clear();
      selectMode = false;
      applyFilters();
      renderGrid();
      updateBulkBar();
      return;
    }

    // Sequential for non-refresh actions (delete, pause, resume)
    var errors = 0;
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
      } catch (_) {
        errors++;
      }
    }

    selectedIds.clear();
    selectMode = false;
    applyFilters();
    renderGrid();
    updateBulkBar();
  }

  // ─── Auto-Group ──────────────────────────────────────────────────

  async function handleAutoGroup() {
    var btn = document.getElementById('toolbar-autogroup-btn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="save-spinner"></span> Анализ...';
    }

    try {
      // First: silently assign to existing groups
      var quickRes = await apiFetch(API_BASE + '/trackers/auto-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      var quickResult = await quickRes.json();
      var quickMsg = '';
      if (quickResult.grouped > 0) {
        quickMsg = '✅ Добавлено в существующие группы: ' + quickResult.grouped;
      }

      // Then: get suggestions for remaining ungrouped
      var suggestRes = await apiFetch(API_BASE + '/trackers/auto-group/suggest');
      var suggestions = await suggestRes.json();

      if (suggestions.newGroupSuggestions && suggestions.newGroupSuggestions.length > 0) {
        // Show suggestion modal
        showAutoGroupSuggestions(suggestions, quickMsg);
      } else {
        if (quickMsg) {
          showRefreshStatus(quickMsg, false);
        } else {
          showRefreshStatus('📦 Все трекеры уже сгруппированы или нет совпадений', false);
        }
        setTimeout(hideRefreshStatus, 5000);
        await loadTrackers();
      }
    } catch (err) {
      showRefreshStatus('Ошибка: ' + (err.message || ''), false);
      setTimeout(hideRefreshStatus, 5000);
    } finally {
      if (btn) {
        btn.disabled = false;
        var pkgIcon = (typeof Icons !== 'undefined') ? Icons.el('package', 16) : '📦';
        btn.innerHTML = pkgIcon + ' Группы';
      }
    }
  }

  /**
   * Show a modal with auto-group suggestions for user to approve/reject.
   */
  function showAutoGroupSuggestions(suggestions, preMessage) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '600px';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Предложения группировки');

    // Header
    var header = document.createElement('div');
    header.className = 'modal-header';
    var title = document.createElement('h2');
    title.textContent = '📦 Предложения группировки';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.innerHTML = (typeof Icons !== 'undefined') ? Icons.el('close', 20) : '×';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement('div');
    body.className = 'modal-body';

    if (preMessage) {
      var preMsg = document.createElement('p');
      preMsg.className = 'settings-info-note';
      preMsg.textContent = preMessage;
      preMsg.style.marginBottom = 'var(--spacing-md)';
      body.appendChild(preMsg);
    }

    var newSuggestions = suggestions.newGroupSuggestions || [];
    if (newSuggestions.length === 0) {
      var noSugg = document.createElement('p');
      noSugg.textContent = 'Нет предложений для новых групп.';
      body.appendChild(noSugg);
    }

    // Track which suggestions are accepted
    var accepted = new Set();
    // Track custom names per suggestion index
    var customNames = {};

    newSuggestions.forEach(function (sugg, idx) {
      var card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'padding:var(--spacing-md);margin-bottom:var(--spacing-sm)';

      // Checkbox + group name
      var topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;gap:var(--spacing-sm);margin-bottom:var(--spacing-xs)';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      accepted.add(idx);
      cb.addEventListener('change', function () {
        if (cb.checked) accepted.add(idx); else accepted.delete(idx);
      });

      var nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'input';
      nameInput.value = sugg.suggestedName;
      nameInput.style.cssText = 'flex:1;font-weight:600';
      nameInput.addEventListener('input', function () {
        customNames[idx] = nameInput.value.trim();
      });

      topRow.appendChild(cb);
      topRow.appendChild(nameInput);
      card.appendChild(topRow);

      // Tracker list
      var trackerList = document.createElement('div');
      trackerList.style.cssText = 'font-size:12px;color:var(--text-muted);padding-left:28px';
      sugg.trackers.forEach(function (t) {
        var line = document.createElement('div');
        line.textContent = '• ' + (t.name || '').slice(0, 60);
        trackerList.appendChild(line);
      });
      card.appendChild(trackerList);

      body.appendChild(card);
    });

    // Footer
    var footer = document.createElement('div');
    footer.className = 'modal-footer';

    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary';
    applyBtn.textContent = 'Применить выбранные';
    applyBtn.addEventListener('click', async function () {
      applyBtn.disabled = true;
      applyBtn.innerHTML = '<span class="save-spinner"></span>';

      var assignments = [];
      newSuggestions.forEach(function (sugg, idx) {
        if (!accepted.has(idx)) return;
        var groupName = customNames[idx] || sugg.suggestedName;
        sugg.trackers.forEach(function (t) {
          assignments.push({ trackerId: t.id, groupName: groupName });
        });
      });

      if (assignments.length > 0) {
        try {
          await apiFetch(API_BASE + '/trackers/auto-group/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments: assignments }),
          });
        } catch (_) {}
      }

      overlay.remove();
      showRefreshStatus('📦 Группировка применена: ' + assignments.length + ' трекеров', false);
      setTimeout(hideRefreshStatus, 5000);
      await loadTrackers();
    });

    var skipBtn = document.createElement('button');
    skipBtn.className = 'btn';
    skipBtn.textContent = 'Пропустить';
    skipBtn.addEventListener('click', function () {
      overlay.remove();
      loadTrackers();
    });

    footer.appendChild(skipBtn);
    footer.appendChild(applyBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    modalContainer.appendChild(overlay);
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
              await apiFetch(API_BASE + '/trackers', {
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
          showToast('Импортировано: ' + count + ' трекеров', 'success');
          loadTrackers();
        } catch (e) {
          showToast('Ошибка импорта: ' + e.message, 'error');
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
        var res = await apiFetch(API_BASE + '/priceHistory?trackerId=' + encodeURIComponent(tid));
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

  // ─── Toast Notifications ──────────────────────────────────────────

  /**
   * Show a toast notification at the bottom-center of the screen.
   * @param {string} message - The message to display
   * @param {string} [type='info'] - 'success', 'error', or 'info'
   */
  function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    var textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);
    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', function () {
      toast.classList.add('toast-exit');
      setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
    });
    toast.appendChild(closeBtn);
    document.body.appendChild(toast);
    // Trigger enter animation
    requestAnimationFrame(function () { toast.classList.add('toast-enter'); });
    // Auto-dismiss after 3 seconds
    setTimeout(function () {
      if (toast.parentNode) {
        toast.classList.add('toast-exit');
        setTimeout(function () { if (toast.parentNode) toast.remove(); }, 300);
      }
    }, 3000);
  }

  // ─── Mark All Read ──────────────────────────────────────────────

  /**
   * Mark all trackers with status 'updated' or unread=true as read.
   */
  async function handleMarkAllRead() {
    var unreadTrackers = allTrackers.filter(function (t) {
      return t.status === 'updated' || t.unread === true;
    });
    if (unreadTrackers.length === 0) {
      showToast('Нет непрочитанных уведомлений', 'info');
      return;
    }
    for (var i = 0; i < unreadTrackers.length; i++) {
      try {
        await sendMessage({ action: 'markAsRead', trackerId: unreadTrackers[i].id });
        unreadTrackers[i].unread = false;
        if (unreadTrackers[i].status === 'updated') {
          unreadTrackers[i].status = 'active';
        }
      } catch (_) {}
    }
    applyFilters();
    renderGrid();
    updateFaviconBadge();
    showToast('Отмечено как прочитанные: ' + unreadTrackers.length, 'success');
  }

  // ─── Pagination ─────────────────────────────────────────────────

  var displayCount = 50;

  /**
   * Highlight search query matches in tracker card names.
   */
  function highlightSearchMatches() {
    if (!searchQuery) return;
    var names = trackerGrid.querySelectorAll('.tracker-card-name');
    var query = searchQuery.toLowerCase();
    names.forEach(function (el) {
      var text = el.textContent;
      var lowerText = text.toLowerCase();
      var idx = lowerText.indexOf(query);
      if (idx === -1) return;
      var before = escapeHtml(text.slice(0, idx));
      var match = text.slice(idx, idx + query.length);
      var after = escapeHtml(text.slice(idx + query.length));
      el.innerHTML = before + '<mark>' + escapeHtml(match) + '</mark>' + after;
    });
  }

  /**
   * Render "Load more" button if there are more trackers to show.
   */
  function renderLoadMoreButton() {
    var existing = trackerGrid.querySelector('.load-more-btn');
    if (existing) existing.remove();
    if (displayCount >= filteredTrackers.length) return;
    var btn = document.createElement('button');
    btn.className = 'btn load-more-btn';
    btn.style.cssText = 'grid-column:1/-1;margin:var(--spacing-lg) auto;display:block';
    btn.textContent = 'Показать ещё (' + (filteredTrackers.length - displayCount) + ' осталось)';
    btn.addEventListener('click', function () {
      displayCount += 50;
      applyFilters();
      renderGrid();
    });
    trackerGrid.appendChild(btn);
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
        onSort: onSortChange,
        onRefreshAll: handleRefreshAll,
        onRefreshExtension: handleExtensionRefresh,
        onAutoGroup: handleAutoGroup,
        onMarkAllRead: handleMarkAllRead,
        onSettingsClick: () => {
          if (typeof GlobalSettings !== 'undefined' && GlobalSettings.open) {
            GlobalSettings.open(modalContainer);
          }
        },
        onExport: handleExport,
        onImport: handleImport,
        onSelectMode: toggleSelectMode,
        onGroupSelect: onGroupSelect,
      });
    }

    // Initialise ripple effect for all .btn elements
    initRipple();

    // Initialise folder sidebar
    initFolderSidebar();

    // Initialise drag & drop
    initDragAndDrop();

    // Initialise right-click context menu on tracker cards
    initCardContextMenu();
    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Ctrl+F — focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        var searchInput = document.querySelector('.toolbar-search-input');
        if (searchInput) searchInput.focus();
      }
      // Ctrl+A — select all (in select mode)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && selectMode) {
        e.preventDefault();
        filteredTrackers.forEach(function (t) { selectedIds.add(t.id); });
        applyFilters(); renderGrid(); updateBulkBar();
      }
      // Delete — delete selected
      if (e.key === 'Delete' && selectMode && selectedIds.size > 0) {
        e.preventDefault();
        bulkAction('delete');
      }
      // Escape — exit select mode or close modal
      if (e.key === 'Escape') {
        if (selectMode) {
          selectMode = false; selectedIds.clear();
          applyFilters(); renderGrid(); updateBulkBar();
        }
        var modal = document.querySelector('.modal-overlay.active');
        if (modal) modal.remove();
      }
    });

    // Load trackers
    loadTrackers();

    // Listen for tracker updates from the service worker (e.g. variant price corrections)
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.action !== 'trackerUpdated') return;
      var tid = message.trackerId;
      if (!tid) return;
      // Reload the updated tracker from API and refresh its card
      apiFetch(API_BASE + '/trackers/' + encodeURIComponent(tid))
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
    onSortChange,
    onCardClick,
    onTrackerUpdated,
    onTrackerDeleted,
    onGroupSelect,
    handleServerRefresh,
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
    getSortBy: () => sortBy,
    // Allow setting state for testing
    _setTrackers: (trackers) => { allTrackers = trackers; },
    _setSearchQuery: (q) => { searchQuery = q; },
    _setPriceFilter: (f) => { priceFilter = f; },
    _setSortBy: (s) => { sortBy = s; },
    toggleSelectMode,
    bulkAction,
    showToast,
    handleMarkAllRead,
    updateFaviconBadge,
  };
})();

// ─── Exports for CommonJS (Jest tests) ──────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Dashboard;
}

/**
 * Toolbar component for Price Tracker Extension dashboard.
 *
 * Renders a toolbar with:
 * - "Обновить все" button with refresh SVG icon — triggers server-side price check
 * - Search input with search SVG icon — filters cards by product name (case-insensitive)
 * - Custom styled filter dropdown — all / price down / price up / groups
 * - Custom styled sort dropdown
 * - Group filter chips (when "groups" filter is active)
 * - Settings SVG icon button — opens global settings
 *
 * Usage: Toolbar.init(container, { onSearch, onFilter, onRefreshAll, onSettingsClick, onGroupSelect })
 *
 * Requirements: 2.4, 2.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

const Toolbar = (function () {
  // ─── Icons reference (global in browser, require in Node/Jest) ────
  var _Icons = (typeof Icons !== 'undefined') ? Icons
             : (typeof require === 'function' ? require('../../shared/icons') : null);

  // ─── SortEngine reference (global in browser, require in Node/Jest) ──
  var _sortEngine = (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.sortEngine)
    ? self.PriceTracker.sortEngine
    : (typeof require === 'function' ? require('./sortEngine') : null);

  var SORT_STORAGE_KEY = 'priceTracker_sortBy';

  // ─── Custom Dropdown Component ────────────────────────────────────

  /**
   * Create a custom styled dropdown that replaces native <select>.
   * @param {Object} opts
   * @param {Array<{value:string, text:string, icon?:string}>} opts.options
   * @param {string} opts.selected - initial selected value
   * @param {string} opts.ariaLabel
   * @param {string} [opts.className] - extra CSS class
   * @param {Function} opts.onChange - callback(value)
   * @returns {HTMLElement}
   */
  function createCustomDropdown(opts) {
    var wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown' + (opts.className ? ' ' + opts.className : '');
    wrapper.setAttribute('role', 'listbox');
    wrapper.setAttribute('aria-label', opts.ariaLabel || '');
    wrapper.tabIndex = 0;

    var selectedOpt = opts.options.find(function (o) { return o.value === opts.selected; }) || opts.options[0];

    // Trigger button
    var trigger = document.createElement('div');
    trigger.className = 'custom-dropdown-trigger';
    trigger.innerHTML = '<span class="custom-dropdown-text">' + escapeHtml(selectedOpt.text) + '</span>'
      + '<span class="custom-dropdown-arrow">' + (_Icons ? _Icons.el('arrow-down', 12) : '▾') + '</span>';

    // Dropdown menu
    var menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';

    opts.options.forEach(function (opt) {
      var item = document.createElement('div');
      item.className = 'custom-dropdown-item' + (opt.value === selectedOpt.value ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.value === selectedOpt.value ? 'true' : 'false');
      item.setAttribute('data-value', opt.value);
      item.textContent = opt.text;
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        // Update selection
        menu.querySelectorAll('.custom-dropdown-item').forEach(function (el) {
          el.classList.remove('active');
          el.setAttribute('aria-selected', 'false');
        });
        item.classList.add('active');
        item.setAttribute('aria-selected', 'true');
        trigger.querySelector('.custom-dropdown-text').textContent = opt.text;
        wrapper.classList.remove('open');
        wrapper.setAttribute('data-value', opt.value);
        if (typeof opts.onChange === 'function') opts.onChange(opt.value);
      });
      menu.appendChild(item);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    wrapper.setAttribute('data-value', selectedOpt.value);

    // Toggle open/close
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      // Close all other dropdowns first
      document.querySelectorAll('.custom-dropdown.open').forEach(function (dd) {
        if (dd !== wrapper) dd.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    // Keyboard navigation
    wrapper.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        wrapper.classList.toggle('open');
      } else if (e.key === 'Escape') {
        wrapper.classList.remove('open');
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var items = menu.querySelectorAll('.custom-dropdown-item');
        var currentIdx = -1;
        items.forEach(function (el, i) { if (el.classList.contains('active')) currentIdx = i; });
        var nextIdx = e.key === 'ArrowDown'
          ? Math.min(currentIdx + 1, items.length - 1)
          : Math.max(currentIdx - 1, 0);
        if (items[nextIdx]) items[nextIdx].click();
      }
    });

    return wrapper;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ─── State ────────────────────────────────────────────────────────
  var _groupChipsContainer = null;
  var _currentGroups = [];
  var _callbacks = {};

  /**
   * Initialise the toolbar inside the given container element.
   */
  function init(container, callbacks) {
    if (!container) return;

    var cb = callbacks || {};
    _callbacks = cb;

    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Dashboard toolbar');

    // ─── Left group: Refresh button ─────────────────────────────
    var leftGroup = document.createElement('div');
    leftGroup.className = 'toolbar-group toolbar-group-left';

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-primary';
    refreshBtn.type = 'button';
    refreshBtn.id = 'toolbar-refresh-btn';
    refreshBtn.setAttribute('aria-label', 'Обновить все трекеры');
    var refreshIcon = _Icons ? _Icons.el('refresh', 18) : '';
    refreshBtn.innerHTML = refreshIcon + ' Обновить все';
    refreshBtn.addEventListener('click', function () {
      if (typeof cb.onRefreshAll === 'function') {
        cb.onRefreshAll();
      }
    });

    leftGroup.appendChild(refreshBtn);

    // Extension-based refresh button (check via browser tabs)
    var extRefreshBtn = document.createElement('button');
    extRefreshBtn.className = 'btn';
    extRefreshBtn.type = 'button';
    extRefreshBtn.id = 'toolbar-ext-refresh-btn';
    extRefreshBtn.setAttribute('aria-label', 'Проверить через браузер');
    extRefreshBtn.title = 'Проверка через открытие вкладок в браузере';
    var extIcon = _Icons ? _Icons.el('globe', 18) : '🌐';
    extRefreshBtn.innerHTML = extIcon + ' Браузер';
    extRefreshBtn.addEventListener('click', function () {
      if (typeof cb.onRefreshExtension === 'function') {
        cb.onRefreshExtension();
      }
    });

    leftGroup.appendChild(extRefreshBtn);

    // Auto-group button
    var autoGroupBtn = document.createElement('button');
    autoGroupBtn.className = 'btn btn-sm';
    autoGroupBtn.type = 'button';
    autoGroupBtn.id = 'toolbar-autogroup-btn';
    autoGroupBtn.setAttribute('aria-label', 'Авто-группировка трекеров');
    autoGroupBtn.title = 'Автоматически сгруппировать похожие товары';
    var pkgIcon = _Icons ? _Icons.el('package', 16) : '📦';
    autoGroupBtn.innerHTML = pkgIcon + ' Группы';
    autoGroupBtn.addEventListener('click', function () {
      if (typeof cb.onAutoGroup === 'function') {
        cb.onAutoGroup();
      }
    });

    leftGroup.appendChild(autoGroupBtn);

    // ─── Center group: Search + Filter + Sort ───────────────────
    var centerGroup = document.createElement('div');
    centerGroup.className = 'toolbar-group toolbar-group-center';

    // Search wrapper with icon
    var searchWrapper = document.createElement('div');
    searchWrapper.className = 'toolbar-search-wrapper';

    var searchIconEl = document.createElement('span');
    searchIconEl.className = 'toolbar-search-icon';
    searchIconEl.setAttribute('aria-hidden', 'true');
    searchIconEl.innerHTML = _Icons ? _Icons.el('search', 16) : '';

    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input toolbar-search-input';
    searchInput.placeholder = 'Поиск по названию...';
    searchInput.setAttribute('aria-label', 'Поиск трекеров по названию');
    searchInput.addEventListener('input', function () {
      if (typeof cb.onSearch === 'function') {
        cb.onSearch(searchInput.value);
      }
    });

    searchWrapper.appendChild(searchIconEl);
    searchWrapper.appendChild(searchInput);

    // Custom filter dropdown
    var filterDropdown = createCustomDropdown({
      options: [
        { value: 'all', text: 'Все' },
        { value: 'down', text: '📉 Цена снизилась' },
        { value: 'up', text: '📈 Цена выросла' },
        { value: 'groups', text: '📦 Группы товаров' },
      ],
      selected: 'all',
      ariaLabel: 'Фильтр по изменению цены',
      className: 'toolbar-filter-dropdown',
      onChange: function (value) {
        if (typeof cb.onFilter === 'function') {
          cb.onFilter(value);
        }
        // Show/hide group chips
        if (value === 'groups') {
          showGroupChips();
        } else {
          hideGroupChips();
        }
      },
    });

    // Custom sort dropdown
    var sortOptions = _sortEngine ? _sortEngine.getSortOptions() : [];
    var savedSort = 'priceAsc';
    try { savedSort = localStorage.getItem(SORT_STORAGE_KEY) || 'priceAsc'; } catch (e) {}

    var sortDropdown = createCustomDropdown({
      options: sortOptions.map(function (o) { return { value: o.value, text: o.label }; }),
      selected: savedSort,
      ariaLabel: 'Сортировка трекеров',
      className: 'toolbar-sort-dropdown',
      onChange: function (value) {
        try { localStorage.setItem(SORT_STORAGE_KEY, value); } catch (e) {}
        if (typeof cb.onSort === 'function') {
          cb.onSort(value);
        }
      },
    });

    centerGroup.appendChild(searchWrapper);
    centerGroup.appendChild(filterDropdown);
    centerGroup.appendChild(sortDropdown);

    // ─── Right group: Import/Export + Settings ────────────────────
    var rightGroup = document.createElement('div');
    rightGroup.className = 'toolbar-group toolbar-group-right';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'btn-icon';
    exportBtn.type = 'button';
    exportBtn.setAttribute('aria-label', 'Экспорт трекеров');
    exportBtn.innerHTML = _Icons ? _Icons.el('arrow-up', 18) : '↑';
    exportBtn.title = 'Экспорт';
    exportBtn.addEventListener('click', function () {
      if (typeof cb.onExport === 'function') cb.onExport();
    });

    var importBtn = document.createElement('button');
    importBtn.className = 'btn-icon';
    importBtn.type = 'button';
    importBtn.setAttribute('aria-label', 'Импорт трекеров');
    importBtn.innerHTML = _Icons ? _Icons.el('arrow-down', 18) : '↓';
    importBtn.title = 'Импорт';
    importBtn.addEventListener('click', function () {
      if (typeof cb.onImport === 'function') cb.onImport();
    });

    var selectBtn = document.createElement('button');
    selectBtn.className = 'btn-icon';
    selectBtn.type = 'button';
    selectBtn.setAttribute('aria-label', 'Выбрать трекеры');
    selectBtn.innerHTML = _Icons ? _Icons.el('check', 18) : '☑';
    selectBtn.title = 'Выбрать';
    selectBtn.addEventListener('click', function () {
      if (typeof cb.onSelectMode === 'function') cb.onSelectMode();
    });

    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn-icon';
    settingsBtn.type = 'button';
    settingsBtn.setAttribute('aria-label', 'Открыть настройки');
    settingsBtn.innerHTML = _Icons ? _Icons.el('settings', 20) : '⚙️';
    settingsBtn.addEventListener('click', function () {
      if (typeof cb.onSettingsClick === 'function') {
        cb.onSettingsClick();
      }
    });

    rightGroup.appendChild(exportBtn);
    rightGroup.appendChild(importBtn);
    rightGroup.appendChild(selectBtn);

    // Grid size toggle (compact / normal / large)
    var GRID_SIZE_KEY = 'priceTracker_gridSize';
    var gridSizes = ['normal', 'compact', 'large'];
    var gridLabels = { normal: 'Обычный', compact: 'Компактный', large: 'Крупный' };
    var gridIcons = { normal: '▦', compact: '▤', large: '▣' };
    var currentGridSize = 'normal';
    try { currentGridSize = localStorage.getItem(GRID_SIZE_KEY) || 'normal'; } catch (e) {}

    var gridSizeBtn = document.createElement('button');
    gridSizeBtn.className = 'btn-icon';
    gridSizeBtn.type = 'button';
    gridSizeBtn.id = 'toolbar-grid-size-btn';
    gridSizeBtn.setAttribute('aria-label', 'Размер карточек: ' + gridLabels[currentGridSize]);
    gridSizeBtn.title = 'Размер: ' + gridLabels[currentGridSize];
    gridSizeBtn.textContent = gridIcons[currentGridSize];
    gridSizeBtn.addEventListener('click', function () {
      var idx = gridSizes.indexOf(currentGridSize);
      currentGridSize = gridSizes[(idx + 1) % gridSizes.length];
      try { localStorage.setItem(GRID_SIZE_KEY, currentGridSize); } catch (e) {}
      gridSizeBtn.textContent = gridIcons[currentGridSize];
      gridSizeBtn.title = 'Размер: ' + gridLabels[currentGridSize];
      // Apply grid class
      var grid = document.getElementById('tracker-grid');
      if (grid) {
        grid.classList.remove('grid-compact', 'grid-large');
        if (currentGridSize !== 'normal') grid.classList.add('grid-' + currentGridSize);
      }
    });

    // Apply saved grid size on init
    setTimeout(function () {
      var grid = document.getElementById('tracker-grid');
      if (grid && currentGridSize !== 'normal') {
        grid.classList.add('grid-' + currentGridSize);
      }
    }, 0);

    rightGroup.appendChild(gridSizeBtn);
    rightGroup.appendChild(settingsBtn);

    // ─── Assemble toolbar with dividers ─────────────────────────
    toolbar.appendChild(leftGroup);

    var divider1 = document.createElement('div');
    divider1.className = 'toolbar-divider';
    divider1.setAttribute('aria-hidden', 'true');
    toolbar.appendChild(divider1);

    toolbar.appendChild(centerGroup);

    var divider2 = document.createElement('div');
    divider2.className = 'toolbar-divider';
    divider2.setAttribute('aria-hidden', 'true');
    toolbar.appendChild(divider2);

    toolbar.appendChild(rightGroup);

    container.appendChild(toolbar);

    // Group chips container (below toolbar, hidden by default)
    _groupChipsContainer = document.createElement('div');
    _groupChipsContainer.className = 'toolbar-group-chips';
    _groupChipsContainer.hidden = true;
    container.appendChild(_groupChipsContainer);

    // Close dropdowns on outside click
    document.addEventListener('click', function () {
      document.querySelectorAll('.custom-dropdown.open').forEach(function (dd) {
        dd.classList.remove('open');
      });
    });
  }

  // ─── Group Chips ──────────────────────────────────────────────────

  function showGroupChips() {
    if (!_groupChipsContainer) return;
    _groupChipsContainer.hidden = false;
    renderGroupChips();
  }

  function hideGroupChips() {
    if (!_groupChipsContainer) return;
    _groupChipsContainer.hidden = true;
  }

  function renderGroupChips() {
    if (!_groupChipsContainer) return;
    _groupChipsContainer.innerHTML = '';

    // "All groups" chip
    var allChip = document.createElement('button');
    allChip.className = 'group-chip active';
    allChip.textContent = 'Все группы';
    allChip.addEventListener('click', function () {
      _groupChipsContainer.querySelectorAll('.group-chip').forEach(function (c) { c.classList.remove('active'); });
      allChip.classList.add('active');
      if (typeof _callbacks.onGroupSelect === 'function') _callbacks.onGroupSelect(null);
    });
    _groupChipsContainer.appendChild(allChip);

    _currentGroups.forEach(function (groupName) {
      var chip = document.createElement('button');
      chip.className = 'group-chip';
      chip.textContent = groupName;
      chip.addEventListener('click', function () {
        _groupChipsContainer.querySelectorAll('.group-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        if (typeof _callbacks.onGroupSelect === 'function') _callbacks.onGroupSelect(groupName);
      });
      _groupChipsContainer.appendChild(chip);
    });
  }

  /**
   * Update the list of available groups (called from Dashboard after loading trackers).
   */
  function setGroups(groups) {
    _currentGroups = groups || [];
    if (_groupChipsContainer && !_groupChipsContainer.hidden) {
      renderGroupChips();
    }
  }

  return { init: init, setGroups: setGroups };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toolbar;
}

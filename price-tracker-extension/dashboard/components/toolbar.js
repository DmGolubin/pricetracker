/**
 * Toolbar component for Price Tracker Extension dashboard.
 *
 * Renders a toolbar with:
 * - "Обновить все" button with refresh SVG icon — triggers refresh of all trackers
 * - Search input with search SVG icon — filters cards by product name (case-insensitive)
 * - Filter dropdown — all / price down / price up
 * - Settings SVG icon button — opens global settings
 *
 * Layout: refresh (left) | search + filter (center) | settings (right)
 *
 * Usage: Toolbar.init(container, { onSearch, onFilter, onRefreshAll, onSettingsClick })
 *
 * Requirements: 2.4, 2.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

const Toolbar = (function () {
  // ─── Icons reference (global in browser, require in Node/Jest) ────
  var _Icons = (typeof Icons !== 'undefined') ? Icons
             : (typeof require === 'function' ? require('../../shared/icons') : null);

  /**
   * Initialise the toolbar inside the given container element.
   * @param {HTMLElement} container - Parent element to render into
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onSearch - Called with search query string on input
   * @param {Function} callbacks.onFilter - Called with filter value on change
   * @param {Function} callbacks.onRefreshAll - Called when refresh button is clicked
   * @param {Function} callbacks.onSettingsClick - Called when settings icon is clicked
   */
  function init(container, callbacks) {
    if (!container) return;

    var cb = callbacks || {};

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
    refreshBtn.setAttribute('aria-label', 'Обновить все трекеры');
    // Add refresh icon + text
    var refreshIcon = _Icons ? _Icons.el('refresh', 18) : '';
    refreshBtn.innerHTML = refreshIcon + ' Обновить все';
    refreshBtn.addEventListener('click', function () {
      // Spin animation on the SVG icon
      var svgEl = refreshBtn.querySelector('svg');
      if (svgEl) {
        svgEl.classList.add('toolbar-refresh-spin');
        svgEl.addEventListener('animationend', function handler() {
          svgEl.classList.remove('toolbar-refresh-spin');
          svgEl.removeEventListener('animationend', handler);
        });
      }
      if (typeof cb.onRefreshAll === 'function') {
        cb.onRefreshAll();
      }
    });

    leftGroup.appendChild(refreshBtn);

    // ─── Center group: Search + Filter ──────────────────────────
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

    // Filter select
    var filterSelect = document.createElement('select');
    filterSelect.className = 'input';
    filterSelect.setAttribute('aria-label', 'Фильтр по изменению цены');

    var options = [
      { value: 'all', text: 'Все' },
      { value: 'down', text: 'Цена снизилась' },
      { value: 'up', text: 'Цена выросла' },
      { value: 'groups', text: 'Группы товаров' },
    ];

    options.forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.text;
      filterSelect.appendChild(option);
    });

    filterSelect.addEventListener('change', function () {
      if (typeof cb.onFilter === 'function') {
        cb.onFilter(filterSelect.value);
      }
    });

    centerGroup.appendChild(searchWrapper);
    centerGroup.appendChild(filterSelect);

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
  }

  return { init: init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toolbar;
}

/**
 * Toolbar component for Price Tracker Extension dashboard.
 *
 * Renders a toolbar with:
 * - "Обновить все" button — triggers refresh of all trackers
 * - Search input — filters cards by product name (case-insensitive)
 * - Filter dropdown — all / price down / price up
 * - Settings icon button — opens global settings
 *
 * Usage: Toolbar.init(container, { onSearch, onFilter, onRefreshAll, onSettingsClick })
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

const Toolbar = (function () {
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

    // Refresh button
    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-primary';
    refreshBtn.type = 'button';
    refreshBtn.textContent = 'Обновить все';
    refreshBtn.setAttribute('aria-label', 'Обновить все трекеры');
    refreshBtn.addEventListener('click', function () {
      if (typeof cb.onRefreshAll === 'function') {
        cb.onRefreshAll();
      }
    });

    // Search input
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'input';
    searchInput.placeholder = 'Поиск по названию...';
    searchInput.setAttribute('aria-label', 'Поиск трекеров по названию');
    searchInput.addEventListener('input', function () {
      if (typeof cb.onSearch === 'function') {
        cb.onSearch(searchInput.value);
      }
    });

    // Filter select
    var filterSelect = document.createElement('select');
    filterSelect.className = 'input';
    filterSelect.setAttribute('aria-label', 'Фильтр по изменению цены');

    var options = [
      { value: 'all', text: 'Все' },
      { value: 'down', text: 'Цена снизилась' },
      { value: 'up', text: 'Цена выросла' },
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

    // Settings button
    var settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn-icon';
    settingsBtn.type = 'button';
    settingsBtn.textContent = '⚙️';
    settingsBtn.setAttribute('aria-label', 'Открыть настройки');
    settingsBtn.addEventListener('click', function () {
      if (typeof cb.onSettingsClick === 'function') {
        cb.onSettingsClick();
      }
    });

    // Assemble toolbar
    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(searchInput);
    toolbar.appendChild(filterSelect);
    toolbar.appendChild(settingsBtn);

    container.appendChild(toolbar);
  }

  return { init: init };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Toolbar;
}

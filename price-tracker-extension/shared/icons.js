/**
 * Centralized SVG Icon Module for Price Tracker Extension
 * Provides inline SVG icons as strings for all UI components.
 *
 * Usage (browser): Icons.get('settings') or Icons.el('settings', 20)
 * Usage (Jest):    const Icons = require('../shared/icons');
 */
(function () {

  /**
   * Raw SVG path data for each icon (content inside <svg>).
   * All icons designed for viewBox="0 0 24 24", stroke-based.
   */
  var ICONS = {
    'logo': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3v18h18"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16l4-8 4 4 5-9"/>',

    'package': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="3.27 6.96 12 12.01 20.73 6.96"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="22.08" x2="12" y2="12"/>',

    'settings': '<circle stroke-linecap="round" stroke-linejoin="round" stroke-width="2" cx="12" cy="12" r="3"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>',

    'close': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="18" y1="6" x2="6" y2="18"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" y1="6" x2="18" y2="18"/>',

    'warning': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="9" x2="12" y2="13"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="17" x2="12.01" y2="17"/>',

    'refresh': '<polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="23 4 23 10 17 10"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>',

    'search': '<circle stroke-linecap="round" stroke-linejoin="round" stroke-width="2" cx="11" cy="11" r="8"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" y1="21" x2="16.65" y2="16.65"/>',

    'filter': '<polygon stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',

    'delete': '<polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="3 6 5 6 21 6"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',

    'save': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="17 21 17 13 7 13 7 21"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="7 3 7 8 15 8"/>',

    'chart': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3v18h18"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16l4-8 4 4 5-9"/>',

    'arrow-up': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="19" x2="12" y2="5"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="5 12 12 5 19 12"/>',

    'arrow-down': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="5" x2="12" y2="19"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="19 12 12 19 5 12"/>',

    'arrow-neutral': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="5" y1="12" x2="19" y2="12"/>',

    'auto-detect': '<circle stroke-linecap="round" stroke-linejoin="round" stroke-width="2" cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16v-4"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8h.01"/>',

    'notifications': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.73 21a2 2 0 01-3.46 0"/>',

    'link': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>',

    'chevron-up': '<polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="18 15 12 9 6 15"/>',

    'chevron-down': '<polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="6 9 12 15 18 9"/>',

    'check': '<polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="20 6 9 17 4 12"/>',

    'plus': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="5" x2="12" y2="19"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="5" y1="12" x2="19" y2="12"/>',

    'minus': '<line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="5" y1="12" x2="19" y2="12"/>',

    'clock': '<circle stroke-linecap="round" stroke-linejoin="round" stroke-width="2" cx="12" cy="12" r="10"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="12 6 12 12 16 14"/>',

    'calendar': '<rect stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x="3" y="4" width="18" height="18" rx="2" ry="2"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="16" y1="2" x2="16" y2="6"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" y1="2" x2="8" y2="6"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="3" y1="10" x2="21" y2="10"/>',

    'globe': '<circle stroke-linecap="round" stroke-linejoin="round" stroke-width="2" cx="12" cy="12" r="10"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="2" y1="12" x2="22" y2="12"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>'
  };

  /**
   * Returns an SVG string for the given icon name.
   * Includes viewBox, fill="none", stroke="currentColor", aria-hidden="true".
   * Returns empty string for unknown icon names.
   *
   * @param {string} name - Icon name (e.g. 'settings', 'arrow-up')
   * @returns {string} SVG markup string or ''
   */
  function get(name) {
    var paths = ICONS[name];
    if (!paths) return '';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">' + paths + '</svg>';
  }

  /**
   * Returns an SVG string with explicit width and height attributes.
   * Defaults to size 24 if not specified.
   *
   * @param {string} name - Icon name
   * @param {number} [size=24] - Width and height in pixels
   * @returns {string} SVG markup string with width/height or ''
   */
  function el(name, size) {
    var paths = ICONS[name];
    if (!paths) return '';
    var s = size || 24;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" width="' + s + '" height="' + s + '">' + paths + '</svg>';
  }

  // Public API
  var _icons = {
    get: get,
    el: el
  };

  // CommonJS export (for Jest / Node)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = _icons;
  }

  // Global browser export
  if (typeof self !== 'undefined') {
    self.Icons = _icons;
  }

})();

/**
 * Popup script for Price Tracker Extension.
 *
 * - "Показать трекеры" opens the dashboard in a new tab.
 * - "Отслеживать цену на этой странице" activates the Selector Picker.
 * - "Отслеживать цену: {price}" (auto-detect) creates a tracker in one click.
 * - Tracking buttons are hidden on internal browser pages.
 *
 * Requirements: 3.1, 3.2, 3.3, 12.1, 13.2, 13.3, 13.4
 */

// URL schemes considered internal (tracking not possible)
const INTERNAL_URL_SCHEMES = [
  'chrome://',
  'about:',
  'edge://',
  'chrome-extension://',
  'moz-extension://',
  'brave://',
];

/**
 * Check whether a URL belongs to an internal browser page.
 */
function isInternalPage(url) {
  if (!url) return true;
  return INTERNAL_URL_SCHEMES.some((scheme) => url.startsWith(scheme));
}

// ─── DOM references ─────────────────────────────────────────────────

const btnShowTrackers = document.getElementById('btn-show-trackers');
const btnTrackManual = document.getElementById('btn-track-manual');
const btnTrackAuto = document.getElementById('btn-track-auto');
const statusMessage = document.getElementById('status-message');
const popupLogo = document.getElementById('popup-logo');

// Inject SVG logo icon
if (popupLogo && typeof Icons !== 'undefined') {
  popupLogo.innerHTML = Icons.el('logo', 28);
} else if (popupLogo) {
  popupLogo.textContent = '📊';
}

// ─── Button handlers ────────────────────────────────────────────────

btnShowTrackers.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
});

btnTrackManual.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;

    // Inject selectorPicker CSS and JS using Promise API (MV3)
    chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/selectorPicker.css'] })
      .then(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/selectorPicker.js'] }))
      .then(() => { window.close(); })
      .catch((err) => {
        showStatus('Ошибка: ' + (err.message || 'не удалось внедрить скрипт'), true);
      });
  });
});

// Store auto-detect data for one-click tracking
let autoDetectData = null;

btnTrackAuto.addEventListener('click', () => {
  if (!autoDetectData) return;

  // Disable button to prevent double-clicks
  btnTrackAuto.disabled = true;
  btnTrackAuto.textContent = 'Создание трекера…';

  // Send the stored auto-detect data to service worker to create the tracker
  chrome.runtime.sendMessage({
    action: 'autoDetected',
    selector: autoDetectData.selector,
    price: autoDetectData.price,
    title: autoDetectData.title,
    imageUrl: autoDetectData.imageUrl,
    pageUrl: autoDetectData.pageUrl,
  }, (response) => {
    if (chrome.runtime.lastError || (response && response.error)) {
      showStatus('Ошибка создания трекера', true);
      btnTrackAuto.disabled = false;
      btnTrackAuto.textContent = 'Повторить';
      return;
    }
    window.close();
  });
});

// ─── Initialisation ─────────────────────────────────────────────────

function showStatus(text, isError) {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  statusMessage.classList.remove('popup-status-exit');
  statusMessage.classList.add('popup-status-enter');
  if (isError) {
    statusMessage.classList.add('popup-status-error');
  }
}

/**
 * Hide the status message with slideUp animation.
 */
function hideStatus() {
  if (statusMessage.hidden) return;
  statusMessage.classList.remove('popup-status-enter');
  statusMessage.classList.add('popup-status-exit');
  statusMessage.addEventListener('animationend', function onEnd() {
    statusMessage.removeEventListener('animationend', onEnd);
    statusMessage.hidden = true;
    statusMessage.classList.remove('popup-status-exit', 'popup-status-error');
  });
}

/**
 * Initialise popup: detect current tab URL, decide which buttons to show,
 * and attempt auto-detection of price.
 */
function init() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const url = tab && tab.url;

    if (!url || isInternalPage(url)) {
      // Internal page — only "Показать трекеры" is visible (default state)
      return;
    }

    // Regular web page — show manual tracking button
    btnTrackManual.hidden = false;

    // Attempt auto-detection by injecting the autoDetector content script
    // and listening for its response via a one-time message listener.
    tryAutoDetect(tab);
  });
}

/**
 * Inject autoDetector.js into the tab and read the result from window.__ptAutoDetect.
 * If a price is found, show the one-click "Отслеживать цену: {price}" button.
 */
function tryAutoDetect(tab) {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/autoDetector.js'] })
    .then(() => {
      // Read the result stored by autoDetector on the page's window object
      return chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__ptAutoDetect
      });
    })
    .then((results) => {
      var data = results && results[0] && results[0].result;
      if (!data || !data.found) return;

      autoDetectData = {
        selector: data.selector,
        price: data.price,
        title: data.title,
        imageUrl: data.imageUrl,
        pageUrl: data.pageUrl,
      };
      showAutoButton(data.price);
    })
    .catch(() => {
      // Injection failed — ignore
    });
}

/**
 * Show the auto-detect button with the found price.
 */
function showAutoButton(price) {
  var text = 'Отслеживать цену (авто)';
  if (price != null && price !== 0 && price !== '') {
    var formatted = typeof price === 'number' ? price.toLocaleString() : String(price);
    if (formatted) text = 'Отслеживать цену: ' + formatted;
  }
  btnTrackAuto.textContent = text;
  btnTrackAuto.hidden = false;
}

// Start
init();

// ─── Exports for testing ────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isInternalPage, showAutoButton, showStatus, hideStatus };
}

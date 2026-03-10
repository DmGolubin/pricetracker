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

// ─── Button handlers ────────────────────────────────────────────────

btnShowTrackers.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
});

btnTrackManual.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'startPicker' });
  window.close();
});

btnTrackAuto.addEventListener('click', () => {
  // Disable button to prevent double-clicks
  btnTrackAuto.disabled = true;
  btnTrackAuto.textContent = 'Создание трекера…';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) {
      showStatus('Не удалось определить вкладку', true);
      return;
    }

    // Inject autoDetector to get the detection result, then send autoDetected
    // to the service worker so it creates the tracker.
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        files: ['content/autoDetector.js'],
      },
      () => {
        // The autoDetector content script will send autoDetected / autoDetectFailed
        // back to the service worker which handles tracker creation.
        // We just close the popup — the SW takes care of the rest.
        window.close();
      }
    );
  });
});

// ─── Initialisation ─────────────────────────────────────────────────

function showStatus(text, isError) {
  statusMessage.textContent = text;
  statusMessage.hidden = false;
  if (isError) {
    statusMessage.classList.add('popup-status-error');
  }
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
 * Inject autoDetector.js into the tab and listen for the result.
 * If a price is found, show the one-click "Отслеживать цену: {price}" button.
 */
function tryAutoDetect(tab) {
  // Use chrome.tabs.sendMessage to ask an already-injected autoDetector,
  // or inject it first and then listen for the response.
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      files: ['content/autoDetector.js'],
    },
    () => {
      if (chrome.runtime.lastError) {
        // Cannot inject (e.g. restricted page) — keep manual button only
        return;
      }

      // The autoDetector sends a message to the service worker.
      // We set up a temporary listener to intercept the result.
      const listener = (message) => {
        if (!message || !message.action) return;

        if (message.action === 'autoDetected') {
          chrome.runtime.onMessage.removeListener(listener);
          showAutoButton(message.price);
        } else if (message.action === 'autoDetectFailed') {
          chrome.runtime.onMessage.removeListener(listener);
          // No auto-detected price — manual button is already visible
        }
      };

      chrome.runtime.onMessage.addListener(listener);

      // Timeout: if no response within 3 seconds, give up on auto-detect
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
      }, 3000);
    }
  );
}

/**
 * Show the auto-detect button with the found price.
 */
function showAutoButton(price) {
  const formatted = typeof price === 'number' ? price.toLocaleString() : price;
  btnTrackAuto.textContent = `Отслеживать цену: ${formatted}`;
  btnTrackAuto.hidden = false;
}

// Start
init();

// ─── Exports for testing ────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isInternalPage, showAutoButton };
}

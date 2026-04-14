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
    variantSelector: autoDetectData.variantSelector,
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Нет связи с расширением', true);
      btnTrackAuto.disabled = false;
      btnTrackAuto.textContent = 'Повторить';
      return;
    }
    if (response && !response.success) {
      var msg = 'Ошибка создания трекера';
      if (response.code === 'DUPLICATE') {
        msg = 'Этот товар уже отслеживается';
      } else if (response.code === 'NETWORK_ERROR') {
        msg = 'Нет связи с сервером';
      } else if (response.status >= 500) {
        msg = 'Ошибка сервера: ' + (response.error || 'попробуйте позже');
      } else if (response.error) {
        msg = response.error;
      }
      showStatus(msg, true);
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
      return;
    }

    // Regular web page — show manual tracking button
    btnTrackManual.hidden = false;

    // Check for existing trackers on this URL
    showExistingTrackers(url);

    // Attempt auto-detection
    tryAutoDetect(tab);
  });
}

/**
 * Show existing trackers for the current page URL.
 */
function showExistingTrackers(pageUrl) {
  chrome.runtime.sendMessage({ action: 'getAllTrackers' }, function (response) {
    if (!response || !response.data) return;
    var trackers = Array.isArray(response.data) ? response.data : [];

    // Show stats in header
    var statsEl = document.getElementById('popup-stats');
    if (statsEl) {
      var groups = {};
      trackers.forEach(function (t) { if (t.productGroup) groups[t.productGroup] = true; });
      statsEl.textContent = trackers.length + ' трекеров · ' + Object.keys(groups).length + ' групп';
    }

    // Normalize URL for matching
    var normalizedUrl = pageUrl;
    try {
      var u = new URL(pageUrl);
      u.hash = '';
      normalizedUrl = u.toString().replace(/\/+$/, '');
    } catch (_) {}

    var matching = trackers.filter(function (t) {
      var tUrl = t.pageUrl;
      try {
        var tu = new URL(tUrl);
        tu.hash = '';
        tUrl = tu.toString().replace(/\/+$/, '');
      } catch (_) {}
      return tUrl === normalizedUrl || t.pageUrl === pageUrl;
    });

    if (matching.length === 0) return;

    var container = document.getElementById('existing-trackers');
    if (!container) return;

    var html = '<div class="popup-existing-header">✅ Уже отслеживается (' + matching.length + ')</div>';
    matching.forEach(function (t) {
      var price = Number(t.currentPrice);
      var priceStr = price > 0 ? price.toLocaleString() + ' ₴' : (t.currentContent || '—');
      var name = (t.productName || '').slice(0, 35);
      // Extract volume
      var volMatch = (t.productName || '').match(/(\d+)\s*(?:ml|мл)\b/i);
      var volTag = volMatch ? '<span class="popup-existing-vol">' + volMatch[1] + ' мл</span>' : '';
      html += '<div class="popup-existing-item" data-tracker-id="' + t.id + '">'
        + '<span class="popup-existing-name">' + name + '</span>'
        + volTag
        + '<span class="popup-existing-price">' + priceStr + '</span>'
        + '<button class="popup-existing-delete" title="Удалить трекер">×</button>'
        + '</div>';
    });

    container.innerHTML = html;
    container.hidden = false;

    // Attach delete handlers
    container.querySelectorAll('.popup-existing-delete').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var item = btn.closest('.popup-existing-item');
        var trackerId = item && item.getAttribute('data-tracker-id');
        if (!trackerId) return;
        var trackerName = item.querySelector('.popup-existing-name');
        var name = trackerName ? trackerName.textContent : '';
        if (!confirm('Удалить трекер «' + name + '»?')) return;

        btn.disabled = true;
        btn.textContent = '…';
        chrome.runtime.sendMessage({ action: 'deleteTracker', trackerId: Number(trackerId) }, function (resp) {
          if (chrome.runtime.lastError || (resp && !resp.success)) {
            btn.disabled = false;
            btn.textContent = '×';
            showStatus('Ошибка удаления', true);
            return;
          }
          // Remove item from DOM with animation
          item.style.transition = 'opacity 0.2s, max-height 0.2s';
          item.style.opacity = '0';
          item.style.maxHeight = '0';
          item.style.overflow = 'hidden';
          setTimeout(function () {
            item.remove();
            // Update header count
            var remaining = container.querySelectorAll('.popup-existing-item');
            var header = container.querySelector('.popup-existing-header');
            if (remaining.length === 0) {
              container.hidden = true;
            } else if (header) {
              header.textContent = '✅ Уже отслеживается (' + remaining.length + ')';
            }
            // Update stats
            var statsEl = document.getElementById('popup-stats');
            if (statsEl) {
              var currentText = statsEl.textContent;
              var numMatch = currentText.match(/^(\d+)/);
              if (numMatch) {
                var newCount = Math.max(0, parseInt(numMatch[1], 10) - 1);
                statsEl.textContent = currentText.replace(/^\d+/, newCount);
              }
            }
          }, 200);
        });
      });
    });
  });
}

/**
 * Inject autoDetector.js into the tab and read the result from window.__ptAutoDetect.
 * If a price is found, show the one-click "Отслеживать цену: {price}" button.
 */
function tryAutoDetect(tab) {
  chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/autoDetector.js'] })
    .then(() => {
      // Read the result stored by autoDetector on the page's documentElement
      return chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          var raw = document.documentElement.getAttribute('data-pt-auto-detect');
          if (!raw) return null;
          try { return JSON.parse(raw); } catch (_) { return null; }
        }
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
        variantSelector: data.variantSelector || null,
      };
      showAutoButton(data.price);
    })
    .catch(() => {
      // Injection failed — ignore
    });
}

/**
 * Show the auto-detect button with the found price.
 * Only shows if price is valid and non-empty.
 */
function showAutoButton(price) {
  if (price == null || price === 0 || price === '') {
    // Don't show empty button
    return;
  }
  var formatted = typeof price === 'number' ? price.toLocaleString() : String(price);
  if (!formatted) return;
  btnTrackAuto.innerHTML = '<span class="popup-btn-icon">⚡</span> Отслеживать: ' + formatted + ' грн';
  btnTrackAuto.hidden = false;
}

// Start
init();

// ─── Exports for testing ────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isInternalPage, showAutoButton, showStatus, hideStatus };
}

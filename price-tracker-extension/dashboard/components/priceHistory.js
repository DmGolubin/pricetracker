/**
 * Price History component for Price Tracker Extension dashboard.
 *
 * Renders a list of price/content history records inside a container:
 * - Loads history via chrome.runtime.sendMessage({action: "getPriceHistory"})
 * - Sorts records by checkedAt descending (newest first)
 * - Each record shows date/time and price (or content text for content trackers)
 * - Records where price decreased vs previous record get price-down-bg highlight
 * - Integrates ContentDiff component for content trackers if available
 * - Shows "Нет записей" when history is empty
 * - Shows loading state while fetching
 *
 * Usage: PriceHistory.render(tracker, container)
 *
 * Requirements: 8.1, 8.2, 8.3
 */

const PriceHistory = (function () {

  // ─── Helpers ──────────────────────────────────────────────────────

  function sendMessage(msg) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(msg, function (response) {
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

  function formatDateTime(isoString) {
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      var date = d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      var time = d.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return date + ' ' + time;
    } catch (e) {
      return isoString;
    }
  }

  function sortNewestFirst(records) {
    return records.slice().sort(function (a, b) {
      return new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime();
    });
  }

  /**
   * Determine which records have a price decrease compared to the
   * chronologically previous record (the one recorded just before).
   * Records are expected to be sorted newest-first already.
   * A record at index i decreased if its price < price of record at index i+1
   * (i+1 is the older/previous record).
   */
  function markDecreases(sortedRecords) {
    var flags = [];
    for (var i = 0; i < sortedRecords.length; i++) {
      if (i < sortedRecords.length - 1) {
        var current = sortedRecords[i].price;
        var previous = sortedRecords[i + 1].price;
        flags.push(
          typeof current === 'number' &&
          typeof previous === 'number' &&
          current < previous
        );
      } else {
        flags.push(false);
      }
    }
    return flags;
  }

  // ─── Rendering ────────────────────────────────────────────────────

  function renderLoading(container) {
    var el = document.createElement('div');
    el.className = 'price-history-loading';
    el.setAttribute('data-testid', 'price-history-loading');
    el.textContent = 'Загрузка истории…';
    container.appendChild(el);
  }

  function renderEmpty(container) {
    var el = document.createElement('div');
    el.className = 'price-history-empty';
    el.setAttribute('data-testid', 'price-history-empty');
    el.textContent = 'Нет записей';
    container.appendChild(el);
  }

  function renderError(container, message) {
    var el = document.createElement('div');
    el.className = 'price-history-error';
    el.setAttribute('data-testid', 'price-history-error');
    el.textContent = message || 'Ошибка загрузки истории';
    container.appendChild(el);
  }

  function renderRecord(record, isDecrease, isContentTracker) {
    var item = document.createElement('div');
    item.className = 'price-history-record';
    item.setAttribute('data-testid', 'price-history-record');

    if (isDecrease) {
      item.classList.add('price-down-bg');
    }

    // Date/time
    var dateEl = document.createElement('span');
    dateEl.className = 'price-history-date';
    dateEl.setAttribute('data-testid', 'price-history-date');
    dateEl.textContent = formatDateTime(record.checkedAt);

    // Value
    var valueEl = document.createElement('span');
    valueEl.className = 'price-history-value';
    valueEl.setAttribute('data-testid', 'price-history-value');

    if (isContentTracker && record.content != null) {
      valueEl.textContent = record.content;
    } else {
      valueEl.textContent = typeof record.price === 'number' ? record.price.toFixed(2) : String(record.price);
    }

    item.appendChild(dateEl);
    item.appendChild(valueEl);

    // ContentDiff integration for content trackers
    if (isContentTracker && typeof ContentDiff !== 'undefined' && ContentDiff.render) {
      var diffContainer = document.createElement('div');
      diffContainer.className = 'price-history-diff';
      diffContainer.setAttribute('data-testid', 'price-history-diff');
      ContentDiff.render(record, diffContainer);
      item.appendChild(diffContainer);
    }

    return item;
  }

  function renderList(container, records, isContentTracker) {
    var title = document.createElement('h3');
    title.className = 'price-history-title';
    title.textContent = 'История цен';
    container.appendChild(title);

    var sorted = sortNewestFirst(records);
    var decreaseFlags = markDecreases(sorted);

    var list = document.createElement('div');
    list.className = 'price-history-list';
    list.setAttribute('data-testid', 'price-history-list');

    for (var i = 0; i < sorted.length; i++) {
      list.appendChild(renderRecord(sorted[i], decreaseFlags[i], isContentTracker));
    }

    container.appendChild(list);
  }

  // ─── Public API ─────────────────────────────────────────────────

  function render(tracker, container) {
    container.innerHTML = '';
    renderLoading(container);

    var isContentTracker = tracker.trackingType === 'content';

    sendMessage({ action: 'getPriceHistory', trackerId: tracker.id })
      .then(function (response) {
        container.innerHTML = '';
        var records = Array.isArray(response) ? response :
          (response && Array.isArray(response.records)) ? response.records : [];

        if (records.length === 0) {
          renderEmpty(container);
          return;
        }

        renderList(container, records, isContentTracker);
      })
      .catch(function (err) {
        container.innerHTML = '';
        renderError(container, err && err.message ? err.message : 'Ошибка загрузки истории');
      });
  }

  return {
    render: render,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriceHistory;
}

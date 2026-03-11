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
        var current = Number(sortedRecords[i].price);
        var previous = Number(sortedRecords[i + 1].price);
        flags.push(
          !isNaN(current) &&
          !isNaN(previous) &&
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

    var contentText = record.content != null ? record.content : record.contentValue;
    if (isContentTracker && contentText != null && contentText !== '') {
      valueEl.textContent = contentText;
    } else {
      var p = typeof record.price === 'number' ? record.price : parseFloat(record.price);
      valueEl.textContent = !isNaN(p) ? p.toFixed(2) : String(record.price);
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

  // ─── SVG Chart ─────────────────────────────────────────────────────

  function formatShortDate(isoString) {
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  /**
   * Render an SVG line chart for price history.
   * Records should be sorted oldest-first for left-to-right display.
   */
  function renderChart(container, records) {
    // Need at least 2 points for a line
    if (!records || records.length < 2) return;

    // Sort oldest first (chronological)
    var chronological = records.slice().sort(function (a, b) {
      return new Date(a.checkedAt).getTime() - new Date(b.checkedAt).getTime();
    });

    var prices = chronological.map(function (r) { return typeof r.price === 'number' ? r.price : parseFloat(r.price); });
    var validPrices = prices.filter(function (p) { return !isNaN(p) && isFinite(p); });
    if (validPrices.length < 2) return;

    var minP = Math.min.apply(null, validPrices);
    var maxP = Math.max.apply(null, validPrices);

    // Chart dimensions
    var W = 440;
    var H = 180;
    var padTop = 24;
    var padBottom = 32;
    var padLeft = 52;
    var padRight = 16;
    var chartW = W - padLeft - padRight;
    var chartH = H - padTop - padBottom;

    // Price range with padding
    var range = maxP - minP;
    if (range === 0) range = 1; // flat line case

    // Build points
    var points = [];
    for (var i = 0; i < chronological.length; i++) {
      var p = typeof chronological[i].price === 'number' ? chronological[i].price : parseFloat(chronological[i].price);
      if (isNaN(p) || !isFinite(p)) continue;
      var x = padLeft + (i / (chronological.length - 1)) * chartW;
      var y = padTop + chartH - ((p - minP) / range) * chartH;
      points.push({ x: x, y: y, price: p, date: chronological[i].checkedAt });
    }

    if (points.length < 2) return;

    // Determine color: compare last vs first
    var firstPrice = points[0].price;
    var lastPrice = points[points.length - 1].price;
    var lineColor = lastPrice < firstPrice ? 'var(--accent-green)' : lastPrice > firstPrice ? 'var(--accent-red)' : 'var(--accent-primary)';

    // Build SVG
    var svgNS = 'http://www.w3.org/2000/svg';
    var wrapper = document.createElement('div');
    wrapper.className = 'price-history-chart';
    wrapper.setAttribute('data-testid', 'price-history-chart');

    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'График цен');
    svg.style.display = 'block';

    // Grid lines (horizontal)
    var gridSteps = 4;
    for (var g = 0; g <= gridSteps; g++) {
      var gy = padTop + (g / gridSteps) * chartH;
      var gridLine = document.createElementNS(svgNS, 'line');
      gridLine.setAttribute('x1', padLeft);
      gridLine.setAttribute('y1', gy);
      gridLine.setAttribute('x2', W - padRight);
      gridLine.setAttribute('y2', gy);
      gridLine.setAttribute('stroke', 'var(--border-primary)');
      gridLine.setAttribute('stroke-width', '1');
      gridLine.setAttribute('stroke-dasharray', '4,4');
      svg.appendChild(gridLine);

      // Y-axis label
      var yVal = maxP - (g / gridSteps) * (maxP - minP);
      var yLabel = document.createElementNS(svgNS, 'text');
      yLabel.setAttribute('x', padLeft - 6);
      yLabel.setAttribute('y', gy + 4);
      yLabel.setAttribute('text-anchor', 'end');
      yLabel.setAttribute('fill', 'var(--text-muted)');
      yLabel.setAttribute('font-size', '10');
      yLabel.textContent = Math.round(yVal).toLocaleString();
      svg.appendChild(yLabel);
    }

    // Gradient fill under line
    var defs = document.createElementNS(svgNS, 'defs');
    var grad = document.createElementNS(svgNS, 'linearGradient');
    grad.setAttribute('id', 'ph-fill-grad');
    grad.setAttribute('x1', '0');
    grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '0');
    grad.setAttribute('y2', '1');
    var stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', lineColor);
    stop1.setAttribute('stop-opacity', '0.3');
    var stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', lineColor);
    stop2.setAttribute('stop-opacity', '0.02');
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Area fill
    var areaPath = points.map(function (pt, idx) {
      return (idx === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1);
    }).join(' ');
    areaPath += ' L' + points[points.length - 1].x.toFixed(1) + ',' + (padTop + chartH);
    areaPath += ' L' + points[0].x.toFixed(1) + ',' + (padTop + chartH) + ' Z';
    var area = document.createElementNS(svgNS, 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', 'url(#ph-fill-grad)');
    svg.appendChild(area);

    // Line
    var linePath = points.map(function (pt, idx) {
      return (idx === 0 ? 'M' : 'L') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1);
    }).join(' ');
    var line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', lineColor);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);

    // Dots
    for (var d = 0; d < points.length; d++) {
      var circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', points[d].x.toFixed(1));
      circle.setAttribute('cy', points[d].y.toFixed(1));
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', lineColor);
      circle.setAttribute('stroke', 'var(--bg-card)');
      circle.setAttribute('stroke-width', '1.5');
      svg.appendChild(circle);
    }

    // X-axis date labels (show first, last, and a few in between)
    var labelCount = Math.min(points.length, 5);
    var labelStep = points.length <= labelCount ? 1 : Math.floor((points.length - 1) / (labelCount - 1));
    for (var li = 0; li < points.length; li += labelStep) {
      var xLabel = document.createElementNS(svgNS, 'text');
      xLabel.setAttribute('x', points[li].x.toFixed(1));
      xLabel.setAttribute('y', H - 6);
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('fill', 'var(--text-muted)');
      xLabel.setAttribute('font-size', '10');
      xLabel.textContent = formatShortDate(points[li].date);
      svg.appendChild(xLabel);
    }
    // Always show last label if not already shown
    var lastIdx = points.length - 1;
    if (lastIdx % labelStep !== 0) {
      var lastLabel = document.createElementNS(svgNS, 'text');
      lastLabel.setAttribute('x', points[lastIdx].x.toFixed(1));
      lastLabel.setAttribute('y', H - 6);
      lastLabel.setAttribute('text-anchor', 'middle');
      lastLabel.setAttribute('fill', 'var(--text-muted)');
      lastLabel.setAttribute('font-size', '10');
      lastLabel.textContent = formatShortDate(points[lastIdx].date);
      svg.appendChild(lastLabel);
    }

    wrapper.appendChild(svg);
    container.appendChild(wrapper);
  }

  // ─── List rendering ───────────────────────────────────────────────

  function renderList(container, records, isContentTracker) {
    var title = document.createElement('h3');
    title.className = 'price-history-title';
    title.textContent = 'История цен';
    container.appendChild(title);

    // Render chart for price trackers with 2+ records
    if (!isContentTracker) {
      renderChart(container, records);
    }

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
          (response && Array.isArray(response.data)) ? response.data :
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

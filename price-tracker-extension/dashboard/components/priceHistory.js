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

  function renderRecord(record, isDecrease, isContentTracker, onDelete) {
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
      valueEl.style.whiteSpace = 'pre-line';
    } else {
      var p = typeof record.price === 'number' ? record.price : parseFloat(record.price);
      valueEl.textContent = !isNaN(p) ? p.toFixed(2) : String(record.price);
    }

    item.appendChild(dateEl);
    item.appendChild(valueEl);

    // ContentDiff integration for content trackers
    if (isContentTracker && typeof ContentDiff !== 'undefined' && ContentDiff.render) {
      // Map price_history fields to what ContentDiff expects
      var diffRecord = {
        content: record.contentValue || record.content || '',
        previousContent: record.previousContent || ''
      };
      var diffContainer = document.createElement('div');
      diffContainer.className = 'price-history-diff';
      diffContainer.setAttribute('data-testid', 'price-history-diff');
      ContentDiff.render(diffRecord, diffContainer);
      item.appendChild(diffContainer);
    }


    // Delete button
    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon price-history-delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Удалить запись';
    deleteBtn.setAttribute('aria-label', 'Удалить запись из истории');
    deleteBtn.setAttribute('data-record-id', record.id);
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof onDelete === 'function') onDelete(record.id, item);
    });
    item.appendChild(deleteBtn);

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

    // ─── Interactive elements (crosshair, tooltip, highlight) ──────
    // Crosshair vertical line
    var crosshair = document.createElementNS(svgNS, 'line');
    crosshair.setAttribute('x1', '0');
    crosshair.setAttribute('y1', String(padTop));
    crosshair.setAttribute('x2', '0');
    crosshair.setAttribute('y2', String(padTop + chartH));
    crosshair.setAttribute('stroke', 'var(--text-muted)');
    crosshair.setAttribute('stroke-width', '1');
    crosshair.setAttribute('stroke-dasharray', '4,3');
    crosshair.setAttribute('display', 'none');
    crosshair.setAttribute('data-testid', 'chart-crosshair');
    svg.appendChild(crosshair);

    // Highlight circle
    var highlight = document.createElementNS(svgNS, 'circle');
    highlight.setAttribute('cx', '0');
    highlight.setAttribute('cy', '0');
    highlight.setAttribute('r', '6');
    highlight.setAttribute('fill', lineColor);
    highlight.setAttribute('stroke', 'var(--bg-card)');
    highlight.setAttribute('stroke-width', '2');
    highlight.setAttribute('display', 'none');
    highlight.setAttribute('data-testid', 'chart-highlight');
    highlight.style.transition = 'r 150ms, display 0s';
    svg.appendChild(highlight);

    // Tooltip group
    var tooltip = document.createElementNS(svgNS, 'g');
    tooltip.setAttribute('display', 'none');
    tooltip.setAttribute('data-testid', 'chart-tooltip');

    var tooltipRect = document.createElementNS(svgNS, 'rect');
    tooltipRect.setAttribute('rx', '4');
    tooltipRect.setAttribute('ry', '4');
    tooltipRect.setAttribute('width', '120');
    tooltipRect.setAttribute('height', '44');
    tooltipRect.classList.add('price-chart-tooltip-rect');
    tooltip.appendChild(tooltipRect);

    var tooltipDate = document.createElementNS(svgNS, 'text');
    tooltipDate.setAttribute('font-size', '11');
    tooltipDate.setAttribute('data-testid', 'chart-tooltip-date');
    tooltipDate.classList.add('price-chart-tooltip-text');
    tooltip.appendChild(tooltipDate);

    var tooltipPrice = document.createElementNS(svgNS, 'text');
    tooltipPrice.setAttribute('font-size', '12');
    tooltipPrice.setAttribute('font-weight', '600');
    tooltipPrice.setAttribute('data-testid', 'chart-tooltip-price');
    tooltipPrice.classList.add('price-chart-tooltip-text');
    tooltip.appendChild(tooltipPrice);

    svg.appendChild(tooltip);

    // ─── Mouse interaction handlers ─────────────────────────────────

    function formatTooltipDate(isoString) {
      try {
        var dt = new Date(isoString);
        if (isNaN(dt.getTime())) return '';
        var dd = String(dt.getDate()).padStart(2, '0');
        var mm = String(dt.getMonth() + 1).padStart(2, '0');
        var yyyy = dt.getFullYear();
        return dd + '.' + mm + '.' + yyyy;
      } catch (e) {
        return '';
      }
    }

    function formatTooltipPrice(price) {
      var parts = price.toFixed(2).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
      return parts.join(',');
    }

    var prevHighlightIdx = -1;
    var allDots = svg.querySelectorAll('circle[r="3.5"]');

    svg.addEventListener('mousemove', function (e) {
      var rect = svg.getBoundingClientRect();
      var svgWidth = rect.width;
      if (svgWidth === 0) return;

      var mouseX = e.clientX - rect.left;
      var proportion = mouseX / svgWidth;
      var svgX = proportion * W;

      // Find nearest point
      var nearestIdx = 0;
      var nearestDist = Infinity;
      for (var pi = 0; pi < points.length; pi++) {
        var dist = Math.abs(points[pi].x - svgX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = pi;
        }
      }

      var pt = points[nearestIdx];

      // Show crosshair
      crosshair.setAttribute('x1', pt.x.toFixed(1));
      crosshair.setAttribute('x2', pt.x.toFixed(1));
      crosshair.setAttribute('display', '');

      // Highlight point
      highlight.setAttribute('cx', pt.x.toFixed(1));
      highlight.setAttribute('cy', pt.y.toFixed(1));
      highlight.setAttribute('display', '');

      // Reset previous dot, enlarge current
      if (prevHighlightIdx >= 0 && prevHighlightIdx < allDots.length) {
        allDots[prevHighlightIdx].setAttribute('r', '3.5');
      }
      if (nearestIdx < allDots.length) {
        allDots[nearestIdx].setAttribute('r', '6');
      }
      prevHighlightIdx = nearestIdx;

      // Tooltip content
      tooltipDate.textContent = formatTooltipDate(pt.date);
      tooltipPrice.textContent = formatTooltipPrice(pt.price);

      // Tooltip positioning
      var tooltipW = 120;
      var tooltipH = 44;
      var offsetX = 12;
      var offsetY = -tooltipH - 8;

      var tx = pt.x + offsetX;
      var ty = pt.y + offsetY;

      // Shift left if near right edge
      if (tx + tooltipW > W - padRight) {
        tx = pt.x - tooltipW - offsetX;
      }

      // Shift down if near top edge
      if (ty < padTop) {
        ty = pt.y + 12;
      }

      tooltipRect.setAttribute('x', tx);
      tooltipRect.setAttribute('y', ty);
      tooltipDate.setAttribute('x', tx + 8);
      tooltipDate.setAttribute('y', ty + 16);
      tooltipPrice.setAttribute('x', tx + 8);
      tooltipPrice.setAttribute('y', ty + 34);

      tooltip.setAttribute('display', '');
    });

    svg.addEventListener('mouseleave', function () {
      crosshair.setAttribute('display', 'none');
      highlight.setAttribute('display', 'none');
      tooltip.setAttribute('display', 'none');

      // Reset dot radius
      if (prevHighlightIdx >= 0 && prevHighlightIdx < allDots.length) {
        allDots[prevHighlightIdx].setAttribute('r', '3.5');
      }
      prevHighlightIdx = -1;
    });

    wrapper.appendChild(svg);
    container.appendChild(wrapper);
  }

  // ─── List rendering ───────────────────────────────────────────────

  function renderList(container, records, isContentTracker, tracker) {
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
      list.appendChild(renderRecord(sorted[i], decreaseFlags[i], isContentTracker, function (recordId, itemEl) {
        // Animate removal
        itemEl.style.transition = 'opacity 0.3s, transform 0.3s';
        itemEl.style.opacity = '0';
        itemEl.style.transform = 'translateX(20px)';
        // Send delete request
        sendMessage({ action: 'deletePriceRecord', recordId: recordId })
          .then(function () {
            // Re-render the whole history section after deletion
            render(tracker, container);
          })
          .catch(function () {
            // Revert animation on error
            itemEl.style.opacity = '1';
            itemEl.style.transform = '';
          });
      }));
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

        renderList(container, records, isContentTracker, tracker);
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

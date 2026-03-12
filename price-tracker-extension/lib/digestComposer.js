/**
 * DigestComposer — assembles digest messages for Telegram after a check cycle.
 * Collects price changes and formats them into sectioned HTML.
 *
 * Feature: smart-price-tracker-improvements
 */
(function () {

var TELEGRAM_MAX_LENGTH = 4096;

/**
 * Escape special HTML characters for Telegram HTML mode.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract domain from a URL string.
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  if (!url) return '';
  try {
    // Handle both browser and Node environments
    if (typeof URL !== 'undefined') {
      return new URL(url).hostname;
    }
    // Fallback: simple regex extraction
    var match = url.match(/^https?:\/\/([^/?#]+)/);
    return match ? match[1] : '';
  } catch (e) {
    var match = url.match(/^https?:\/\/([^/?#]+)/);
    return match ? match[1] : '';
  }
}

/**
 * Clean up product name: remove marketplace suffixes, "купить по лучшей цене" etc.
 * @param {string} name
 * @returns {string}
 */
function cleanProductName(name) {
  if (!name) return '';
  return name
    // Remove " - купить по лучшей цене в Украине | Makeup.ua" and similar
    .replace(/\s*[-–—:]\s*(купить|купити).*$/i, '')
    // Remove "купить на ▷ EVA.UA ◁" and similar
    .replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '')
    // Remove "Большой ассортимент | notino.ua" and similar
    .replace(/\s*Большой ассортимент.*$/i, '')
    .replace(/\s*Великий асортимент.*$/i, '')
    // Remove trailing " | domain.ua"
    .replace(/\s*\|\s*[\w.]+\s*$/, '')
    .trim();
}

/**
 * Extract variant label (volume, origin) from the raw product name.
 * Looks for patterns like "— 100ml", "— 50ml — 5091", "— из UA — 7483", "— 30".
 * @param {string} name — raw productName from DB
 * @returns {string} — e.g. "100ml", "50ml", "из ЕС", "" if none
 */
function extractVariantLabel(name) {
  if (!name) return '';
  // Pattern: "— из UA [— price]" or "— из ЕС [— price]" (check first, before numbers)
  var match = name.match(/\s*[-–—]\s*(из\s+\S+)\s*(?:[-–—]\s*\d+)?\s*$/i);
  if (match) return match[1];
  // Pattern: "— 100ml [— price]" or "— 30 [— price]"
  match = name.match(/\s*[-–—]\s*(\d+(?:ml)?)\s*(?:[-–—]\s*\d+)?\s*$/i);
  if (match) return match[1] + (/ml/i.test(match[1]) ? '' : 'ml');
  return '';
}

/**
 * Get short marketplace label from domain.
 * @param {string} domain
 * @returns {string}
 */
function getShopLabel(domain) {
  if (!domain) return '';
  if (domain.indexOf('makeup') !== -1) return 'Makeup';
  if (domain.indexOf('eva.ua') !== -1) return 'EVA';
  if (domain.indexOf('notino') !== -1) return 'Notino';
  return domain;
}

/**
 * Format a single digest entry line as Telegram HTML.
 * @param {DigestEntry} entry
 * @returns {string}
 */
function formatEntryHtml(entry) {
  var name = escapeHtml(cleanProductName(entry.productName));
  var variant = extractVariantLabel(entry.productName);
  var sign = entry.percentChange >= 0 ? '+' : '';
  var percentStr = sign + entry.percentChange.toFixed(1) + '%';
  var shop = getShopLabel(entry.domain);
  var variantSuffix = variant ? ' · ' + escapeHtml(variant) : '';
  var line = '• <a href="' + entry.pageUrl + '">' + name + '</a>'
    + '\n   <s>' + entry.oldPrice + '</s> → <b>' + entry.newPrice + '</b> грн'
    + ' (' + percentStr + ') · ' + escapeHtml(shop) + variantSuffix;
  return line;
}


/**
 * Format digest entries into Telegram HTML.
 * Sections: 🏆 Исторический минимум (first), 📉 Цена снизилась, 📈 Цена выросла, ✅ Без изменений (N)
 * @param {DigestEntry[]} entries
 * @param {number} unchangedCount
 * @returns {string}
 */
function formatDigestHtml(entries, unchangedCount) {
  var histMin = [];
  var decreased = [];
  var increased = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry.isHistoricalMinimum) {
      histMin.push(entry);
    } else if (entry.newPrice < entry.oldPrice) {
      decreased.push(entry);
    } else if (entry.newPrice > entry.oldPrice) {
      increased.push(entry);
    }
  }

  var parts = [];

  if (histMin.length > 0) {
    var section = '<b>🏆 Исторический минимум!</b>\n';
    for (var i = 0; i < histMin.length; i++) {
      section += '\n' + formatEntryHtml(histMin[i]);
      if (i < histMin.length - 1) section += '\n';
    }
    parts.push(section);
  }

  if (decreased.length > 0) {
    var section = '<b>📉 Цена снизилась</b>\n';
    for (var i = 0; i < decreased.length; i++) {
      section += '\n' + formatEntryHtml(decreased[i]);
      if (i < decreased.length - 1) section += '\n';
    }
    parts.push(section);
  }

  if (increased.length > 0) {
    var section = '<b>📈 Цена выросла</b>\n';
    for (var i = 0; i < increased.length; i++) {
      section += '\n' + formatEntryHtml(increased[i]);
      if (i < increased.length - 1) section += '\n';
    }
    parts.push(section);
  }

  if (unchangedCount > 0) {
    parts.push('<blockquote>✅ Без изменений (' + unchangedCount + ')</blockquote>');
  }

  return parts.join('\n\n');
}

/**
 * Split a message into chunks that fit within Telegram's 4096 char limit.
 * Splits on double-newline boundaries (section breaks) when possible.
 * @param {string} html
 * @returns {string[]}
 */
function splitMessage(html) {
  if (html.length <= TELEGRAM_MAX_LENGTH) {
    return [html];
  }

  var messages = [];
  var remaining = html;

  while (remaining.length > TELEGRAM_MAX_LENGTH) {
    // Try to split at a double-newline boundary within the limit
    var chunk = remaining.substring(0, TELEGRAM_MAX_LENGTH);
    var splitIdx = chunk.lastIndexOf('\n\n');

    if (splitIdx <= 0) {
      // No good break point — split at last single newline
      splitIdx = chunk.lastIndexOf('\n');
    }
    if (splitIdx <= 0) {
      // No newline at all — hard split at limit
      splitIdx = TELEGRAM_MAX_LENGTH;
    }

    messages.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).replace(/^\n+/, '');
  }

  if (remaining.length > 0) {
    messages.push(remaining);
  }

  return messages;
}

/**
 * Create a new digest collector for a check cycle.
 * @returns {DigestCollector}
 */
function createCollector() {
  var entries = [];
  var unchangedCount = 0;

  return {
    /**
     * Add a price change entry to the digest.
     * @param {Object} tracker — tracker object with productName, pageUrl
     * @param {number} oldPrice
     * @param {number} newPrice
     * @param {boolean} isHistMin — whether this is a historical minimum
     */
    addChange: function (tracker, oldPrice, newPrice, isHistMin) {
      var percentChange = oldPrice !== 0
        ? ((newPrice - oldPrice) / oldPrice) * 100
        : 0;

      entries.push({
        productName: tracker.productName || '',
        pageUrl: tracker.pageUrl || '',
        domain: extractDomain(tracker.pageUrl),
        oldPrice: oldPrice,
        newPrice: newPrice,
        percentChange: percentChange,
        isHistoricalMinimum: !!isHistMin,
      });
    },

    /**
     * Increment the unchanged tracker counter.
     */
    addUnchanged: function () {
      unchangedCount++;
    },

    /**
     * Check if there are any price changes in this digest.
     * @returns {boolean}
     */
    hasChanges: function () {
      return entries.length > 0;
    },

    /**
     * Compose the digest into Telegram HTML message(s).
     * @returns {string[]} — array of HTML strings (split if >4096 chars)
     */
    compose: function () {
      if (entries.length === 0) {
        return [];
      }
      var html = formatDigestHtml(entries, unchangedCount);
      return splitMessage(html);
    },

    /** Expose entries for testing. */
    getEntries: function () { return entries.slice(); },

    /** Expose unchanged count for testing. */
    getUnchangedCount: function () { return unchangedCount; },
  };
}

// Export object
var _digestComposer = {
  createCollector: createCollector,
  formatDigestHtml: formatDigestHtml,
  escapeHtml: escapeHtml,
  extractDomain: extractDomain,
  splitMessage: splitMessage,
  cleanProductName: cleanProductName,
  getShopLabel: getShopLabel,
  extractVariantLabel: extractVariantLabel,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = _digestComposer;
}
if (typeof self !== 'undefined' && typeof self.PriceTracker === 'undefined') {
  self.PriceTracker = {};
}
if (typeof self !== 'undefined') {
  self.PriceTracker.digestComposer = _digestComposer;
}

})();

/**
 * Server-side DigestComposer — assembles Telegram digest messages.
 * Port of the extension's digestComposer without browser IIFE wrappers.
 */

const TELEGRAM_MAX_LENGTH = 4096;

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function extractDomain(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch (e) {
    const match = url.match(/^https?:\/\/([^/?#]+)/);
    return match ? match[1] : '';
  }
}

function cleanProductName(name) {
  if (!name) return '';
  return name
    .replace(/\s*[-–—:]\s*(купить|купити).*$/i, '')
    .replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '')
    .replace(/\s*Большой ассортимент.*$/i, '')
    .replace(/\s*Великий асортимент.*$/i, '')
    .replace(/\s*\|\s*[\w.]+\s*$/, '')
    .trim();
}

/**
 * Extract variant label (volume, origin, set info) from the raw product name.
 * Handles all known patterns from Makeup, EVA, Notino product names.
 * @param {string} name — raw productName from DB
 * @returns {string} — e.g. "50ml", "100ml", "из UA", "120ml тестер", "набор edp/100ml + mini/10ml", "" if none
 */
function extractVariantLabel(name) {
  if (!name) return '';

  // 1. Origin pattern: "— из UA [— price]" or "— из ЕС [— price]"
  var m = name.match(/[\s\-–—]+из\s+(\S+)(?:\s*[\-–—]\s*\d+)?\s*$/i);
  if (m) return 'из ' + m[1];

  // 2. Volume with ml suffix and optional trailing price: "— 50ml — 5091" or "— 50ml"
  m = name.match(/[\s\-–—]+(\d+)\s*ml(?:\s*[\-–—]\s*\d+)?\s*$/i);
  if (m) return m[1] + 'ml';

  // 3. EVA-style bare number at end: "— 100", "— 30", "— 120"
  m = name.match(/[\s\-–—]+(\d{2,4})\s*$/);
  if (m) return m[1] + 'ml';

  // 4. Cyrillic volume in name: "100 мл (ТЕСТЕР)" or "120 мл (тестер)" or "50 мл"
  m = name.match(/(\d+)\s*мл\s*(?:\(([^)]+)\))?\s*/i);
  if (m) {
    var label = m[1] + 'ml';
    if (m[2]) label += ' ' + m[2].toLowerCase();
    return label;
  }

  // 5. Set/bundle in parentheses: "(edp/100ml + edp/mini/10ml)"
  m = name.match(/\(([^)]*\d+\s*ml[^)]*)\)/i);
  if (m) {
    // Shorten: "edp/100ml + edp/mini/10ml" → "100ml + 10ml"
    var parts = m[1].split('+').map(function(p) {
      var vol = p.match(/(\d+)\s*ml/i);
      return vol ? vol[1] + 'ml' : p.trim();
    });
    return 'набор ' + parts.join(' + ');
  }

  return '';
}


function getShopLabel(domain) {
  if (!domain) return '';
  if (domain.indexOf('makeup') !== -1) return 'Makeup';
  if (domain.indexOf('eva.ua') !== -1) return 'EVA';
  if (domain.indexOf('notino') !== -1) return 'Notino';
  return domain;
}

function formatEntryHtml(entry) {
  const name = escapeHtml(cleanProductName(entry.productName));
  const variant = extractVariantLabel(entry.productName);
  const sign = entry.percentChange >= 0 ? '+' : '';
  const percentStr = sign + entry.percentChange.toFixed(1) + '%';
  const shop = getShopLabel(entry.domain);
  const variantSuffix = variant ? ' · ' + escapeHtml(variant) : '';
  return '• <a href="' + entry.pageUrl + '">' + name + '</a>'
    + '\n   <s>' + entry.oldPrice + '</s> → <b>' + entry.newPrice + '</b> грн'
    + ' (' + percentStr + ') · ' + escapeHtml(shop) + variantSuffix;
}

function formatDigestHtml(entries, unchangedCount) {
  const histMin = [];
  const decreased = [];
  const increased = [];

  for (const entry of entries) {
    if (entry.isHistoricalMinimum) histMin.push(entry);
    else if (entry.newPrice < entry.oldPrice) decreased.push(entry);
    else if (entry.newPrice > entry.oldPrice) increased.push(entry);
  }

  const parts = [];

  if (histMin.length > 0) {
    let section = '<b>🏆 Исторический минимум!</b>\n';
    for (let i = 0; i < histMin.length; i++) {
      section += '\n' + formatEntryHtml(histMin[i]);
      if (i < histMin.length - 1) section += '\n';
    }
    parts.push(section);
  }

  if (decreased.length > 0) {
    let section = '<b>📉 Цена снизилась</b>\n';
    for (let i = 0; i < decreased.length; i++) {
      section += '\n' + formatEntryHtml(decreased[i]);
      if (i < decreased.length - 1) section += '\n';
    }
    parts.push(section);
  }

  if (increased.length > 0) {
    let section = '<b>📈 Цена выросла</b>\n';
    for (let i = 0; i < increased.length; i++) {
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

function splitMessage(html) {
  if (html.length <= TELEGRAM_MAX_LENGTH) return [html];

  const messages = [];
  let remaining = html;

  while (remaining.length > TELEGRAM_MAX_LENGTH) {
    const chunk = remaining.substring(0, TELEGRAM_MAX_LENGTH);
    let splitIdx = chunk.lastIndexOf('\n\n');
    if (splitIdx <= 0) splitIdx = chunk.lastIndexOf('\n');
    if (splitIdx <= 0) splitIdx = TELEGRAM_MAX_LENGTH;

    messages.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).replace(/^\n+/, '');
  }

  if (remaining.length > 0) messages.push(remaining);
  return messages;
}

function createCollector() {
  const entries = [];
  let unchangedCount = 0;

  return {
    addChange(tracker, oldPrice, newPrice, isHistMin) {
      const percentChange = oldPrice !== 0
        ? ((newPrice - oldPrice) / oldPrice) * 100 : 0;
      entries.push({
        productName: tracker.productName || '',
        pageUrl: tracker.pageUrl || '',
        domain: extractDomain(tracker.pageUrl),
        oldPrice, newPrice, percentChange,
        isHistoricalMinimum: !!isHistMin,
      });
    },
    addUnchanged() { unchangedCount++; },
    hasChanges() { return entries.length > 0; },
    compose() {
      if (entries.length === 0) return [];
      return splitMessage(formatDigestHtml(entries, unchangedCount));
    },
    getEntries() { return entries.slice(); },
    getUnchangedCount() { return unchangedCount; },
  };
}

module.exports = {
  createCollector,
  formatDigestHtml,
  escapeHtml,
  extractDomain,
  splitMessage,
  cleanProductName,
  getShopLabel,
  extractVariantLabel,
};

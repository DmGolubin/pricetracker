/**
 * Price Parser — extracts numeric price values from text strings.
 *
 * Supported formats:
 *   "1234", "1234.56", "$1,234.56", "€1.234,56",
 *   "1 234.56", "1 234,56", "1 234 ₽"
 *
 * Currency symbols stripped: €, $, ₽, ₴, zł, kn, £, ¥, ₩, ₹, ₺, ₫, ฿, R$, kr
 */

// Currency symbols / words to strip (order matters — R$ before $)
const CURRENCY_PATTERN = /R\$|kr|zł|kn|[€$₽₴£¥₩₹₺₫฿]/gi;

/**
 * Parse a price string into a number.
 * @param {string} text — raw price text
 * @returns {number|null} parsed number or null if unrecognisable
 */
function parsePrice(text) {
  if (text == null || typeof text !== 'string') return null;

  // Strip currency symbols and trim
  let cleaned = text.replace(CURRENCY_PATTERN, '').trim();

  // Remove non-breaking spaces (U+00A0) and narrow no-break spaces (U+202F)
  cleaned = cleaned.replace(/[\u00A0\u202F]/g, ' ');

  if (cleaned.length === 0) return null;

  // Remove regular spaces used as thousand separators
  // (spaces between digit groups, e.g. "1 234 567")
  cleaned = cleaned.replace(/(\d) (\d)/g, '$1$2');
  // Repeat to handle consecutive groups like "1 234 567"
  cleaned = cleaned.replace(/(\d) (\d)/g, '$1$2');

  // After stripping, if nothing numeric remains, bail out
  if (!/\d/.test(cleaned)) return null;

  // Determine the decimal separator.
  // Heuristic: look at the last separator character (dot or comma).
  //   - If the last separator has exactly 3 digits after it AND there is
  //     another separator of the same kind before it, it's a thousand sep.
  //   - Otherwise the last separator is the decimal point.

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');

  let result;

  if (lastDot === -1 && lastComma === -1) {
    // No separators — plain integer
    result = Number(cleaned);
  } else if (lastDot !== -1 && lastComma === -1) {
    // Only dots present
    const afterDot = cleaned.length - lastDot - 1;
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      // Multiple dots → dots are thousand separators (e.g. "1.234.567")
      result = Number(cleaned.replace(/\./g, ''));
    } else if (afterDot === 3 && /^\d{1,3}$/.test(cleaned.slice(0, lastDot))) {
      // Single dot with exactly 3 digits after and 1-3 digits before → thousand sep
      // e.g. "1.234" is ambiguous; treat as 1234 (European thousand separator)
      // BUT "1.234" could also be 1.234 — we follow the convention that
      // a single dot with exactly 3 trailing digits is a thousand separator
      // only when the integer part is 1-3 digits. This matches "1.234" → 1234.
      // For "12.34" → 12.34 (decimal).
      result = Number(cleaned.replace(/\./g, ''));
    } else {
      // Dot is decimal separator
      result = Number(cleaned.replace(/,/g, ''));
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    // Only commas present
    const afterComma = cleaned.length - lastComma - 1;
    const commaCount = (cleaned.match(/,/g) || []).length;
    if (commaCount > 1) {
      // Multiple commas → commas are thousand separators (e.g. "1,234,567")
      result = Number(cleaned.replace(/,/g, ''));
    } else if (afterComma === 3) {
      // Single comma with exactly 3 digits after → thousand separator
      // e.g. "1,234" → 1234
      result = Number(cleaned.replace(/,/g, ''));
    } else {
      // Comma is decimal separator (e.g. "12,5" or "1234,56")
      result = Number(cleaned.replace(',', '.'));
    }
  } else {
    // Both dots and commas present — whichever comes last is the decimal separator
    if (lastComma > lastDot) {
      // Comma is decimal, dots are thousands (European: "1.234,56")
      result = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    } else {
      // Dot is decimal, commas are thousands (US/UK: "1,234.56")
      result = Number(cleaned.replace(/,/g, ''));
    }
  }

  if (result == null || isNaN(result) || !isFinite(result)) return null;

  return result;
}

module.exports = { parsePrice };

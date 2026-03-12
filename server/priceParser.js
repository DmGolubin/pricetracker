/**
 * Price Parser — server-side copy of the extension's price parser.
 * Extracts numeric price values from text strings.
 */

const CURRENCY_PATTERN = /R\$|kr|zł|kn|[€$₽₴£¥₩₹₺₫฿]/gi;

function parsePrice(text) {
  if (text == null || typeof text !== 'string') return null;

  let cleaned = text.replace(CURRENCY_PATTERN, '').trim();
  cleaned = cleaned.replace(/[\u00A0\u202F]/g, ' ');
  if (cleaned.length === 0) return null;

  cleaned = cleaned.replace(/(\d) (\d)/g, '$1$2');
  cleaned = cleaned.replace(/(\d) (\d)/g, '$1$2');

  if (!/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let result;

  if (lastDot === -1 && lastComma === -1) {
    result = Number(cleaned);
  } else if (lastDot !== -1 && lastComma === -1) {
    const afterDot = cleaned.length - lastDot - 1;
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      result = Number(cleaned.replace(/\./g, ''));
    } else if (afterDot === 3 && /^\d{1,3}$/.test(cleaned.slice(0, lastDot))) {
      result = Number(cleaned.replace(/\./g, ''));
    } else {
      result = Number(cleaned.replace(/,/g, ''));
    }
  } else if (lastComma !== -1 && lastDot === -1) {
    const afterComma = cleaned.length - lastComma - 1;
    const commaCount = (cleaned.match(/,/g) || []).length;
    if (commaCount > 1) {
      result = Number(cleaned.replace(/,/g, ''));
    } else if (afterComma === 3) {
      result = Number(cleaned.replace(/,/g, ''));
    } else {
      result = Number(cleaned.replace(',', '.'));
    }
  } else {
    if (lastComma > lastDot) {
      result = Number(cleaned.replace(/\./g, '').replace(',', '.'));
    } else {
      result = Number(cleaned.replace(/,/g, ''));
    }
  }

  if (result == null || isNaN(result) || !isFinite(result)) return null;
  return result;
}

module.exports = { parsePrice };

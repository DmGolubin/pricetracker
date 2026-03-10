/**
 * Unit tests for lib/priceParser.js
 */
const { parsePrice } = require('../../lib/priceParser');

describe('parsePrice', () => {
  // --- Standard numeric formats ---
  describe('standard formats', () => {
    test('plain integer', () => {
      expect(parsePrice('1234')).toBe(1234);
    });

    test('decimal with dot', () => {
      expect(parsePrice('1234.56')).toBe(1234.56);
    });

    test('US format with dollar sign', () => {
      expect(parsePrice('$1,234.56')).toBe(1234.56);
    });

    test('European format with euro sign', () => {
      expect(parsePrice('€1.234,56')).toBe(1234.56);
    });

    test('large US format', () => {
      expect(parsePrice('$12,345,678.99')).toBe(12345678.99);
    });

    test('large European format', () => {
      expect(parsePrice('€12.345.678,99')).toBe(12345678.99);
    });
  });

  // --- Space-separated thousands ---
  describe('space-separated formats', () => {
    test('space thousands with dot decimal', () => {
      expect(parsePrice('1 234.56')).toBe(1234.56);
    });

    test('space thousands with comma decimal', () => {
      expect(parsePrice('1 234,56')).toBe(1234.56);
    });

    test('space thousands with currency suffix', () => {
      expect(parsePrice('1 234 ₽')).toBe(1234);
    });

    test('multiple space groups', () => {
      expect(parsePrice('1 234 567')).toBe(1234567);
    });

    test('space thousands with non-breaking space', () => {
      expect(parsePrice('1\u00A0234.56')).toBe(1234.56);
    });
  });

  // --- Currency symbols ---
  describe('currency symbols', () => {
    test('dollar at start', () => {
      expect(parsePrice('$99.99')).toBe(99.99);
    });

    test('euro at start', () => {
      expect(parsePrice('€49,99')).toBe(49.99);
    });

    test('ruble at end', () => {
      expect(parsePrice('1234 ₽')).toBe(1234);
    });

    test('hryvnia at end', () => {
      expect(parsePrice('999₴')).toBe(999);
    });

    test('zloty', () => {
      expect(parsePrice('99,99 zł')).toBe(99.99);
    });

    test('kuna', () => {
      expect(parsePrice('1.234,56 kn')).toBe(1234.56);
    });

    test('pound', () => {
      expect(parsePrice('£1,234.56')).toBe(1234.56);
    });

    test('yen', () => {
      expect(parsePrice('¥1234')).toBe(1234);
    });

    test('won', () => {
      expect(parsePrice('₩50000')).toBe(50000);
    });

    test('rupee', () => {
      expect(parsePrice('₹1,234.56')).toBe(1234.56);
    });

    test('lira', () => {
      expect(parsePrice('₺999,99')).toBe(999.99);
    });

    test('dong', () => {
      expect(parsePrice('₫100000')).toBe(100000);
    });

    test('baht', () => {
      expect(parsePrice('฿999.50')).toBe(999.50);
    });

    test('real (R$)', () => {
      expect(parsePrice('R$1.234,56')).toBe(1234.56);
    });

    test('krona (kr)', () => {
      expect(parsePrice('kr 1 234,56')).toBe(1234.56);
    });
  });

  // --- Edge cases returning null ---
  describe('edge cases (null)', () => {
    test('empty string', () => {
      expect(parsePrice('')).toBeNull();
    });

    test('whitespace only', () => {
      expect(parsePrice('   ')).toBeNull();
    });

    test('currency symbol only', () => {
      expect(parsePrice('$')).toBeNull();
    });

    test('alphabetic text', () => {
      expect(parsePrice('abc')).toBeNull();
    });

    test('null input', () => {
      expect(parsePrice(null)).toBeNull();
    });

    test('undefined input', () => {
      expect(parsePrice(undefined)).toBeNull();
    });

    test('multiple currency symbols only', () => {
      expect(parsePrice('€$£')).toBeNull();
    });
  });

  // --- Comma as thousand separator (US) ---
  describe('comma as thousand separator', () => {
    test('single comma group', () => {
      expect(parsePrice('1,234')).toBe(1234);
    });

    test('multiple comma groups', () => {
      expect(parsePrice('1,234,567')).toBe(1234567);
    });
  });

  // --- Comma as decimal separator ---
  describe('comma as decimal separator', () => {
    test('two decimal digits', () => {
      expect(parsePrice('12,50')).toBe(12.50);
    });

    test('one decimal digit', () => {
      expect(parsePrice('12,5')).toBe(12.5);
    });
  });
});

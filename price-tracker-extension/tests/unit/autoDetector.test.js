/**
 * Unit tests for Auto Detector content script.
 *
 * Since autoDetector.js is a self-contained IIFE, we test it by
 * evaluating the script in jsdom and checking the data-pt-auto-detect
 * attribute on document.documentElement.
 *
 * Requirements: 13.1, 13.2
 */
const fs = require('fs');
const path = require('path');

const DETECTOR_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../../content/autoDetector.js'),
  'utf-8'
);

function runDetector() {
  eval(DETECTOR_SCRIPT);
}

function getResult() {
  var raw = document.documentElement.getAttribute('data-pt-auto-detect');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

/**
 * Helper: set up a minimal product page with a visible price element.
 */
function setupPriceElement(html, opts) {
  document.body.innerHTML = html;
  opts = opts || {};
  var fontSize = opts.fontSize || '24px';
  var top = opts.top || 100;

  var origGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (el) {
    var base = origGetComputedStyle.call(window, el);
    return new Proxy(base, {
      get: function (target, prop) {
        if (prop === 'fontSize') return fontSize;
        if (prop === 'display') return 'block';
        if (prop === 'visibility') return 'visible';
        if (prop === 'opacity') return '1';
        return target[prop];
      }
    });
  };

  var allEls = document.body.querySelectorAll('*');
  allEls.forEach(function (el) {
    if (!el.offsetParent && el !== document.body && el !== document.documentElement) {
      Object.defineProperty(el, 'offsetParent', { get: function () { return document.body; }, configurable: true });
    }
    el.getBoundingClientRect = function () {
      return { top: top, left: 0, right: 200, bottom: top + 30, width: 200, height: 30 };
    };
  });

  return function restore() {
    window.getComputedStyle = origGetComputedStyle;
  };
}

describe('AutoDetector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-pt-auto-detect');
    jest.clearAllMocks();
  });

  describe('Meta tag detection', () => {
    test('detects price from og:price:amount meta tag', () => {
      document.head.innerHTML = '<meta property="og:price:amount" content="29.99">';
      var restore = setupPriceElement('<span class="price">$29.99</span>');
      runDetector();
      restore();
      var r = getResult();
      expect(r).toBeDefined();
      expect(r.found).toBe(true);
      expect(r.price).toBe(29.99);
      expect(r.selector).toBeTruthy();
      expect(r.pageUrl).toBeDefined();
    });

    test('detects price from product:price:amount meta tag', () => {
      document.head.innerHTML = '<meta property="product:price:amount" content="149.00">';
      var restore = setupPriceElement('<span class="price">$149.00</span>');
      runDetector();
      restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(149);
    });
  });

  describe('JSON-LD detection', () => {
    test('detects price from JSON-LD Product with offers', () => {
      var jsonLd = { '@context': 'https://schema.org', '@type': 'Product', name: 'Test', offers: { '@type': 'Offer', price: 59.99, priceCurrency: 'USD' } };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$59.99</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(59.99);
    });

    test('detects price from JSON-LD with @graph array', () => {
      var jsonLd = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', offers: { '@type': 'Offer', price: '25.00' } }] };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$25.00</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(25);
    });

    test('detects price from JSON-LD AggregateOffer with lowPrice', () => {
      var jsonLd = { '@type': 'Product', offers: { '@type': 'AggregateOffer', lowPrice: 10.00, highPrice: 50.00 } };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$10.00</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(10);
    });

    test('handles invalid JSON-LD gracefully', () => {
      document.head.innerHTML = '<script type="application/ld+json">{ invalid json }</script>';
      var restore = setupPriceElement('<span class="price">$15.00</span>');
      runDetector(); restore();
      expect(getResult().found).toBe(true);
      expect(getResult().price).toBe(15);
    });

    test('detects price from JSON-LD array of offers', () => {
      var jsonLd = { '@type': 'Product', offers: [{ '@type': 'Offer', price: 30.00 }, { '@type': 'Offer', price: 35.00 }] };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$30.00</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(30);
    });
  });

  describe('DOM element detection with currency symbols', () => {
    test('detects price from element with $ symbol', () => {
      var restore = setupPriceElement('<div id="price">$199.99</div>');
      runDetector(); restore();
      expect(getResult().price).toBe(199.99);
    });

    test('detects price from element with € symbol', () => {
      var restore = setupPriceElement('<span id="price">€49,99</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(49.99);
    });

    test('detects price from element with ₽ symbol', () => {
      var restore = setupPriceElement('<span id="price">1 500 ₽</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(1500);
    });

    test('detects price from element with £ symbol', () => {
      var restore = setupPriceElement('<span id="price">£29.99</span>');
      runDetector(); restore();
      expect(getResult().price).toBe(29.99);
    });
  });

  describe('Failure cases', () => {
    test('sets found=false when no price found on page', () => {
      document.body.innerHTML = '<div>No prices here</div>';
      runDetector();
      var r = getResult();
      expect(r).toBeDefined();
      expect(r.found).toBe(false);
    });

    test('sets found=false on empty page', () => {
      document.body.innerHTML = '';
      runDetector();
      expect(getResult().found).toBe(false);
    });
  });

  describe('Result message format', () => {
    test('includes title from document.title', () => {
      document.title = 'Test Product Page';
      var restore = setupPriceElement('<span id="price">$50.00</span>');
      runDetector(); restore();
      expect(getResult().title).toBe('Test Product Page');
    });

    test('includes pageUrl from location.href', () => {
      var restore = setupPriceElement('<span id="price">$50.00</span>');
      runDetector(); restore();
      expect(typeof getResult().pageUrl).toBe('string');
    });

    test('includes imageUrl from og:image meta tag', () => {
      document.head.innerHTML = '<meta property="og:image" content="https://example.com/product.jpg">';
      var restore = setupPriceElement('<span id="price">$50.00</span>');
      runDetector(); restore();
      expect(getResult().imageUrl).toBe('https://example.com/product.jpg');
    });

    test('includes a valid CSS selector', () => {
      var restore = setupPriceElement('<span id="price">$50.00</span>');
      runDetector(); restore();
      var r = getResult();
      expect(r.selector).toBeTruthy();
      expect(document.querySelector(r.selector)).not.toBeNull();
    });
  });

  describe('Site-specific detection (Notino)', () => {
    test('detects price from Notino span[data-testid="pd-price"] content attribute', () => {
      var restore = setupPriceElement(
        '<div id="pd-price"><span data-testid="pd-price" content="3&nbsp;065">3&nbsp;065</span> <span data-testid="pd-currency">₴</span></div>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(3065);
      expect(r.selector).toBeTruthy();
    });

    test('prefers regular Notino price over promo/voucher price', () => {
      var restore = setupPriceElement(
        '<div>' +
          '<div id="pd-price"><span data-testid="pd-price" content="3&nbsp;150">3 150</span> <span data-testid="currency-variant">₴</span></div>' +
          '<span class="dlmrqim"><span data-testid="pd-price-wrapper"><span content="2&nbsp;675">2 675</span> <span data-testid="currency-variant">₴</span></span></span>' +
        '</div>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(3150);
    });

    test('falls back to regular Notino price when no promo price', () => {
      var restore = setupPriceElement(
        '<div id="pd-price"><span data-testid="pd-price" content="3&nbsp;150">3 150</span> <span data-testid="currency-variant">₴</span></div>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(3150);
    });

    test('detects price from Notino content attr with non-breaking space', () => {
      var restore = setupPriceElement(
        '<span data-testid="pd-price" content="1\u00A0250">1\u00A0250</span>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(1250);
    });

    test('detects price from generic data-testid price element with content attr', () => {
      var restore = setupPriceElement(
        '<span data-testid="price-variant" content="2&nbsp;500">2 500</span>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(2500);
    });

    test('falls back to textContent when content attr is missing on Notino', () => {
      var restore = setupPriceElement(
        '<span data-testid="pd-price">3 065 ₴</span>'
      );
      runDetector(); restore();
      var r = getResult();
      expect(r.found).toBe(true);
      expect(r.price).toBe(3065);
    });
  });

  describe('Scoring and candidate selection', () => {
    test('prefers structured data price when DOM element matches', () => {
      var jsonLd = { '@type': 'Product', offers: { '@type': 'Offer', price: 99.99 } };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<div><span id="old-price">$120.00</span><span id="price">$99.99</span></div>');
      runDetector(); restore();
      expect(getResult().price).toBe(99.99);
    });

    test('falls back to DOM detection when no structured data', () => {
      var restore = setupPriceElement('<div id="price">$75.50</div>');
      runDetector(); restore();
      expect(getResult().price).toBe(75.5);
    });
  });
});

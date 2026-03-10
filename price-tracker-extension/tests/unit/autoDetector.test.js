/**
 * Unit tests for Auto Detector content script.
 *
 * Since autoDetector.js is a self-contained IIFE, we test it by
 * evaluating the script in jsdom and checking chrome.runtime.sendMessage calls.
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

/**
 * Helper: set up a minimal product page with a visible price element.
 * jsdom doesn't compute layout, so we mock getComputedStyle and getBoundingClientRect.
 */
function setupPriceElement(html, opts) {
  document.body.innerHTML = html;
  opts = opts || {};
  var fontSize = opts.fontSize || '24px';
  var top = opts.top || 100;

  // jsdom doesn't compute styles — override getComputedStyle
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

  // Mock offsetParent for visibility check
  var priceEls = document.querySelectorAll('[data-price], .price, #price, .product-price');
  priceEls.forEach(function (el) {
    Object.defineProperty(el, 'offsetParent', { get: function () { return document.body; }, configurable: true });
    el.getBoundingClientRect = function () {
      return { top: top, left: 0, right: 200, bottom: top + 30, width: 200, height: 30 };
    };
  });

  // Also handle generic elements that contain currency
  var allEls = document.body.querySelectorAll('*');
  allEls.forEach(function (el) {
    if (!el.offsetParent && el !== document.body && el !== document.documentElement) {
      Object.defineProperty(el, 'offsetParent', { get: function () { return document.body; }, configurable: true });
    }
    if (!el.getBoundingClientRect.__mocked) {
      el.getBoundingClientRect = function () {
        return { top: top, left: 0, right: 200, bottom: top + 30, width: 200, height: 30 };
      };
      el.getBoundingClientRect.__mocked = true;
    }
  });

  return function restore() {
    window.getComputedStyle = origGetComputedStyle;
  };
}

describe('AutoDetector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    jest.clearAllMocks();
  });

  describe('Meta tag detection', () => {
    test('detects price from og:price:amount meta tag', () => {
      document.head.innerHTML = '<meta property="og:price:amount" content="29.99">';
      var restore = setupPriceElement('<span class="price">$29.99</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 29.99
        })
      );
      var call = chrome.runtime.sendMessage.mock.calls[0][0];
      expect(call.selector).toBeTruthy();
      expect(call.pageUrl).toBeDefined();
    });

    test('detects price from product:price:amount meta tag', () => {
      document.head.innerHTML = '<meta property="product:price:amount" content="149.00">';
      var restore = setupPriceElement('<span class="price">$149.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 149
        })
      );
    });
  });

  describe('JSON-LD detection', () => {
    test('detects price from JSON-LD Product with offers', () => {
      var jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Test Product',
        offers: {
          '@type': 'Offer',
          price: 59.99,
          priceCurrency: 'USD'
        }
      };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$59.99</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 59.99
        })
      );
    });

    test('detects price from JSON-LD with @graph array', () => {
      var jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebPage', name: 'Page' },
          {
            '@type': 'Product',
            name: 'Widget',
            offers: { '@type': 'Offer', price: '25.00' }
          }
        ]
      };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$25.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 25
        })
      );
    });

    test('detects price from JSON-LD AggregateOffer with lowPrice', () => {
      var jsonLd = {
        '@type': 'Product',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: 10.00,
          highPrice: 50.00
        }
      };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$10.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 10
        })
      );
    });

    test('handles invalid JSON-LD gracefully', () => {
      document.head.innerHTML = '<script type="application/ld+json">{ invalid json }</script>';
      var restore = setupPriceElement('<span class="price">$15.00</span>');

      runDetector();
      restore();

      // Should still detect via DOM search
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 15
        })
      );
    });

    test('detects price from JSON-LD array of offers', () => {
      var jsonLd = {
        '@type': 'Product',
        offers: [
          { '@type': 'Offer', price: 30.00 },
          { '@type': 'Offer', price: 35.00 }
        ]
      };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement('<span class="price">$30.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 30
        })
      );
    });
  });

  describe('DOM element detection with currency symbols', () => {
    test('detects price from element with $ symbol', () => {
      var restore = setupPriceElement('<div id="price">$199.99</div>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 199.99
        })
      );
    });

    test('detects price from element with € symbol', () => {
      var restore = setupPriceElement('<span id="price">€49,99</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 49.99
        })
      );
    });

    test('detects price from element with ₽ symbol', () => {
      var restore = setupPriceElement('<span id="price">1 500 ₽</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 1500
        })
      );
    });

    test('detects price from element with £ symbol', () => {
      var restore = setupPriceElement('<span id="price">£29.99</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 29.99
        })
      );
    });
  });

  describe('Failure cases', () => {
    test('sends autoDetectFailed when no price found on page', () => {
      document.body.innerHTML = '<div>No prices here</div>';

      runDetector();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'autoDetectFailed'
      });
    });

    test('sends autoDetectFailed on empty page', () => {
      document.body.innerHTML = '';

      runDetector();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'autoDetectFailed'
      });
    });
  });

  describe('Result message format', () => {
    test('includes title from document.title', () => {
      document.title = 'Test Product Page';
      var restore = setupPriceElement('<span id="price">$50.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          title: 'Test Product Page'
        })
      );
    });

    test('includes pageUrl from location.href', () => {
      var restore = setupPriceElement('<span id="price">$50.00</span>');

      runDetector();
      restore();

      var call = chrome.runtime.sendMessage.mock.calls[0][0];
      expect(call.pageUrl).toBeDefined();
      expect(typeof call.pageUrl).toBe('string');
    });

    test('includes imageUrl from og:image meta tag', () => {
      document.head.innerHTML = '<meta property="og:image" content="https://example.com/product.jpg">';
      var restore = setupPriceElement('<span id="price">$50.00</span>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          imageUrl: 'https://example.com/product.jpg'
        })
      );
    });

    test('includes a valid CSS selector', () => {
      var restore = setupPriceElement('<span id="price">$50.00</span>');

      runDetector();
      restore();

      var call = chrome.runtime.sendMessage.mock.calls[0][0];
      expect(call.selector).toBeTruthy();
      // Verify the selector actually finds an element
      var found = document.querySelector(call.selector);
      expect(found).not.toBeNull();
    });
  });

  describe('Scoring and candidate selection', () => {
    test('prefers structured data price when DOM element matches', () => {
      var jsonLd = {
        '@type': 'Product',
        offers: { '@type': 'Offer', price: 99.99 }
      };
      document.head.innerHTML = '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</script>';
      var restore = setupPriceElement(
        '<div><span id="old-price">$120.00</span><span id="price">$99.99</span></div>'
      );

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 99.99
        })
      );
    });

    test('falls back to DOM detection when no structured data', () => {
      var restore = setupPriceElement('<div id="price">$75.50</div>');

      runDetector();
      restore();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'autoDetected',
          price: 75.5
        })
      );
    });
  });
});

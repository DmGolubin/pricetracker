/**
 * Unit tests for Price Extractor content script.
 *
 * Since priceExtractor.js is a self-contained IIFE, we test it by
 * setting window.__ptExtractData and evaluating the script in jsdom.
 */
const fs = require('fs');
const path = require('path');

const EXTRACTOR_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../../content/priceExtractor.js'),
  'utf-8'
);

function runExtractor(extractData) {
  window.__ptExtractData = extractData;
  eval(EXTRACTOR_SCRIPT);
}

function cleanup() {
  delete window.__ptExtractData;
}

describe('PriceExtractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    cleanup();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Missing or invalid extract data', () => {
    test('does nothing when __ptExtractData is not set', () => {
      delete window.__ptExtractData;
      eval(EXTRACTOR_SCRIPT);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('does nothing when trackerId is missing', () => {
      runExtractor({ cssSelector: '.price' });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('does nothing when cssSelector is missing', () => {
      runExtractor({ trackerId: 'abc' });
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Element not found', () => {
    test('sends extractionFailed when element not found', () => {
      jest.useFakeTimers();
      document.body.innerHTML = '<div>Hello</div>';
      runExtractor({
        trackerId: 'tracker-1',
        cssSelector: '#nonexistent',
        trackingType: 'price'
      });

      // Advance through all 5 retries (MAX_RETRIES=5, RETRY_DELAY=1000)
      for (let i = 0; i < 5; i++) {
        jest.advanceTimersByTime(1000);
      }

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'extractionFailed',
        trackerId: 'tracker-1',
        error: 'Element not found for selector: #nonexistent'
      });
      jest.useRealTimers();
    });

    test('sends extractionFailed for invalid CSS selector', () => {
      document.body.innerHTML = '<div>Hello</div>';
      runExtractor({
        trackerId: 'tracker-2',
        cssSelector: '[[[invalid',
        trackingType: 'price'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'extractionFailed',
          trackerId: 'tracker-2'
        })
      );
      expect(chrome.runtime.sendMessage.mock.calls[0][0].error).toMatch(/selector/i);
    });
  });

  describe('Price extraction', () => {
    test('extracts price from element text', () => {
      document.body.innerHTML = '<span id="price">$29.99</span>';
      runExtractor({
        trackerId: 'tracker-3',
        cssSelector: '#price',
        trackingType: 'price'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-3',
        price: 29.99
      });
    });

    test('extracts European format price', () => {
      document.body.innerHTML = '<span class="cost">€1.234,56</span>';
      runExtractor({
        trackerId: 'tracker-4',
        cssSelector: '.cost',
        trackingType: 'price'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-4',
        price: 1234.56
      });
    });

    test('extracts integer price', () => {
      document.body.innerHTML = '<div id="p">500 ₽</div>';
      runExtractor({
        trackerId: 'tracker-5',
        cssSelector: '#p',
        trackingType: 'price'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-5',
        price: 500
      });
    });

    test('sends extractionFailed when price cannot be parsed', () => {
      document.body.innerHTML = '<span id="no-price">Out of stock</span>';
      runExtractor({
        trackerId: 'tracker-6',
        cssSelector: '#no-price',
        trackingType: 'price'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'extractionFailed',
          trackerId: 'tracker-6'
        })
      );
      expect(chrome.runtime.sendMessage.mock.calls[0][0].error).toContain('Could not parse price');
    });

    test('defaults to price tracking when trackingType is not specified', () => {
      document.body.innerHTML = '<span id="def">$10</span>';
      runExtractor({
        trackerId: 'tracker-default',
        cssSelector: '#def'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-default',
        price: 10
      });
    });
  });

  describe('Content extraction', () => {
    test('extracts text content for content trackers', () => {
      document.body.innerHTML = '<div id="status">In Stock - Available</div>';
      runExtractor({
        trackerId: 'tracker-7',
        cssSelector: '#status',
        trackingType: 'content'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'contentExtracted',
        trackerId: 'tracker-7',
        content: 'In Stock - Available'
      });
    });

    test('extracts empty content without error', () => {
      document.body.innerHTML = '<div id="empty"></div>';
      runExtractor({
        trackerId: 'tracker-8',
        cssSelector: '#empty',
        trackingType: 'content'
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'contentExtracted',
        trackerId: 'tracker-8',
        content: ''
      });
    });
  });

  describe('Excluded selectors', () => {
    test('excludes nested elements from price extraction', () => {
      document.body.innerHTML =
        '<div id="price-block">' +
          '<span class="amount">$50.00</span>' +
          '<span class="old-price">$70.00</span>' +
        '</div>';
      runExtractor({
        trackerId: 'tracker-9',
        cssSelector: '#price-block',
        trackingType: 'price',
        excludedSelectors: ['.old-price']
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-9',
        price: 50
      });
    });

    test('excludes nested elements from content extraction', () => {
      document.body.innerHTML =
        '<div id="info">' +
          '<span class="main">Main text</span>' +
          '<span class="ad">Advertisement</span>' +
        '</div>';
      runExtractor({
        trackerId: 'tracker-10',
        cssSelector: '#info',
        trackingType: 'content',
        excludedSelectors: ['.ad']
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'contentExtracted',
        trackerId: 'tracker-10',
        content: 'Main text'
      });
    });

    test('handles multiple excluded selectors', () => {
      document.body.innerHTML =
        '<div id="complex">' +
          '<span class="price">$25.00</span>' +
          '<span class="tax">+ tax</span>' +
          '<span class="shipping">free shipping</span>' +
        '</div>';
      runExtractor({
        trackerId: 'tracker-11',
        cssSelector: '#complex',
        trackingType: 'price',
        excludedSelectors: ['.tax', '.shipping']
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-11',
        price: 25
      });
    });

    test('works correctly with empty excludedSelectors array', () => {
      document.body.innerHTML = '<span id="simple">$99</span>';
      runExtractor({
        trackerId: 'tracker-12',
        cssSelector: '#simple',
        trackingType: 'price',
        excludedSelectors: []
      });

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'priceExtracted',
        trackerId: 'tracker-12',
        price: 99
      });
    });
  });
});

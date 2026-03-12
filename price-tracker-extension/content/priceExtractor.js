/**
 * Price Extractor — Content Script
 *
 * Self-contained IIFE injected into web pages during price checking.
 * Extracts price or content from a page element using a saved CSS selector,
 * then sends the result back to the service worker.
 *
 * The service worker sets `window.__ptExtractData` before injecting this script:
 *   { trackerId, cssSelector, trackingType, excludedSelectors }
 *
 * Messages sent via chrome.runtime.sendMessage:
 *   { action: "priceExtracted", trackerId, price }
 *   { action: "contentExtracted", trackerId, content }
 *   { action: "extractionFailed", trackerId, error }
 *
 * Requirements: 7.2, 7.4, 15.2
 */
(function () {
  'use strict';

  // ─── Read extraction data ──────────────────────────────────────────

  var data = window.__ptExtractData;
  if (!data || !data.trackerId || !data.cssSelector) {
    // Nothing to do — script was injected without proper data
    return;
  }

  var trackerId = data.trackerId;
  var cssSelector = data.cssSelector;
  var trackingType = data.trackingType || 'price';
  var excludedSelectors = data.excludedSelectors || [];
  var variantSelector = data.variantSelector || '';

  // ─── Inlined: Price Parser ─────────────────────────────────────────

  var CURRENCY_RE = /R\$|kr|zł|kn|[€$₽₴£¥₩₹₺₫฿]/gi;

  function parsePrice(text) {
    if (text == null || typeof text !== 'string') return null;
    var c = text.replace(CURRENCY_RE, '').trim();
    c = c.replace(/[\u00A0\u202F]/g, ' ');
    if (!c.length) return null;
    c = c.replace(/(\d) (\d)/g, '$1$2');
    c = c.replace(/(\d) (\d)/g, '$1$2');
    if (!/\d/.test(c)) return null;

    var lastDot = c.lastIndexOf('.');
    var lastComma = c.lastIndexOf(',');
    var result;

    if (lastDot === -1 && lastComma === -1) {
      result = Number(c);
    } else if (lastDot !== -1 && lastComma === -1) {
      var afterDot = c.length - lastDot - 1;
      var dotCount = (c.match(/\./g) || []).length;
      if (dotCount > 1) {
        result = Number(c.replace(/\./g, ''));
      } else if (afterDot === 3 && /^\d{1,3}$/.test(c.slice(0, lastDot))) {
        result = Number(c.replace(/\./g, ''));
      } else {
        result = Number(c.replace(/,/g, ''));
      }
    } else if (lastComma !== -1 && lastDot === -1) {
      var afterComma = c.length - lastComma - 1;
      var commaCount = (c.match(/,/g) || []).length;
      if (commaCount > 1) {
        result = Number(c.replace(/,/g, ''));
      } else if (afterComma === 3) {
        result = Number(c.replace(/,/g, ''));
      } else {
        result = Number(c.replace(',', '.'));
      }
    } else {
      if (lastComma > lastDot) {
        result = Number(c.replace(/\./g, '').replace(',', '.'));
      } else {
        result = Number(c.replace(/,/g, ''));
      }
    }

    if (result == null || isNaN(result) || !isFinite(result)) return null;
    return result;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  // Block-level tags that should produce line breaks between content chunks
  var BLOCK_TAGS = /^(DIV|P|LI|TR|DT|DD|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|MAIN|BLOCKQUOTE|FIGURE|FIGCAPTION|DETAILS|SUMMARY|UL|OL|DL|TABLE|THEAD|TBODY|TFOOT|FIELDSET|FORM|PRE|ADDRESS)$/;

  /**
   * Recursively extract text from a DOM tree, inserting newlines between
   * block-level elements so the output is human-readable regardless of site.
   */
  function extractReadableText(node) {
    if (node.nodeType === 3) { // Text node
      return node.textContent || '';
    }
    if (node.nodeType !== 1) return ''; // Not an element

    var tag = node.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return '';

    var parts = [];
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) {
      parts.push(extractReadableText(children[i]));
    }
    var text = parts.join('');

    if (BLOCK_TAGS.test(tag)) {
      text = '\n' + text + '\n';
    }

    return text;
  }

  /**
   * Clean up extracted text: collapse multiple newlines, trim each line,
   * remove empty lines, and trim the whole result.
   */
  function cleanExtractedText(raw) {
    return raw
      .split('\n')
      .map(function (line) { return line.replace(/[\s\u00A0\u202F]+/g, ' ').trim(); })
      .filter(function (line) { return line.length > 0; })
      .join('\n')
      .trim();
  }

  function getTextContent(el, excluded) {
    var target = el;
    if (excluded && excluded.length) {
      target = el.cloneNode(true);
      excluded.forEach(function (sel) {
        var nodes = target.querySelectorAll(sel);
        nodes.forEach(function (node) { node.remove(); });
      });
    }
    return cleanExtractedText(extractReadableText(target));
  }

  // ─── Selector fallback: strip <font> tags (Google Translate artifacts) ──

  /**
   * Generate fallback selectors by removing font/i/b tag segments
   * that are commonly injected by Google Translate or browser extensions.
   * Also tries progressively shorter parent selectors.
   *
   * Example: "span > span > font > font" → ["span > span > font", "span > span"]
   */
  function generateFallbackSelectors(selector) {
    var fallbacks = [];
    // Split by combinators (>, space) and rebuild without font/i/b tags
    var parts = selector.split(/\s*>\s*/);
    var translationTags = /^(font|i|b)(:nth-child\(\d+\))?$/i;

    // First: try the selector with all font/i/b parts stripped
    var cleaned = parts.filter(function (p) { return !translationTags.test(p.trim()); });
    if (cleaned.length > 0 && cleaned.length < parts.length) {
      fallbacks.push(cleaned.join(' > '));
    }

    // Then: try progressively shorter parent selectors
    for (var i = parts.length - 1; i >= 1; i--) {
      var shorter = parts.slice(0, i).join(' > ');
      if (fallbacks.indexOf(shorter) === -1) {
        fallbacks.push(shorter);
      }
    }

    return fallbacks;
  }

  // ─── Extraction with retry for dynamic pages ───────────────────────

  var MAX_RETRIES = 5;
  var RETRY_DELAY = 1000; // ms
  var VARIANT_SETTLE_DELAY = 1500; // ms — wait for DOM to update after variant click

  function findElement(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  /**
   * Click a variant element (if variantSelector is set) and wait for DOM to settle.
   * This handles pages like makeup.ua where selecting a volume/variant
   * changes the price dynamically without page reload.
   */
  function clickVariantAndWait(callback) {
    if (!variantSelector) {
      callback();
      return;
    }

    var variantEl = findElement(variantSelector);
    if (!variantEl) {
      // Variant element not found — proceed without clicking
      callback();
      return;
    }

    // Click the variant element
    variantEl.click();

    // Wait for DOM to settle after the click
    setTimeout(callback, VARIANT_SETTLE_DELAY);
  }

  function tryExtract(attempt) {
    var element;
    try {
      element = document.querySelector(cssSelector);
    } catch (e) {
      chrome.runtime.sendMessage({
        action: 'extractionFailed',
        trackerId: trackerId,
        error: 'Invalid CSS selector: ' + cssSelector
      });
      return;
    }

    if (!element) {
      if (attempt < MAX_RETRIES) {
        setTimeout(function () { tryExtract(attempt + 1); }, RETRY_DELAY);
        return;
      }

      // Primary selector failed — try fallback selectors
      var fallbacks = generateFallbackSelectors(cssSelector);
      for (var i = 0; i < fallbacks.length; i++) {
        element = findElement(fallbacks[i]);
        if (element) break;
      }

      if (!element) {
        chrome.runtime.sendMessage({
          action: 'extractionFailed',
          trackerId: trackerId,
          error: 'Element not found for selector: ' + cssSelector
        });
        return;
      }
    }

    var text = getTextContent(element, excludedSelectors);

    if (trackingType === 'content') {
      chrome.runtime.sendMessage({
        action: 'contentExtracted',
        trackerId: trackerId,
        content: text
      });
      return;
    }

    // Price tracking
    var price = parsePrice(text);

    if (price === null) {
      chrome.runtime.sendMessage({
        action: 'extractionFailed',
        trackerId: trackerId,
        error: 'Could not parse price from text: ' + text
      });
      return;
    }

    chrome.runtime.sendMessage({
      action: 'priceExtracted',
      trackerId: trackerId,
      price: price
    });
  }

  clickVariantAndWait(function () {
    tryExtract(0);
  });
})();

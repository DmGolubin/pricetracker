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

  function getTextContent(el, excluded) {
    if (!excluded || !excluded.length) {
      return (el.textContent || '').trim();
    }
    var clone = el.cloneNode(true);
    excluded.forEach(function (sel) {
      var nodes = clone.querySelectorAll(sel);
      nodes.forEach(function (node) { node.remove(); });
    });
    return (clone.textContent || '').trim();
  }

  // ─── Extraction with retry for dynamic pages ───────────────────────

  var MAX_RETRIES = 5;
  var RETRY_DELAY = 1000; // ms

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
      chrome.runtime.sendMessage({
        action: 'extractionFailed',
        trackerId: trackerId,
        error: 'Element not found for selector: ' + cssSelector
      });
      return;
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

  tryExtract(0);
})();

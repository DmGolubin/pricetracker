/**
 * Auto Detector — Content Script
 *
 * Self-contained IIFE injected into web pages to automatically detect
 * the main product price using heuristics:
 *   1. Meta tags: og:price:amount, product:price:amount
 *   2. JSON-LD structured data (@type: Product with offers.price)
 *   2.5. Site-specific elements (Notino content attr, data-testid price elements)
 *   3. DOM elements containing currency symbols, scored by font size and position
 *
 * Sends result via chrome.runtime.sendMessage:
 *   Success: { action: "autoDetected", selector, price, title, imageUrl, pageUrl }
 *   Failure: { action: "autoDetectFailed" }
 *
 * Requirements: 13.1, 13.2
 */
(function () {
  'use strict';

  // ─── Currency symbols for detection ────────────────────────────────

  var CURRENCY_SYMBOLS = ['€', '$', '₽', '₴', 'zł', 'kn', '£', '¥', '₩', '₹', '₺', '₫', '฿', 'R$', 'kr'];
  var CURRENCY_RE = /R\$|kr|zł|kn|[€$₽₴£¥₩₹₺₫฿]/gi;

  // ─── Inlined: Price Parser ─────────────────────────────────────────

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

  // ─── Inlined: CSS Selector Generator ───────────────────────────────

  function cssEscape(str) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(str);
    }
    return str.replace(/([^\w-])/g, '\\$1');
  }

  function isUnique(selector, target) {
    try {
      return document.querySelector(selector) === target;
    } catch (e) {
      return false;
    }
  }

  function generateSelector(element) {
    if (!element || !(element instanceof Element)) return null;
    if (element === document.documentElement || element === document.body) return null;

    // Strategy 1: element has an id
    if (element.id) {
      var idSel = '#' + cssEscape(element.id);
      if (isUnique(idSel, element)) return idSel;
    }

    // Strategy 2: unique data-* attribute
    var attrs = element.attributes;
    for (var i = 0; i < attrs.length; i++) {
      if (attrs[i].name.startsWith('data-')) {
        var dataSel = '[' + cssEscape(attrs[i].name) + '="' + cssEscape(attrs[i].value) + '"]';
        if (isUnique(dataSel, element)) return dataSel;
      }
    }

    // Strategy 3: build path climbing up the DOM tree
    var parts = [];
    var current = element;
    while (current && current !== document.documentElement && current !== document.body) {
      var tag = current.tagName.toLowerCase();
      var parent = current.parentElement;
      var part;
      if (current.id) {
        part = '#' + cssEscape(current.id);
      } else if (parent) {
        var idx = Array.from(parent.children).indexOf(current) + 1;
        part = tag + ':nth-child(' + idx + ')';
      } else {
        part = tag;
      }
      parts.unshift(part);
      var candidate = parts.join(' > ');
      if (isUnique(candidate, element)) return candidate;
      current = parent;
    }

    if (parts.length > 0) {
      var final = parts.join(' > ');
      if (isUnique(final, element)) return final;
    }

    return null;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  function getProductImage() {
    var ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && ogImg.content) return ogImg.content;
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].naturalWidth >= 150 || imgs[i].width >= 150) return imgs[i].src;
    }
    return '';
  }

  function containsCurrency(text) {
    for (var i = 0; i < CURRENCY_SYMBOLS.length; i++) {
      if (text.indexOf(CURRENCY_SYMBOLS[i]) !== -1) return true;
    }
    return false;
  }

  function isVisible(el) {
    if (!el.offsetParent && el.style.position !== 'fixed') return false;
    var style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
  }

  function getFontSize(el) {
    try {
      return parseFloat(window.getComputedStyle(el).fontSize) || 0;
    } catch (e) {
      return 0;
    }
  }

  function getVerticalPosition(el) {
    try {
      var rect = el.getBoundingClientRect();
      return rect.top;
    } catch (e) {
      return Infinity;
    }
  }

  // ─── Detection strategies ──────────────────────────────────────────

  /**
   * Strategy 1: Check meta tags for price information.
   * Returns { price, confidence } or null.
   */
  function checkMetaTags() {
    var metaSelectors = [
      'meta[property="og:price:amount"]',
      'meta[property="product:price:amount"]'
    ];

    for (var i = 0; i < metaSelectors.length; i++) {
      var meta = document.querySelector(metaSelectors[i]);
      if (meta && meta.content) {
        var price = parsePrice(meta.content);
        if (price !== null && price > 0) {
          return { price: price, confidence: 0.9 };
        }
      }
    }
    return null;
  }

  /**
   * Strategy 2: Check JSON-LD structured data for Product with offers.price.
   * Returns { price, confidence } or null.
   */
  function checkJsonLd() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var data = JSON.parse(scripts[i].textContent);
        var price = extractPriceFromJsonLd(data);
        if (price !== null && price > 0) {
          return { price: price, confidence: 0.95 };
        }
      } catch (e) {
        // Invalid JSON — skip
      }
    }
    return null;
  }

  /**
   * Strategy 2.5: Check site-specific price elements (Notino, etc.)
   * Some React SPAs store prices in content attributes rather than textContent.
   * Returns { element, price, confidence } or null.
   */
  function checkSiteSpecific() {
    // Notino.ua: promo/voucher price takes priority over regular price.
    // The promo price block contains span[data-testid="pd-price-wrapper"] outside #pd-price.
    // CSS-in-JS class (e.g. span.dlmrqim) may change between builds, so we use
    // a more stable approach: find all pd-price-wrapper outside #pd-price.

    // First get regular price for comparison
    var regularPrice = null;
    var regularEl = null;
    try {
      var regSpan = document.querySelector('#pd-price span[data-testid="pd-price"]') ||
                    document.querySelector('span[data-testid="pd-price"]');
      if (regSpan) {
        var rc = (regSpan.getAttribute('content') || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
        if (rc) {
          regularPrice = parsePrice(rc);
          regularEl = regSpan;
        }
        if (regularPrice === null) {
          var rt = (regSpan.textContent || '').trim();
          if (rt) {
            regularPrice = parsePrice(rt);
            regularEl = regSpan;
          }
        }
      }
    } catch (_) {}

    // Search for promo price wrappers outside #pd-price
    try {
      var allWrappers = document.querySelectorAll('span[data-testid="pd-price-wrapper"]');
      var pdPriceEl = document.querySelector('#pd-price');
      var bestPromoPrice = null;
      var bestPromoEl = null;
      for (var pw = 0; pw < allWrappers.length; pw++) {
        var wrapper = allWrappers[pw];
        if (pdPriceEl && pdPriceEl.contains(wrapper)) continue;
        var priceSpan = wrapper.querySelector('span[content]');
        if (!priceSpan) continue;
        var pc = (priceSpan.getAttribute('content') || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
        if (!pc || /^[A-Z]{3}$/.test(pc)) continue;
        var pp = parsePrice(pc);
        if (pp !== null && pp > 0 && (bestPromoPrice === null || pp < bestPromoPrice)) {
          bestPromoPrice = pp;
          bestPromoEl = priceSpan;
        }
      }
      // Also try legacy CSS-in-JS selector
      if (bestPromoPrice === null) {
        var legacyPromo = document.querySelector('span.dlmrqim span[data-testid="pd-price-wrapper"]');
        if (legacyPromo) {
          var lps = legacyPromo.querySelector('span[content]');
          if (lps) {
            var lpc = (lps.getAttribute('content') || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
            if (lpc && !/^[A-Z]{3}$/.test(lpc)) {
              var lpp = parsePrice(lpc);
              if (lpp !== null && lpp > 0) { bestPromoPrice = lpp; bestPromoEl = lps; }
            }
          }
        }
      }
      // Use promo if lower than regular
      if (bestPromoPrice !== null && bestPromoEl && (regularPrice === null || bestPromoPrice < regularPrice)) {
        return { element: bestPromoEl, price: bestPromoPrice, confidence: 0.97 };
      }
    } catch (_) {}

    // Notino.ua: regular price
    if (regularPrice !== null && regularEl) {
      return { element: regularEl, price: regularPrice, confidence: 0.95 };
    }

    // Notino.ua: fallback regular price selectors
    var notinoSelectors = [
      'span[data-testid="pd-price"]',
      '#pd-price span[data-testid="pd-price"]'
    ];
    for (var i = 0; i < notinoSelectors.length; i++) {
      try {
        var el = document.querySelector(notinoSelectors[i]);
        if (el) {
          // Try content attribute first (most reliable on Notino)
          var content = el.getAttribute('content');
          if (content) {
            var cleaned = content.replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
            var price = parsePrice(cleaned);
            if (price !== null && price > 0) {
              return { element: el, price: price, confidence: 0.95 };
            }
          }
          // Fallback to textContent
          var text = (el.textContent || '').trim();
          if (text) {
            var price2 = parsePrice(text);
            if (price2 !== null && price2 > 0) {
              return { element: el, price: price2, confidence: 0.9 };
            }
          }
        }
      } catch (_) {}
    }

    // Makeup.com.ua: React SPA with CSS Modules (2025+)
    // Price is in span[class*="Price__priceCurrent"] e.g. "6300 ₴"
    // Variants have meta[itemprop="price"] inside offer containers
    if (location.hostname.indexOf('makeup.com.ua') !== -1 || location.hostname.indexOf('makeup.') !== -1) {
      // Try the main displayed price
      var makeupPriceEl = document.querySelector('span[class*="Price__priceCurrent"]');
      if (makeupPriceEl) {
        var makeupText = (makeupPriceEl.textContent || '').trim();
        var makeupPrice = parsePrice(makeupText);
        if (makeupPrice !== null && makeupPrice > 0) {
          return { element: makeupPriceEl, price: makeupPrice, confidence: 0.95 };
        }
      }
      // Fallback: meta itemprop="price" in the main offer block
      var makeupMeta = document.querySelector('div[class*="ProductBuySection__container"] > meta[itemprop="price"]');
      if (!makeupMeta) makeupMeta = document.querySelector('div[class*="ProductBuySection"] meta[itemprop="price"]');
      if (makeupMeta) {
        var makeupMetaPrice = parsePrice(makeupMeta.getAttribute('content'));
        if (makeupMetaPrice !== null && makeupMetaPrice > 0) {
          // Return the visible price element for selector generation
          var visibleEl = document.querySelector('span[class*="Price__priceCurrent"]');
          return { element: visibleEl || makeupMeta, price: makeupMetaPrice, confidence: 0.93 };
        }
      }
    }

    // Generic: elements with content attribute containing a price
    var contentAttrSelectors = [
      '[data-testid*="price"][content]',
      '[itemprop="price"][content]'
    ];
    for (var j = 0; j < contentAttrSelectors.length; j++) {
      try {
        var els = document.querySelectorAll(contentAttrSelectors[j]);
        for (var k = 0; k < els.length; k++) {
          var elem = els[k];
          var contentVal = (elem.getAttribute('content') || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
          if (contentVal) {
            var p = parsePrice(contentVal);
            if (p !== null && p > 0) {
              return { element: elem, price: p, confidence: 0.9 };
            }
          }
        }
      } catch (_) {}
    }

    return null;
  }


  function extractPriceFromJsonLd(data) {
    if (!data) return null;

    // Handle @graph arrays
    if (data['@graph'] && Array.isArray(data['@graph'])) {
      for (var i = 0; i < data['@graph'].length; i++) {
        var price = extractPriceFromJsonLd(data['@graph'][i]);
        if (price !== null) return price;
      }
      return null;
    }

    // Handle arrays at top level
    if (Array.isArray(data)) {
      for (var j = 0; j < data.length; j++) {
        var p = extractPriceFromJsonLd(data[j]);
        if (p !== null) return p;
      }
      return null;
    }

    // Check if this is a Product type
    var type = data['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.indexOf('Product') !== -1)) {
      var offers = data.offers;
      if (offers) {
        // offers can be a single object or an array
        if (Array.isArray(offers)) {
          for (var k = 0; k < offers.length; k++) {
            var offerPrice = getOfferPrice(offers[k]);
            if (offerPrice !== null) return offerPrice;
          }
        } else {
          return getOfferPrice(offers);
        }
      }
    }

    return null;
  }

  function getOfferPrice(offer) {
    if (!offer) return null;
    var price = offer.price;
    if (price !== undefined && price !== null) {
      var num = typeof price === 'number' ? price : parsePrice(String(price));
      if (num !== null && num > 0) return num;
    }
    // Check lowPrice for AggregateOffer
    if (offer.lowPrice !== undefined && offer.lowPrice !== null) {
      var low = typeof offer.lowPrice === 'number' ? offer.lowPrice : parsePrice(String(offer.lowPrice));
      if (low !== null && low > 0) return low;
    }
    return null;
  }

  /**
   * Strategy 3: Search DOM elements containing currency symbols.
   * Score candidates by font size, position, and currency presence.
   * Returns array of { element, price, score }.
   */
  function searchDomElements() {
    var candidates = [];
    // Get all text-containing elements (leaf nodes or small containers)
    var allElements = document.body.querySelectorAll('*');

    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var tag = el.tagName.toLowerCase();

      // Skip non-visible, script, style, meta elements
      if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'noscript') continue;

      var text = (el.textContent || '').trim();
      if (!text || text.length > 50) continue; // Skip very long text (unlikely to be just a price)

      if (!containsCurrency(text)) continue;

      // Check visibility
      if (!isVisible(el)) continue;

      var price = parsePrice(text);
      if (price === null || price <= 0) continue;

      // Score the candidate
      var fontSize = getFontSize(el);
      var vertPos = getVerticalPosition(el);
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;

      // Font size score: larger text = higher score (normalize to 0-0.4)
      var fontScore = Math.min(fontSize / 40, 1) * 0.4;

      // Position score: higher on page = higher score (normalize to 0-0.3)
      var posScore = Math.max(0, 1 - (vertPos / viewportHeight)) * 0.3;

      // Currency symbol presence bonus
      var currencyScore = 0.3;

      var totalScore = fontScore + posScore + currencyScore;

      candidates.push({
        element: el,
        price: price,
        score: totalScore
      });
    }

    // Sort by score descending
    candidates.sort(function (a, b) { return b.score - a.score; });

    return candidates;
  }

  // ─── Main detection function ───────────────────────────────────────

  function autoDetectPrice() {
    // Strategy 1: Meta tags
    var metaResult = checkMetaTags();

    // Strategy 2: JSON-LD
    var jsonLdResult = checkJsonLd();

    // Strategy 2.5: Site-specific (Notino content attr, etc.)
    // Check before DOM search — these are high-confidence matches
    var siteResult = checkSiteSpecific();
    if (siteResult) {
      var siteSel = generateSelector(siteResult.element);
      if (siteSel) {
        return {
          found: true,
          selector: siteSel,
          price: siteResult.price,
          confidence: siteResult.confidence
        };
      }
    }

    // Strategy 3: DOM search
    var domCandidates = searchDomElements();

    // If we have structured data (meta or JSON-LD), try to find matching DOM element
    var structuredPrice = null;
    var structuredConfidence = 0;

    if (jsonLdResult) {
      structuredPrice = jsonLdResult.price;
      structuredConfidence = jsonLdResult.confidence;
    } else if (metaResult) {
      structuredPrice = metaResult.price;
      structuredConfidence = metaResult.confidence;
    }

    // If we have structured data price, find a DOM element that matches it
    if (structuredPrice !== null && domCandidates.length > 0) {
      for (var i = 0; i < domCandidates.length; i++) {
        if (domCandidates[i].price === structuredPrice) {
          var selector = generateSelector(domCandidates[i].element);
          if (selector) {
            return {
              found: true,
              selector: selector,
              price: structuredPrice,
              confidence: structuredConfidence
            };
          }
        }
      }
      // Structured data price found but no matching DOM element — still use best DOM candidate
    }

    // If structured data found but no DOM match, use best DOM candidate with boosted confidence
    if (structuredPrice !== null && domCandidates.length > 0) {
      var best = domCandidates[0];
      var selector = generateSelector(best.element);
      if (selector) {
        return {
          found: true,
          selector: selector,
          price: best.price,
          confidence: Math.max(best.score, structuredConfidence * 0.8)
        };
      }
    }

    // No structured data — use best DOM candidate
    if (domCandidates.length > 0) {
      var topCandidate = domCandidates[0];
      var topSelector = generateSelector(topCandidate.element);
      if (topSelector) {
        return {
          found: true,
          selector: topSelector,
          price: topCandidate.price,
          confidence: topCandidate.score
        };
      }
    }

    // If we have structured data but no DOM element at all, report not found
    // (we need a selector for tracking)
    return { found: false, confidence: 0 };
  }

  // ─── Notino volume extraction ───────────────────────────────────
  /**
   * Extract volume (ml) from Notino product page.
   * Looks at: selected variant label in #pdSelectedVariant,
   * variant tiles (.pd-variant-selected .pd-variant-label),
   * or the product specs area.
   * @returns {string|null} e.g. "50 мл" or null
   */
  function extractNotinoVolume() {
    if (!location.hostname.includes('notino')) return null;

    // 1. Selected variant area: #pdSelectedVariant > .fwfy74o > .luz844u span
    //    This contains e.g. "50 мл" right above the price
    try {
      var selectedArea = document.querySelector('#pdSelectedVariant [aria-live]');
      if (selectedArea) {
        var spans = selectedArea.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var txt = (spans[i].textContent || '').replace(/\u00A0/g, ' ').trim();
          if (/^\d+\s*мл$/i.test(txt)) return txt;
        }
      }
    } catch (_) {}

    // 2. Selected variant tile label
    try {
      var selectedTile = document.querySelector('.pd-variant-selected .pd-variant-label');
      if (selectedTile) {
        var label = (selectedTile.textContent || '').replace(/\u00A0/g, ' ').trim();
        if (/^\d+\s*мл$/i.test(label)) return label;
      }
    } catch (_) {}

    // 3. Product specs: look for standalone volume, but SKIP "price / N мл" patterns
    //    (those are price-per-unit, not product volume)
    try {
      var specs = document.querySelector('[data-testid="product-specifications"]');
      if (specs) {
        var specText = (specs.textContent || '').replace(/\u00A0/g, ' ');
        // Skip "X грн / N мл" (price per unit) — match only standalone volume
        var specVolumes = specText.match(/(\d+)\s*мл/gi);
        if (specVolumes) {
          for (var sv = 0; sv < specVolumes.length; sv++) {
            var volCandidate = specVolumes[sv].trim();
            var volNum = parseInt(volCandidate, 10);
            // Check if this volume is preceded by "/" (price-per-unit indicator)
            var volIdx = specText.indexOf(volCandidate);
            var before = specText.substring(Math.max(0, volIdx - 5), volIdx).trim();
            if (before.endsWith('/')) continue; // Skip price-per-unit
            if (volNum > 0 && volNum <= 1000) return volCandidate;
          }
        }
      }
    } catch (_) {}

    // 4. URL pattern: sometimes volume is in the URL slug
    try {
      var urlMatch = location.pathname.match(/(\d+)-ml\b/i);
      if (urlMatch) return urlMatch[1] + ' мл';
    } catch (_) {}

    return null;
  }

  /**
   * Append volume to title if not already present.
   * @param {string} title
   * @returns {string}
   */
  function appendVolumeToTitle(title) {
    var volume = extractNotinoVolume();
    if (!volume) return title;
    // Check if title already contains volume info
    if (/\d+\s*мл/i.test(title)) return title;
    if (/\d+\s*ml\b/i.test(title)) return title;
    return title + ' — ' + volume;
  }

  // ─── Execute and store result ─────────────────────────────────────
  // Store result on DOM element (accessible across all execution contexts).
  // Popup reads this via chrome.scripting.executeScript.

  var result = autoDetectPrice();
  var output;

  if (result.found) {
    output = JSON.stringify({
      found: true,
      selector: result.selector,
      price: result.price,
      title: appendVolumeToTitle(document.title || ''),
      imageUrl: getProductImage(),
      pageUrl: location.href
    });
  } else {
    output = JSON.stringify({ found: false });
  }

  document.documentElement.setAttribute('data-pt-auto-detect', output);

})();

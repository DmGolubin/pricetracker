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
    // og:image meta tag (most reliable for most sites)
    var ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && ogImg.content) return ogImg.content;

    // Makeup.com.ua: link[itemprop="image"] has the product image URL
    var itemImg = document.querySelector('link[itemprop="image"]');
    if (itemImg && itemImg.href) return itemImg.href;

    // Makeup.com.ua: main product picture in the carousel
    var makeupMainImg = document.querySelector('div[class*="ProductMainPicture"] img');
    if (makeupMainImg && makeupMainImg.src && makeupMainImg.src.indexOf('data:') !== 0) return makeupMainImg.src;

    // Generic: itemprop="image" on any element
    var schemaImg = document.querySelector('[itemprop="image"]');
    if (schemaImg) {
      var src = schemaImg.getAttribute('content') || schemaImg.getAttribute('src') || schemaImg.getAttribute('href');
      if (src) return src;
    }

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
      // ─── EVA.UA ─────────────────────────────────────────────────────
      // EVA is a Vue/Nuxt SPA. The displayed price for the SELECTED variant
      // is in span[data-testid="product-price"]. JSON-LD and meta tags contain
      // the DEFAULT variant price (usually 30ml), NOT the selected one.
      // Always prioritize the displayed price element.
      if (location.hostname.includes('eva.ua')) {
        var evaPriceEl = document.querySelector('[data-testid="product-price"]');
        if (evaPriceEl) {
          var evaText = (evaPriceEl.textContent || '').replace(/\u00A0/g, ' ').trim();
          if (evaText) {
            var evaPrice = parsePrice(evaText);
            if (evaPrice !== null && evaPrice > 0) {
              return { element: evaPriceEl, price: evaPrice, confidence: 0.97 };
            }
          }
        }
      }

      // ─── Notino.ua ───────────────────────────────────────────────────
      // Notino has two price blocks:
      //   1. originalPriceDiscountWrapper → pd-price-wrapper with content="9 090" — OLD/original price
      //   2. #pd-price → span[data-testid="pd-price"] with content="6 300" — CURRENT discounted price
      // The CURRENT price is ALWAYS inside #pd-price. The wrapper outside #pd-price is the OLD price.
      // For variant pages: each variant tile has span[data-testid="price-variant"] with content attr.
      // For gift sets (no variants): same #pd-price structure applies.

      if (location.hostname.includes('notino')) {
        // Priority 1: Current price from #pd-price (the actual selling price)
        var currentPriceEl = document.querySelector('#pd-price span[data-testid="pd-price"]');
        if (!currentPriceEl) currentPriceEl = document.querySelector('span[data-testid="pd-price"]');
        if (currentPriceEl) {
          var content = (currentPriceEl.getAttribute('content') || '').replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
          if (content) {
            var price = parsePrice(content);
            if (price !== null && price > 0) {
              return { element: currentPriceEl, price: price, confidence: 0.97 };
            }
          }
          // Fallback to textContent
          var text = (currentPriceEl.textContent || '').trim();
          if (text) {
            var price2 = parsePrice(text);
            if (price2 !== null && price2 > 0) {
              return { element: currentPriceEl, price: price2, confidence: 0.95 };
            }
          }
        }

        // Priority 2: Selected variant price (multi-variant pages)
        var selectedVariant = document.querySelector('a.pd-variant-selected span[data-testid="price-variant"]');
        if (selectedVariant) {
          var vc = (selectedVariant.getAttribute('content') || '').replace(/\u00A0/g, ' ').trim();
          if (vc) {
            var vp = parsePrice(vc);
            if (vp !== null && vp > 0) {
              return { element: selectedVariant, price: vp, confidence: 0.95 };
            }
          }
        }

        // Priority 3: First variant tile price
        var anyVariant = document.querySelector('span[data-testid="price-variant"]');
        if (anyVariant) {
          var avc = (anyVariant.getAttribute('content') || '').replace(/\u00A0/g, ' ').trim();
          if (avc) {
            var avp = parsePrice(avc);
            if (avp !== null && avp > 0) {
              return { element: anyVariant, price: avp, confidence: 0.9 };
            }
          }
        }

        // Priority 4: #pdSelectedVariant container (gift sets)
        var pdSelected = document.querySelector('#pdSelectedVariant');
        if (pdSelected) {
          var innerSpan = pdSelected.querySelector('span[data-testid="pd-price"]') ||
                          pdSelected.querySelector('span[content]');
          if (innerSpan) {
            var ic = (innerSpan.getAttribute('content') || '').replace(/\u00A0/g, ' ').trim();
            if (ic && !/^[A-Z]{3}$/.test(ic)) {
              var ip = parsePrice(ic);
              if (ip !== null && ip > 0) {
                return { element: innerSpan, price: ip, confidence: 0.9 };
              }
            }
          }
        }
      }

      // ─── Makeup.com.ua: React SPA with CSS Modules (2025+) ──────────
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

    // 1. Selected variant area: #pdSelectedVariant [aria-live] contains "80 мл" span
    try {
      var selectedArea = document.querySelector('#pdSelectedVariant [aria-live]');
      if (selectedArea) {
        var spans = selectedArea.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var txt = (spans[i].textContent || '').replace(/\u00A0/g, ' ').trim();
          if (/^\d+\s*мл$/i.test(txt)) return txt;
        }
        // Also check direct child divs (volume may be in a div, not span)
        var divs = selectedArea.querySelectorAll('div');
        for (var d = 0; d < divs.length; d++) {
          var dtxt = (divs[d].textContent || '').replace(/\u00A0/g, ' ').trim();
          if (/^\d+\s*мл$/i.test(dtxt)) return dtxt;
        }
      }
    } catch (_) {}

    // 2. Selected variant tile: .pd-variant-selected contains .pd-variant-label with "80 мл"
    try {
      var selectedTile = document.querySelector('.pd-variant-selected .pd-variant-label');
      if (selectedTile) {
        var label = (selectedTile.textContent || '').replace(/\u00A0/g, ' ').trim();
        if (/^\d+\s*мл$/i.test(label)) return label;
      }
    } catch (_) {}

    // 3. Selected variant tile by data-testid: a.pd-variant-selected has pd-variant-label inside
    try {
      var selectedByClass = document.querySelector('a.pd-variant-selected');
      if (selectedByClass) {
        var labelEl = selectedByClass.querySelector('[class*="pd-variant-label"], [class*="n19p5b2u"]');
        if (labelEl) {
          var lbl = (labelEl.textContent || '').replace(/\u00A0/g, ' ').trim();
          if (/^\d+\s*мл$/i.test(lbl)) return lbl;
        }
      }
    } catch (_) {}

    // 4. Variant tiles: find the one with border-2 (selected) and read its label
    try {
      var allVariants = document.querySelectorAll('[data-testid^="pd-variant-"]');
      for (var v = 0; v < allVariants.length; v++) {
        var variant = allVariants[v];
        var isSelected = (variant.className || '').indexOf('pd-variant-selected') !== -1;
        if (!isSelected) continue;
        var volText = (variant.textContent || '').replace(/\u00A0/g, ' ');
        var volMatch = volText.match(/(\d+)\s*мл/i);
        if (volMatch) return volMatch[0].trim();
      }
    } catch (_) {}

    // 5. Product specs: look for standalone volume, skip "price / N мл" patterns
    try {
      var specs = document.querySelector('[data-testid="product-specifications"]');
      if (specs) {
        var specText = (specs.textContent || '').replace(/\u00A0/g, ' ');
        var specVolumes = specText.match(/(\d+)\s*мл/gi);
        if (specVolumes) {
          for (var sv = 0; sv < specVolumes.length; sv++) {
            var volCandidate = specVolumes[sv].trim();
            var volNum = parseInt(volCandidate, 10);
            var volIdx = specText.indexOf(volCandidate);
            var before = specText.substring(Math.max(0, volIdx - 5), volIdx).trim();
            if (before.endsWith('/')) continue;
            if (volNum > 0 && volNum <= 1000) return volCandidate;
          }
        }
      }
    } catch (_) {}

    // 6. Meta description often contains volume: "... 80 мл ..."
    try {
      var metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        var descContent = (metaDesc.getAttribute('content') || '');
        var descMatch = descContent.match(/(\d+)\s*мл/i);
        if (descMatch) return descMatch[0].trim();
      }
    } catch (_) {}

    // 7. URL pattern: sometimes volume is in the URL slug
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

  // ─── Makeup.com.ua variant detection ──────────────────────────────
  /**
   * Detect the currently selected variant on makeup.com.ua.
   * Returns { variantId, volume, region } or null.
   */
  function detectMakeupVariant() {
    if (location.hostname.indexOf('makeup.com.ua') === -1 && location.hostname.indexOf('makeup.') === -1) return null;

    // The selected variant in the dropdown has aria-selected="true"
    var selectedOption = document.querySelector('li[role="option"][aria-selected="true"]');
    if (!selectedOption) {
      // Try the selected variant tile (has class *="selected" or *="Selected")
      var allVariants = document.querySelectorAll('div[class*="ProductBuySection__variant"]');
      for (var i = 0; i < allVariants.length; i++) {
        var cls = allVariants[i].className || '';
        if (cls.indexOf('selected') !== -1 || cls.indexOf('Selected') !== -1) {
          selectedOption = allVariants[i];
          break;
        }
      }
    }
    if (!selectedOption) return null;

    var meta = selectedOption.querySelector('meta[itemprop="price"]');
    var price = meta ? meta.getAttribute('content') : null;
    var nameMeta = selectedOption.querySelector('meta[itemprop="name"]');
    var nameText = nameMeta ? (nameMeta.getAttribute('content') || '') : '';
    var id = selectedOption.getAttribute('id') || '';

    // Extract volume from name (e.g. "Carolina Herrera Good Girl ... 80ml")
    var volMatch = nameText.match(/(\d+)\s*ml\b/i);
    var volume = volMatch ? volMatch[1] + 'ml' : null;

    // Detect EU region (has a flag image)
    var hasFlag = !!selectedOption.querySelector('img[class*="Flag"]');

    return {
      variantId: id,
      volume: volume,
      region: hasFlag ? 'eu' : null,
      price: price ? parsePrice(price) : null,
      nameText: nameText
    };
  }

  /**
   * Append makeup.com.ua volume to title if not already present.
   * @param {string} title
   * @returns {string}
   */
  function appendMakeupVolumeToTitle(title) {
    var variant = detectMakeupVariant();
    if (!variant || !variant.volume) return title;
    var vol = variant.volume;
    if (new RegExp(vol, 'i').test(title)) return title;
    var suffix = vol;
    if (variant.region === 'eu') suffix += ' (ЕС)';
    return title + ' — ' + suffix;
  }

  // ─── EVA.UA variant detection ──────────────────────────────────────
  /**
   * Detect the currently selected variant on eva.ua.
   * Variant buttons have title="VOLUME (PRODUCT_ID)" pattern.
   * The selected variant has border-apple-200 class (green border).
   * Returns { volume, productId, title } or null.
   */
  function detectEvaVariant() {
    if (location.hostname.indexOf('eva.ua') === -1) return null;

    var buttons = document.querySelectorAll('button[title]');
    var selected = null;
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].getAttribute('title') || '').trim();
      var m = t.match(/^(\d+)\s*\((\d+)\)$/);
      if (!m) continue;
      var cls = buttons[i].className || '';
      // Selected variant has border-apple (green) class
      if (cls.indexOf('border-apple') !== -1) {
        selected = { volume: m[1], productId: m[2], title: t };
        break;
      }
    }
    return selected;
  }

  /**
   * Append EVA.UA volume to title if not already present.
   * @param {string} title
   * @returns {string}
   */
  function appendEvaVolumeToTitle(title) {
    var variant = detectEvaVariant();
    if (!variant || !variant.volume) return title;
    var vol = variant.volume;
    // Check if title already contains this volume
    if (new RegExp('\\b' + vol + '\\s*мл', 'i').test(title)) return title;
    if (new RegExp('\\b' + vol + '\\s*ml\\b', 'i').test(title)) return title;
    return title + ' — ' + vol + ' мл';
  }

  // ─── Execute and store result ─────────────────────────────────────
  // Store result on DOM element (accessible across all execution contexts).
  // Popup reads this via chrome.scripting.executeScript.

  var result = autoDetectPrice();
  var output;

  if (result.found) {
    var title = appendVolumeToTitle(document.title || '');
    title = appendMakeupVolumeToTitle(title);
    title = appendEvaVolumeToTitle(title);

    var resultObj = {
      found: true,
      selector: result.selector,
      price: result.price,
      title: title,
      imageUrl: getProductImage(),
      pageUrl: location.href
    };

    // Makeup.com.ua: include variant info so scraper reads the correct variant price
    var makeupVariant = detectMakeupVariant();
    if (makeupVariant && makeupVariant.variantId) {
      resultObj.variantSelector = '#' + cssEscape(makeupVariant.variantId);
      resultObj.variantId = makeupVariant.variantId;
    }

    // EVA.UA: include variant info so scraper clicks the correct variant button
    // variantSelector is stored as button[title="VOLUME (PRODUCT_ID)"]
    var evaVariant = detectEvaVariant();
    if (evaVariant && evaVariant.title) {
      resultObj.variantSelector = 'button[title="' + evaVariant.title + '"]';
    }

    output = JSON.stringify(resultObj);
  } else {
    output = JSON.stringify({ found: false });
  }

  document.documentElement.setAttribute('data-pt-auto-detect', output);

})();

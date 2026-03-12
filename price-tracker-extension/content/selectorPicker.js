/**
 * Selector Picker — Content Script
 *
 * Self-contained IIFE injected into web pages.
 * Highlights DOM elements on hover, generates CSS selectors on click,
 * parses prices, provides DOM navigation, and sends data to the service worker.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 12.1, 14.1, 14.2, 14.3, 14.4, 15.1
 */
(function () {
  'use strict';

  // Prevent double-injection
  if (window.__ptPickerActive) return;
  window.__ptPickerActive = true;

  // ─── Inlined: CSS Selector Generator ───────────────────────────────

  function cssEscape(str) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(str);
    return str.replace(/([^\w-])/g, '\\$1');
  }

  function isUnique(selector, target) {
    try { return document.querySelector(selector) === target; }
    catch (_) { return false; }
  }

  function getIdSelector(el) {
    return el.id ? '#' + cssEscape(el.id) : null;
  }

  function getDataAttrSelector(el) {
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr.name.startsWith('data-')) {
        const sel = '[' + cssEscape(attr.name) + '="' + cssEscape(attr.value) + '"]';
        if (isUnique(sel, el)) return sel;
      }
    }
    return null;
  }

  function getElementPart(el) {
    if (el.id) return '#' + cssEscape(el.id);
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const idx = Array.from(parent.children).indexOf(el) + 1;
    return tag + ':nth-child(' + idx + ')';
  }

  function buildPathSelector(el, target) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.documentElement && cur !== document.body) {
      parts.unshift(getElementPart(cur));
      const candidate = parts.join(' > ');
      if (isUnique(candidate, target)) return candidate;
      cur = cur.parentElement;
    }
    if (parts.length > 0) {
      const candidate = parts.join(' > ');
      if (isUnique(candidate, target)) return candidate;
    }
    return null;
  }

  function generateSelector(element) {
    if (!element || !(element instanceof Element)) return null;
    if (element === document.documentElement || element === document.body) return null;

    const idSel = getIdSelector(element);
    if (idSel && isUnique(idSel, element)) return idSel;

    const dataSel = getDataAttrSelector(element);
    if (dataSel && isUnique(dataSel, element)) return dataSel;

    return buildPathSelector(element, element);
  }

  // ─── Inlined: Price Parser ─────────────────────────────────────────

  const CURRENCY_RE = /R\$|kr|zł|kn|[€$₽₴£¥₩₹₺₫฿]/gi;

  function parsePrice(text) {
    if (text == null || typeof text !== 'string') return null;
    let c = text.replace(CURRENCY_RE, '').trim();
    c = c.replace(/[\u00A0\u202F]/g, ' ');
    if (!c.length) return null;
    c = c.replace(/(\d) (\d)/g, '$1$2');
    c = c.replace(/(\d) (\d)/g, '$1$2');
    if (!/\d/.test(c)) return null;

    const lastDot = c.lastIndexOf('.');
    const lastComma = c.lastIndexOf(',');
    let result;

    if (lastDot === -1 && lastComma === -1) {
      result = Number(c);
    } else if (lastDot !== -1 && lastComma === -1) {
      const afterDot = c.length - lastDot - 1;
      const dotCount = (c.match(/\./g) || []).length;
      if (dotCount > 1) {
        result = Number(c.replace(/\./g, ''));
      } else if (afterDot === 3 && /^\d{1,3}$/.test(c.slice(0, lastDot))) {
        result = Number(c.replace(/\./g, ''));
      } else {
        result = Number(c.replace(/,/g, ''));
      }
    } else if (lastComma !== -1 && lastDot === -1) {
      const afterComma = c.length - lastComma - 1;
      const commaCount = (c.match(/,/g) || []).length;
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

  function getProductImage() {
    // Try og:image first
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg && ogImg.content) return ogImg.content;

    // Fallback: first large <img> (width >= 150)
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      if (img.naturalWidth >= 150 || img.width >= 150) return img.src;
    }
    return '';
  }

  // Block-level tags that should produce line breaks between content chunks
  var BLOCK_TAGS = /^(DIV|P|LI|TR|DT|DD|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|MAIN|BLOCKQUOTE|FIGURE|FIGCAPTION|DETAILS|SUMMARY|UL|OL|DL|TABLE|THEAD|TBODY|TFOOT|FIELDSET|FORM|PRE|ADDRESS)$/;

  function extractReadableText(node) {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';

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

  function cleanExtractedText(raw) {
    return raw
      .split('\n')
      .map(function (line) { return line.replace(/[\s\u00A0\u202F]+/g, ' ').trim(); })
      .filter(function (line) { return line.length > 0; })
      .join('\n')
      .trim();
  }

  function getTextContent(el, excludedSelectors) {
    var target = el;
    if (excludedSelectors && excludedSelectors.length) {
      target = el.cloneNode(true);
      excludedSelectors.forEach(function (sel) {
        var nodes = target.querySelectorAll(sel);
        nodes.forEach(function (node) { node.remove(); });
      });
    }
    return cleanExtractedText(extractReadableText(target));
  }

  // ─── State ─────────────────────────────────────────────────────────

  let selectedElement = null;
  let excludedSelectors = [];
  let isSelectingChild = false;
  let isExcluding = false;
  let overlay = null;
  let navPanel = null;
  let errorToast = null;
  let formOverlay = null;

  // ─── Overlay ─────────────────────────────────────────────────────

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'pt-picker-overlay';
    document.body.appendChild(overlay);
  }

  function positionOverlay(el) {
    if (!overlay || !el) return;
    const rect = el.getBoundingClientRect();
    overlay.style.top = (rect.top + window.scrollY) + 'px';
    overlay.style.left = (rect.left + window.scrollX) + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  // ─── Error Toast ─────────────────────────────────────────────────

  function showError(msg) {
    removeError();
    errorToast = document.createElement('div');
    errorToast.className = 'pt-picker-error';
    errorToast.textContent = msg;
    document.body.appendChild(errorToast);
    setTimeout(removeError, 3000);
  }

  function removeError() {
    if (errorToast && errorToast.parentNode) {
      errorToast.parentNode.removeChild(errorToast);
    }
    errorToast = null;
  }

  // ─── DOM Navigation Panel ───────────────────────────────────────

  function createNavPanel() {
    removeNavPanel();
    navPanel = document.createElement('div');
    navPanel.className = 'pt-picker-nav';

    var btnUp = document.createElement('button');
    btnUp.textContent = '↑ Внешний блок';
    btnUp.addEventListener('click', navigateUp);

    var btnDown = document.createElement('button');
    btnDown.textContent = '↓ Внутренний блок';
    btnDown.addEventListener('click', navigateDown);

    var btnExclude = document.createElement('button');
    btnExclude.textContent = '✕ Удалить внутренний';
    btnExclude.addEventListener('click', startExclude);

    var btnConfirm = document.createElement('button');
    btnConfirm.className = 'pt-nav-confirm';
    btnConfirm.textContent = 'Подтвердить';
    btnConfirm.addEventListener('click', confirmSelection);

    var btnCancel = document.createElement('button');
    btnCancel.className = 'pt-nav-cancel';
    btnCancel.textContent = 'Отмена';
    btnCancel.addEventListener('click', cancelPicker);

    navPanel.appendChild(btnUp);
    navPanel.appendChild(btnDown);
    navPanel.appendChild(btnExclude);
    navPanel.appendChild(btnConfirm);
    navPanel.appendChild(btnCancel);
    document.body.appendChild(navPanel);
  }

  function removeNavPanel() {
    if (navPanel && navPanel.parentNode) {
      navPanel.parentNode.removeChild(navPanel);
    }
    navPanel = null;
  }

  function navigateUp() {
    if (!selectedElement || !selectedElement.parentElement) return;
    var parent = selectedElement.parentElement;
    if (parent === document.body || parent === document.documentElement) return;
    selectedElement = parent;
    excludedSelectors = [];
    positionOverlay(selectedElement);
  }

  function navigateDown() {
    if (!selectedElement) return;
    // Try to auto-select the first child element
    var firstChild = selectedElement.querySelector('*');
    if (firstChild) {
      selectedElement = firstChild;
      excludedSelectors = [];
      positionOverlay(selectedElement);
    } else {
      showError('Нет дочерних элементов');
    }
  }

  function startExclude() {
    if (!selectedElement) return;
    isExcluding = true;
    showError('Кликните на вложенный элемент для исключения');
  }

  // ─── Confirmation Form ──────────────────────────────────────────

  // ─── Variant Detection (Universal) ─────────────────────────────

  /**
   * Scan the page for clickable variant-like elements.
   * Universal approach: find elements with data-* attributes that look like
   * product parameters (price, size, volume, color, etc.), group them by
   * attribute name, and return structured data for the UI.
   *
   * Returns { params: { [attrName]: [{ label, value, selector, attrs }] }, elements: [...] }
   *   - params: grouped by data-attribute name, each entry is an array of variant items
   *   - elements: flat list of all detected variant elements with all their data-* attrs
   */
  function detectVariants() {
    var paramGroups = {}; // groupName -> [{ label, value, selector, allAttrs }]
    var seen = {};

    function isVisible(el) {
      if (!el.offsetParent && el.style.position !== 'fixed') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function getLabel(el) {
      return (el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    }

    // ── Strategy 1: elements with product-relevant data-* attributes ──
    var RELEVANT_ATTRS = [
      'data-price', 'data-variant-id', 'data-product-id', 'data-sku',
      'data-size', 'data-color', 'data-volume', 'data-weight',
      'data-option', 'data-quantity', 'data-variant', 'data-value'
    ];

    var selectorStr = RELEVANT_ATTRS.map(function (a) { return '[' + a + ']'; }).join(',');
    var dataEls;
    try { dataEls = document.querySelectorAll(selectorStr); } catch (_) { dataEls = []; }

    for (var i = 0; i < dataEls.length; i++) {
      var el = dataEls[i];
      if (!isVisible(el)) continue;

      var dataAttrs = {};
      var hasRelevant = false;
      for (var a = 0; a < RELEVANT_ATTRS.length; a++) {
        var attrName = RELEVANT_ATTRS[a];
        var val = el.getAttribute(attrName);
        if (val && val.length <= 100) {
          dataAttrs[attrName] = val;
          hasRelevant = true;
        }
      }
      if (!hasRelevant) continue;

      var sel = generateSelector(el);
      if (!sel || seen[sel]) continue;
      seen[sel] = true;

      var label = getLabel(el);
      for (var attrKey in dataAttrs) {
        if (!paramGroups[attrKey]) paramGroups[attrKey] = [];
        paramGroups[attrKey].push({
          label: label, value: dataAttrs[attrKey],
          selector: sel, allAttrs: dataAttrs
        });
      }
    }

    // ── Strategy 2: sibling groups with short text (universal) ──
    // Find groups of 2+ clickable siblings with short text content.
    // This catches variant buttons on sites like eva.ua, rozetka, etc.
    // that don't use data-* attributes.
    // Strict filtering: only accept groups where ALL texts look like
    // product variants (numbers+units, colors, sizes) — not reviews/names.
    var CLICKABLE_SEL = 'a, button, [role="button"], [role="tab"], [role="option"], label, [tabindex]';
    var VARIANT_LABEL_RE = /об[ъ'є]м|размер|розмір|цвет|колір|color|size|volume|weight|вес|вага|тип|type|варіант|вариант|variant|option|опция|опція/i;

    // Pattern for text that looks like a product variant value
    // No end-of-string anchor — allows trailing badge/icon text
    var VARIANT_VALUE_RE = /\d+\s*(мл|ml|г|g|кг|kg|л|l|шт|pcs|oz|мм|mm|см|cm|м|m|%)/i;
    var SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|\d{2,3})\s*[-\/]?\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|\d{2,3})?$/i;
    var COLOR_RE = /^(#[0-9a-f]{3,8}|rgb|красн|синий|зелен|черн|бел|серый|жёлт|оранж|розов|фиолет|голуб|коричн|бежев|червон|синій|зелен|чорн|біл|сір|жовт|рожев|блакит)/i;

    /**
     * Extract clean text from a variant element, stripping badge/icon
     * children (spans with single special chars like %, ★, etc.)
     */
    function getCleanVariantText(el) {
      // Try title attribute first (eva.ua buttons have title="30 (1017515)")
      var title = el.getAttribute('title');
      if (title) {
        // Strip parenthesized IDs: "30 (1017515)" -> "30"
        var cleaned = title.replace(/\s*\([\d\s]+\)\s*$/, '').trim();
        if (cleaned.length > 0 && cleaned.length <= 40) return cleaned;
      }
      // Try aria-label
      var ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) {
        var cleanedAria = ariaLabel.replace(/\s*\([\d\s]+\)\s*$/, '').trim();
        if (cleanedAria.length > 0 && cleanedAria.length <= 40) return cleanedAria;
      }
      // Clone and strip badge/icon children before reading textContent
      var clone = el.cloneNode(true);
      var badges = clone.querySelectorAll('span, i, svg, img');
      for (var bi = 0; bi < badges.length; bi++) {
        var badgeText = (badges[bi].textContent || '').trim();
        // Remove spans with very short non-alphanumeric content (badges like %, ★, ●)
        if (badgeText.length <= 2 && !/[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9]/.test(badgeText)) {
          badges[bi].remove();
        }
        // Remove SVG/img icons
        if (badges[bi].tagName === 'SVG' || badges[bi].tagName === 'IMG') {
          badges[bi].remove();
        }
      }
      return (clone.textContent || '').trim().replace(/\s+/g, ' ');
    }

    function looksLikeVariantValue(text) {
      if (VARIANT_VALUE_RE.test(text)) return true;
      if (SIZE_RE.test(text)) return true;
      if (COLOR_RE.test(text)) return true;
      // Short numeric text (e.g. "100", "250")
      if (/^\d{1,5}$/.test(text)) return true;
      // Number + dash + number (e.g. "30-50")
      if (/^\d+\s*[-–]\s*\d+$/.test(text)) return true;
      return false;
    }

    // Scan containers that might hold variant groups
    var allContainers = document.querySelectorAll('div, ul, nav, fieldset, section');
    var processedParents = {};

    for (var ci = 0; ci < allContainers.length; ci++) {
      var container = allContainers[ci];
      if (!isVisible(container)) continue;

      // Get direct clickable children
      var children = container.querySelectorAll(':scope > ' + CLICKABLE_SEL);
      if (children.length < 2 || children.length > 20) continue;

      // All children must have short text (variant-like)
      var allShort = true;
      var texts = [];
      for (var ch = 0; ch < children.length; ch++) {
        var txt = getCleanVariantText(children[ch]);
        if (txt.length === 0 || txt.length > 30) { allShort = false; break; }
        texts.push(txt);
      }
      if (!allShort) continue;

      // Avoid duplicates: skip if parent already processed
      var parentKey = generateSelector(container);
      if (!parentKey || processedParents[parentKey]) continue;
      processedParents[parentKey] = true;

      // Determine if this group looks like product variants.
      // Two conditions must be met:
      //   A) A variant-related label is found nearby (preceding sibling or parent), OR
      //   B) The texts themselves look like variant values (numbers+units, sizes, colors)
      // Without either condition, skip the group entirely.

      var groupName = '';

      // Check if texts look like variant values
      var variantLikeCount = 0;
      for (var ti = 0; ti < texts.length; ti++) {
        if (looksLikeVariantValue(texts[ti])) variantLikeCount++;
      }
      var textsLookLikeVariants = variantLikeCount >= texts.length * 0.5;

      // Try to find a label from preceding sibling
      var prev = container.previousElementSibling;
      if (prev) {
        var prevText = (prev.textContent || '').trim().replace(/\s+/g, ' ');
        if (prevText.length > 0 && prevText.length <= 40 && VARIANT_LABEL_RE.test(prevText)) {
          groupName = prevText.replace(/:$/, '');
        }
      }
      // Try parent label
      if (!groupName) {
        var parent = container.parentElement;
        if (parent) {
          var labelEl = parent.querySelector('label, span, p, div');
          if (labelEl && labelEl !== container && !container.contains(labelEl)) {
            var lt = (labelEl.textContent || '').trim().replace(/\s+/g, ' ');
            if (lt.length > 0 && lt.length <= 40 && VARIANT_LABEL_RE.test(lt)) {
              groupName = lt.replace(/:$/, '');
            }
          }
        }
      }
      // If no variant label found, only accept if texts look like variants
      if (!groupName) {
        if (textsLookLikeVariants) {
          var hasUnit = texts.some(function (t) { return /мл|ml|г|g|кг|kg|л|l|шт|oz|мм|mm|см|cm/i.test(t); });
          if (hasUnit) {
            groupName = 'Объём / Размер';
          } else {
            groupName = 'Варианты';
          }
        } else {
          continue; // Skip: no variant label and texts don't look like variants
        }
      }
      // Even with a label, verify texts are plausible variant values
      // (prevents "Отзывы" sections with variant-like labels from leaking through)
      if (groupName && !textsLookLikeVariants) {
        // Label matched but texts don't look like variants — skip
        continue;
      }

      // Add each child as a variant item
      for (var vi = 0; vi < children.length; vi++) {
        var vEl = children[vi];
        var vSel = generateSelector(vEl);
        if (!vSel || seen[vSel]) continue;
        seen[vSel] = true;

        var vLabel = getCleanVariantText(vEl).slice(0, 40);
        if (!paramGroups[groupName]) paramGroups[groupName] = [];
        paramGroups[groupName].push({
          label: vLabel, value: vLabel,
          selector: vSel, allAttrs: {}
        });
      }
    }

    // Keep only groups with 2–30 items
    var filtered = {};
    for (var key in paramGroups) {
      var group = paramGroups[key];
      if (group.length >= 2 && group.length <= 30) {
        filtered[key] = group;
      }
    }

    return filtered;
  }

  /**
   * Pretty-print a data-attribute name for display.
   * "data-variant-id" -> "Variant Id", "data-price" -> "Price"
   */
  function prettyAttrName(attr) {
    // If it doesn't start with "data-", it's already a human-readable name (from Strategy 2)
    if (!attr.startsWith('data-')) return attr;

    var name = attr.replace(/^data-/, '');
    var translations = {
      'price': 'Цена', 'variant-id': 'Вариант', 'product-id': 'Товар',
      'sku': 'Артикул', 'value': 'Значение', 'option': 'Опция',
      'size': 'Размер', 'color': 'Цвет', 'volume': 'Объём',
      'weight': 'Вес', 'quantity': 'Количество', 'id': 'ID',
      'name': 'Название', 'type': 'Тип', 'category': 'Категория'
    };
    if (translations[name]) return translations[name];
    return name.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /**
   * Auto-detect the main price element on the page.
   * Used when saving variant trackers so that cssSelector points to the
   * actual price element rather than the variant button the user clicked.
   *
   * Universal approach: try well-known selectors first, then walk all
   * visible elements looking for currency symbol + number with large font.
   */
  function detectPriceSelector() {
    var CURRENCY_DETECT_RE = /₴|грн|UAH|USD|\$|€|₽|руб|£|¥|₩|zł|kr/i;

    // 1. Well-known price selectors
    var PRICE_SELECTORS = [
      '[data-testid="product-price"]', '[data-testid="price"]',
      '[itemprop="price"]', '[data-price]',
      '.product-price__big', '.product__price', '.price-current',
      '.product-price', '.price__value', '.price-value',
      '.current-price', '.product__price-current'
    ];

    for (var i = 0; i < PRICE_SELECTORS.length; i++) {
      try {
        var el = document.querySelector(PRICE_SELECTORS[i]);
        if (el) {
          var text = (el.textContent || '').trim();
          if (parsePrice(text) !== null) {
            var sel = generateSelector(el);
            if (sel) return sel;
          }
          var content = el.getAttribute('content');
          if (content && parsePrice(content) !== null) {
            var sel2 = generateSelector(el);
            if (sel2) return sel2;
          }
        }
      } catch (_) {}
    }

    // 2. Universal scan: walk all visible elements
    var best = null;
    var bestScore = -1;

    var walker = document.createTreeWalker(
      document.body, NodeFilter.SHOW_ELEMENT, null, false
    );

    var node;
    while ((node = walker.nextNode())) {
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG') continue;
      if (isPickerElement(node)) continue;

      // Get own direct text
      var ownText = '';
      for (var ci = 0; ci < node.childNodes.length; ci++) {
        if (node.childNodes[ci].nodeType === 3) {
          ownText += node.childNodes[ci].textContent;
        }
      }
      var fullText = (node.textContent || '').trim();
      var textToCheck = ownText.trim();
      if (!textToCheck && fullText.length <= 30) textToCheck = fullText;
      if (!textToCheck) continue;

      if (!CURRENCY_DETECT_RE.test(textToCheck) && !CURRENCY_DETECT_RE.test(fullText)) continue;

      var priceText = CURRENCY_DETECT_RE.test(textToCheck) ? textToCheck : fullText;
      if (priceText.length > 60) continue;
      if (parsePrice(priceText) === null) continue;

      var rect;
      try { rect = node.getBoundingClientRect(); } catch (_) { continue; }
      if (rect.width === 0 || rect.height === 0) continue;

      var score = 0;
      var cls = (node.className && typeof node.className === 'string') ? node.className.toLowerCase() : '';
      if (/price|цена|ціна/.test(cls)) score += 15;
      if (node.getAttribute('data-testid') && /price/i.test(node.getAttribute('data-testid'))) score += 20;
      if (node.getAttribute('itemprop') === 'price') score += 20;
      if (rect.top < 600) score += 8;
      else if (rect.top < 1000) score += 4;
      try {
        var fontSize = parseFloat(window.getComputedStyle(node).fontSize);
        if (fontSize >= 24) score += 12;
        else if (fontSize >= 18) score += 8;
        else if (fontSize >= 14) score += 3;
      } catch (_) {}
      score += Math.max(0, 20 - priceText.length);
      try {
        var textDeco = window.getComputedStyle(node).textDecorationLine || window.getComputedStyle(node).textDecoration;
        if (/line-through/.test(textDeco)) score -= 20;
      } catch (_) {}

      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }

    if (best) {
      var bestSel = generateSelector(best);
      if (bestSel) return bestSel;
    }

    return null;
  }

  function showConfirmForm(data) {
    removeFormOverlay();
    removeNavPanel();
    hideOverlay();

    formOverlay = document.createElement('div');
    formOverlay.className = 'pt-picker-form-overlay';

    var form = document.createElement('div');
    form.className = 'pt-picker-form';

    // Header
    var header = document.createElement('div');
    header.className = 'pt-picker-form-header';
    var title = document.createElement('h3');
    title.textContent = 'Новый трекер';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'pt-picker-form-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', cancelPicker);
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement('div');
    body.className = 'pt-picker-form-body';

    // Product name
    var nameField = createField('Название', 'text', data.title, 'pt-field-name');
    // URL (readonly)
    var urlField = createField('URL', 'text', data.pageUrl, 'pt-field-url', true);
    // Price
    var priceField = createField('Цена', 'text', data.price != null ? String(data.price) : '', 'pt-field-price');
    // Image
    var imgField = createField('Изображение', 'text', data.imageUrl, 'pt-field-image');

    // Tracking type
    var typeField = document.createElement('div');
    typeField.className = 'pt-picker-field';
    var typeLabel = document.createElement('label');
    typeLabel.textContent = 'Тип отслеживания';
    var typeToggle = document.createElement('div');
    typeToggle.className = 'pt-picker-type-toggle';

    var btnPrice = document.createElement('button');
    btnPrice.className = 'pt-picker-type-btn active';
    btnPrice.textContent = 'Цена';
    btnPrice.dataset.type = 'price';

    var btnContent = document.createElement('button');
    btnContent.className = 'pt-picker-type-btn';
    btnContent.textContent = 'Контент';
    btnContent.dataset.type = 'content';

    var currentType = data.price != null ? 'price' : 'content';

    function setType(type) {
      currentType = type;
      btnPrice.className = 'pt-picker-type-btn' + (type === 'price' ? ' active' : '');
      btnContent.className = 'pt-picker-type-btn' + (type === 'content' ? ' active' : '');
    }

    setType(currentType);

    btnPrice.addEventListener('click', function () { setType('price'); });
    btnContent.addEventListener('click', function () { setType('content'); });

    typeToggle.appendChild(btnPrice);
    typeToggle.appendChild(btnContent);
    typeField.appendChild(typeLabel);
    typeField.appendChild(typeToggle);

    // ─── Check interval (radio-like toggle) ─────────────────────
    var intervalField = document.createElement('div');
    intervalField.className = 'pt-picker-field';
    var intervalLabel = document.createElement('label');
    intervalLabel.textContent = 'Интервал проверки';
    var intervalToggle = document.createElement('div');
    intervalToggle.className = 'pt-picker-type-toggle pt-picker-interval-toggle';

    var intervals = [
      { value: 3, label: '3ч' },
      { value: 6, label: '6ч' },
      { value: 12, label: '12ч' },
      { value: 24, label: '24ч' },
    ];
    var currentInterval = 3;
    var intervalBtns = [];

    intervals.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.className = 'pt-picker-type-btn' + (opt.value === currentInterval ? ' active' : '');
      btn.textContent = opt.label;
      btn.dataset.interval = opt.value;
      btn.addEventListener('click', function () {
        currentInterval = opt.value;
        intervalBtns.forEach(function (b) {
          b.className = 'pt-picker-type-btn' + (Number(b.dataset.interval) === currentInterval ? ' active' : '');
        });
      });
      intervalBtns.push(btn);
      intervalToggle.appendChild(btn);
    });

    intervalField.appendChild(intervalLabel);
    intervalField.appendChild(intervalToggle);

    // ─── Check mode (auto / pinTab) ─────────────────────────────
    var modeField = document.createElement('div');
    modeField.className = 'pt-picker-field';
    var modeLabel = document.createElement('label');
    modeLabel.textContent = 'Режим проверки';
    var modeToggle = document.createElement('div');
    modeToggle.className = 'pt-picker-type-toggle';

    var btnAuto = document.createElement('button');
    btnAuto.className = 'pt-picker-type-btn active';
    btnAuto.textContent = 'Авто';
    btnAuto.dataset.mode = 'auto';

    var btnPin = document.createElement('button');
    btnPin.className = 'pt-picker-type-btn';
    btnPin.textContent = 'Pin Tab';
    btnPin.dataset.mode = 'pinTab';

    var currentMode = 'auto';

    function setMode(mode) {
      currentMode = mode;
      btnAuto.className = 'pt-picker-type-btn' + (mode === 'auto' ? ' active' : '');
      btnPin.className = 'pt-picker-type-btn' + (mode === 'pinTab' ? ' active' : '');
    }

    btnAuto.addEventListener('click', function () { setMode('auto'); });
    btnPin.addEventListener('click', function () { setMode('pinTab'); });

    modeToggle.appendChild(btnAuto);
    modeToggle.appendChild(btnPin);
    modeField.appendChild(modeLabel);
    modeField.appendChild(modeToggle);

    // ─── Product group (text input) ─────────────────────────────
    var groupField = createField('Группа товаров', 'text', '', 'pt-field-group');

    // ─── Variant selector (universal auto-detect) ─────────────
    var variantFieldWrapper = document.createElement('div');
    variantFieldWrapper.className = 'pt-picker-field';
    var variantLabel = document.createElement('label');
    variantLabel.textContent = 'Варианты товара';
    variantFieldWrapper.appendChild(variantLabel);

    // State: selected variants (multi-select). Each: { selector, label, attrs }
    var selectedVariants = []; // empty = "Текущий" (no variant click)

    // Detect variant parameters on the page
    var variantParams = detectVariants();
    var paramNames = Object.keys(variantParams);

    if (paramNames.length > 0) {
      // ── Parameter filter buttons (data-price, data-volume, etc.) ──
      var paramFilterWrap = document.createElement('div');
      paramFilterWrap.className = 'pt-picker-field';
      var paramFilterLabel = document.createElement('label');
      paramFilterLabel.textContent = 'Найденные параметры';
      paramFilterLabel.style.marginBottom = '6px';
      paramFilterWrap.appendChild(paramFilterLabel);

      var paramToggle = document.createElement('div');
      paramToggle.className = 'pt-picker-type-toggle pt-picker-interval-toggle pt-picker-variant-params';

      var activeParam = null;

      // Container for variant items (shown when a param is selected)
      var variantItemsWrap = document.createElement('div');
      variantItemsWrap.className = 'pt-picker-field';
      variantItemsWrap.style.display = 'none';

      var variantItemsLabel = document.createElement('label');
      variantItemsLabel.style.marginBottom = '6px';
      variantItemsWrap.appendChild(variantItemsLabel);

      var variantItemsToggle = document.createElement('div');
      variantItemsToggle.className = 'pt-picker-type-toggle pt-picker-interval-toggle pt-picker-variant-items';
      variantItemsWrap.appendChild(variantItemsToggle);

      // "Текущий" always-visible option
      var currentBtn = document.createElement('button');
      currentBtn.className = 'pt-picker-type-btn active';
      currentBtn.textContent = 'Текущий (без варианта)';

      function updateCurrentBtn() {
        currentBtn.className = 'pt-picker-type-btn' + (selectedVariants.length === 0 ? ' active' : '');
      }

      currentBtn.addEventListener('click', function () {
        selectedVariants = [];
        updateCurrentBtn();
        // Deselect all variant item buttons
        variantItemsToggle.querySelectorAll('.pt-picker-type-btn').forEach(function (b) {
          b.className = 'pt-picker-type-btn';
        });
      });

      function showParamItems(paramName) {
        activeParam = paramName;
        variantItemsWrap.style.display = '';
        variantItemsLabel.textContent = prettyAttrName(paramName) + ' — выберите варианты:';
        variantItemsToggle.innerHTML = '';

        var items = variantParams[paramName];
        items.forEach(function (item) {
          var btn = document.createElement('button');
          btn.className = 'pt-picker-type-btn';

          // Build readable display text
          var displayText = '';
          // Prefer: short label text, then attribute value
          if (item.label && item.label.length <= 40) {
            displayText = item.label;
          } else if (item.label) {
            displayText = item.label.slice(0, 35) + '…';
          } else {
            displayText = item.value;
          }
          // Append price if this isn't the price param itself
          if (paramName !== 'data-price' && item.allAttrs['data-price']) {
            displayText += ' — ' + item.allAttrs['data-price'];
          }
          btn.textContent = displayText;
          btn.title = displayText;

          // Check if already selected
          var isSelected = selectedVariants.some(function (sv) { return sv.selector === item.selector; });
          if (isSelected) btn.className = 'pt-picker-type-btn active';

          btn.addEventListener('click', function () {
            var idx = -1;
            for (var si = 0; si < selectedVariants.length; si++) {
              if (selectedVariants[si].selector === item.selector) { idx = si; break; }
            }
            if (idx >= 0) {
              // Deselect
              selectedVariants.splice(idx, 1);
              btn.className = 'pt-picker-type-btn';
            } else {
              // Select (multi)
              selectedVariants.push({
                selector: item.selector,
                label: displayText,
                attrs: item.allAttrs
              });
              btn.className = 'pt-picker-type-btn active';
            }
            updateCurrentBtn();
          });

          variantItemsToggle.appendChild(btn);
        });
      }

      paramNames.forEach(function (paramName) {
        var count = variantParams[paramName].length;
        var btn = document.createElement('button');
        btn.className = 'pt-picker-type-btn';
        btn.textContent = prettyAttrName(paramName) + ' (' + count + ')';
        btn.title = paramName;
        btn.addEventListener('click', function () {
          paramToggle.querySelectorAll('.pt-picker-type-btn').forEach(function (b) {
            b.className = 'pt-picker-type-btn';
          });
          btn.className = 'pt-picker-type-btn active';
          showParamItems(paramName);
        });
        paramToggle.appendChild(btn);
      });

      paramFilterWrap.appendChild(paramToggle);
      variantFieldWrapper.appendChild(paramFilterWrap);

      // "Текущий" button row
      var currentRow = document.createElement('div');
      currentRow.style.marginTop = '8px';
      currentRow.style.marginBottom = '8px';
      currentRow.appendChild(currentBtn);
      variantFieldWrapper.appendChild(currentRow);

      variantFieldWrapper.appendChild(variantItemsWrap);

      // Auto-open first param
      if (paramNames.length > 0) {
        var firstBtn = paramToggle.querySelector('.pt-picker-type-btn');
        if (firstBtn) {
          firstBtn.className = 'pt-picker-type-btn active';
          showParamItems(paramNames[0]);
        }
      }
    } else {
      // Fallback: manual text input
      var variantInput = document.createElement('input');
      variantInput.type = 'text';
      variantInput.id = 'pt-field-variant';
      variantInput.value = '';
      variantInput.placeholder = 'CSS-селектор (необязательно)';
      variantFieldWrapper.appendChild(variantInput);
    }

    body.appendChild(nameField);
    body.appendChild(urlField);
    body.appendChild(priceField);
    body.appendChild(imgField);
    body.appendChild(typeField);
    body.appendChild(intervalField);
    body.appendChild(modeField);
    body.appendChild(groupField);
    body.appendChild(variantFieldWrapper);

    // Footer
    var footer = document.createElement('div');
    footer.className = 'pt-picker-form-footer';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'pt-picker-btn-cancel';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', cancelPicker);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'pt-picker-btn-save';
    saveBtn.textContent = 'Сохранить';
    saveBtn.addEventListener('click', function () {
      var nameInput = document.getElementById('pt-field-name');
      var priceInput = document.getElementById('pt-field-price');
      var imgInput = document.getElementById('pt-field-image');
      var groupInput = document.getElementById('pt-field-group');
      var variantManualInput = document.getElementById('pt-field-variant');

      var baseName = nameInput.value;

      // When variants are selected, the user-picked element (data.selector)
      // might be the variant button itself (e.g. "30ml"), not the price element.
      // Auto-detect the price element on the page for variant trackers.
      var priceCssSelector = data.selector;
      if (selectedVariants.length > 0 && currentType === 'price') {
        var detectedPriceSel = detectPriceSelector();
        if (detectedPriceSel) {
          priceCssSelector = detectedPriceSel;
        }
      }

      var basePayload = {
        action: 'elementSelected',
        selector: priceCssSelector,
        price: parsePrice(priceInput.value),
        title: baseName,
        imageUrl: imgInput.value,
        pageUrl: data.pageUrl,
        trackingType: currentType,
        checkIntervalHours: currentInterval,
        checkMode: currentMode,
        productGroup: groupInput ? groupInput.value : '',
        variantSelector: variantManualInput ? variantManualInput.value : '',
        contentValue: currentType === 'content' ? data.contentValue : undefined,
        excludedSelectors: data.excludedSelectors
      };

      if (selectedVariants.length === 0) {
        // No variants selected — single tracker ("Текущий")
        chrome.runtime.sendMessage(basePayload);
        cleanup();
      } else {
        // Multi-variant: create one tracker per selected variant.
        // We do NOT click variant buttons here — the SPA may re-render
        // the entire page, making price reading unreliable.
        // Instead, each tracker is saved with variantSelector, and
        // priceExtractor.js will click the variant + read the price
        // during the first scheduled check.
        selectedVariants.forEach(function (v) {
          var payload = {};
          for (var k in basePayload) payload[k] = basePayload[k];
          payload.title = baseName + ' — ' + v.label;

          // Check if the variant element is a link
          var variantEl = null;
          try { variantEl = document.querySelector(v.selector); } catch (_) {}
          var variantHref = '';
          if (variantEl) {
            var linkEl = variantEl.closest('a') || variantEl.querySelector('a') || (variantEl.tagName === 'A' ? variantEl : null);
            if (linkEl && linkEl.href) {
              variantHref = linkEl.href;
            }
          }

          if (variantHref && variantHref !== payload.pageUrl) {
            // Variant has its own URL — use it directly
            payload.pageUrl = variantHref;
            payload.variantSelector = '';
          } else {
            // Click-based variant — priceExtractor will handle the click
            payload.variantSelector = v.selector;
          }

          // If variant has data-price, use it directly
          if (v.attrs && v.attrs['data-price']) {
            var vPrice = parsePrice(v.attrs['data-price']);
            if (vPrice !== null) {
              payload.price = vPrice;
              payload.trackingType = 'price';
            }
          }

          chrome.runtime.sendMessage(payload);
        });
        cleanup();
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    form.appendChild(header);
    form.appendChild(body);
    form.appendChild(footer);
    formOverlay.appendChild(form);

    // Close on overlay click
    formOverlay.addEventListener('click', function (e) {
      if (e.target === formOverlay) cancelPicker();
    });

    document.body.appendChild(formOverlay);
  }

  function createField(labelText, type, value, id, readonly) {
    var wrapper = document.createElement('div');
    wrapper.className = 'pt-picker-field';
    var label = document.createElement('label');
    label.textContent = labelText;
    label.setAttribute('for', id);
    var input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.value = value || '';
    if (readonly) input.readOnly = true;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  function removeFormOverlay() {
    if (formOverlay && formOverlay.parentNode) {
      formOverlay.parentNode.removeChild(formOverlay);
    }
    formOverlay = null;
  }

  // ─── Selection Logic ────────────────────────────────────────────

  function confirmSelection() {
    if (!selectedElement) return;

    var selector = generateSelector(selectedElement);
    if (!selector) {
      showError('Не удалось сгенерировать CSS-селектор. Выберите другой элемент.');
      return;
    }

    var text = getTextContent(selectedElement, excludedSelectors);
    var price = parsePrice(text);

    showConfirmForm({
      selector: selector,
      price: price,
      title: document.title,
      pageUrl: window.location.href,
      imageUrl: getProductImage(),
      contentValue: text,
      excludedSelectors: excludedSelectors.length ? excludedSelectors : undefined
    });
  }

  // ─── Event Handlers ─────────────────────────────────────────────

  function onMouseMove(e) {
    if (selectedElement && !isSelectingChild && !isExcluding) return;

    var target = e.target;
    // Ignore our own UI elements
    if (isPickerElement(target)) return;

    positionOverlay(target);
  }

  function onMouseClick(e) {
    var target = e.target;
    // Ignore our own UI elements
    if (isPickerElement(target)) return;

    e.preventDefault();
    e.stopPropagation();

    if (isSelectingChild) {
      // Selecting a child element within the current selection
      if (selectedElement && selectedElement.contains(target) && target !== selectedElement) {
        selectedElement = target;
        excludedSelectors = [];
        isSelectingChild = false;
        positionOverlay(selectedElement);
        removeError();
      } else {
        showError('Выберите элемент внутри текущего выделения');
      }
      return;
    }

    if (isExcluding) {
      // Excluding a nested element
      if (selectedElement && selectedElement.contains(target) && target !== selectedElement) {
        var excludeSel = generateSelector(target);
        if (excludeSel && excludedSelectors.indexOf(excludeSel) === -1) {
          excludedSelectors.push(excludeSel);
        }
        isExcluding = false;
        removeError();
        // Re-highlight the selected element
        positionOverlay(selectedElement);
      } else {
        showError('Выберите вложенный элемент внутри текущего выделения');
      }
      return;
    }

    // Initial element selection
    selectedElement = target;
    excludedSelectors = [];
    positionOverlay(selectedElement);
    createNavPanel();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cancelPicker();
    }
  }

  function isPickerElement(el) {
    if (!el) return false;
    if (el === overlay || el === navPanel || el === errorToast || el === formOverlay) return true;
    if (overlay && overlay.contains(el)) return true;
    if (navPanel && navPanel.contains(el)) return true;
    if (errorToast && errorToast.contains(el)) return true;
    if (formOverlay && formOverlay.contains(el)) return true;
    return false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  function cancelPicker() {
    chrome.runtime.sendMessage({ action: 'pickerCancelled' });
    cleanup();
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onMouseClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    removeNavPanel();
    removeError();
    removeFormOverlay();

    overlay = null;
    selectedElement = null;
    excludedSelectors = [];
    isSelectingChild = false;
    isExcluding = false;
    window.__ptPickerActive = false;
  }

  // ─── Init ───────────────────────────────────────────────────────

  function init() {
    createOverlay();
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onMouseClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  init();
})();

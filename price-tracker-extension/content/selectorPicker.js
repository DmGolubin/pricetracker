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

  // ─── Variant Detection ────────────────────────────────────────

  /**
   * Detect product variant elements on the page.
   * Looks for common patterns: elements with data-price, data-variant-id,
   * .variant class, option selectors, etc.
   * Returns array of { label, price, selector }.
   */
  function detectVariants() {
    var results = [];
    var seen = {};

    // Strategy 1: elements with data-variant-id and data-price (makeup.ua pattern)
    var variantEls = document.querySelectorAll('[data-variant-id][data-price]');
    for (var i = 0; i < variantEls.length; i++) {
      var el = variantEls[i];
      var vid = el.getAttribute('data-variant-id');
      var price = el.getAttribute('data-price');
      var label = (el.getAttribute('title') || el.textContent || '').trim().slice(0, 30);
      if (!label) label = 'Вариант ' + (i + 1);
      if (price) label += ' — ' + price;

      var sel = '[data-variant-id="' + vid + '"]';
      if (!seen[sel]) {
        seen[sel] = true;
        results.push({ label: label, price: price, selector: sel });
      }
    }

    // Strategy 2: elements with class "variant" and data-price (generic)
    if (results.length === 0) {
      var genericVariants = document.querySelectorAll('.variant[data-price]');
      for (var j = 0; j < genericVariants.length; j++) {
        var gEl = genericVariants[j];
        var gPrice = gEl.getAttribute('data-price');
        var gLabel = (gEl.getAttribute('title') || gEl.textContent || '').trim().slice(0, 30);
        if (!gLabel) gLabel = 'Вариант ' + (j + 1);
        if (gPrice) gLabel += ' — ' + gPrice;

        var gSel = generateSelector(gEl);
        if (gSel && !seen[gSel]) {
          seen[gSel] = true;
          results.push({ label: gLabel, price: gPrice, selector: gSel });
        }
      }
    }

    // Strategy 3: select/option with price-like values (e.g. size selectors)
    if (results.length === 0) {
      var selects = document.querySelectorAll('select');
      for (var s = 0; s < selects.length; s++) {
        var options = selects[s].querySelectorAll('option');
        if (options.length > 1 && options.length <= 20) {
          var hasPrice = false;
          for (var o = 0; o < options.length; o++) {
            if (options[o].getAttribute('data-price') || /\d/.test(options[o].value)) {
              hasPrice = true;
              break;
            }
          }
          if (hasPrice) {
            // This is likely a variant selector — but we can't "click" an option,
            // so skip for now (would need a different approach)
          }
        }
      }
    }

    return results;
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

    // ─── Variant selector (auto-detect variants on page) ───────
    var variantFieldWrapper = document.createElement('div');
    variantFieldWrapper.className = 'pt-picker-field';
    var variantLabel = document.createElement('label');
    variantLabel.textContent = 'Вариант товара';
    variantFieldWrapper.appendChild(variantLabel);

    var selectedVariantSelector = '';

    // Try to find variant elements on the page
    var variantCandidates = detectVariants();

    if (variantCandidates.length > 0) {
      var variantToggle = document.createElement('div');
      variantToggle.className = 'pt-picker-type-toggle pt-picker-interval-toggle';

      // "None" button (default — no variant click)
      var noneBtn = document.createElement('button');
      noneBtn.className = 'pt-picker-type-btn active';
      noneBtn.textContent = 'Текущий';
      noneBtn.addEventListener('click', function () {
        selectedVariantSelector = '';
        variantToggle.querySelectorAll('.pt-picker-type-btn').forEach(function (b) {
          b.className = 'pt-picker-type-btn';
        });
        noneBtn.className = 'pt-picker-type-btn active';
      });
      variantToggle.appendChild(noneBtn);

      variantCandidates.forEach(function (v) {
        var btn = document.createElement('button');
        btn.className = 'pt-picker-type-btn';
        btn.textContent = v.label;
        if (v.price) btn.title = v.price;
        btn.addEventListener('click', function () {
          selectedVariantSelector = v.selector;
          variantToggle.querySelectorAll('.pt-picker-type-btn').forEach(function (b) {
            b.className = 'pt-picker-type-btn';
          });
          btn.className = 'pt-picker-type-btn active';
        });
        variantToggle.appendChild(btn);
      });

      variantFieldWrapper.appendChild(variantToggle);
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

      var payload = {
        action: 'elementSelected',
        selector: data.selector,
        price: parsePrice(priceInput.value),
        title: nameInput.value,
        imageUrl: imgInput.value,
        pageUrl: data.pageUrl,
        trackingType: currentType,
        checkIntervalHours: currentInterval,
        checkMode: currentMode,
        productGroup: groupInput ? groupInput.value : '',
        variantSelector: variantManualInput ? variantManualInput.value : selectedVariantSelector,
        contentValue: currentType === 'content' ? data.contentValue : undefined,
        excludedSelectors: data.excludedSelectors
      };

      chrome.runtime.sendMessage(payload);
      cleanup();
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

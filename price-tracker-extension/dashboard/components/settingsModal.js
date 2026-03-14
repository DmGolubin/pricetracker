/**
 * Settings Modal component for Price Tracker Extension dashboard.
 *
 * Renders a modal with tracker settings:
 * - Notifications toggle (on/off)
 * - Check interval radio buttons: 6h, 12h, 24h, disabled
 * - Editable product name and image URL fields
 * - Check mode: "Авто" / "Pin Tab"
 * - Notification filter: type select + value input
 * - Price History section (via PriceHistory component if available)
 * - Save button — updates tracker via service worker
 * - Delete button — confirms and deletes tracker
 * - On open for "updated" status — resets status to "active"
 *
 * Usage: SettingsModal.open(tracker, container, { onSave, onDelete })
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 16.1, 18.4, 19.1
 */

const SettingsModal = (function () {
  // ─── Icons reference (global in browser, require in Node/Jest) ────
  var _Icons = (typeof Icons !== 'undefined') ? Icons
             : (typeof require === 'function' ? require('../../shared/icons') : null);

  // ─── Constants helpers (same pattern as globalSettings.js) ──────
  function getConstants() {
    if (typeof self !== 'undefined' && self.PriceTracker && self.PriceTracker.constants) {
      return self.PriceTracker.constants;
    }
    try { return require('../../shared/constants'); } catch (e) { return null; }
  }

  function getDefaultTiers() {
    var c = getConstants();
    if (c && c.DEFAULT_ADAPTIVE_TIERS) return c.DEFAULT_ADAPTIVE_TIERS;
    return [
      { min: 0, max: 1000, percent: 8 },
      { min: 1001, max: 5000, percent: 5 },
      { min: 5001, max: 20000, percent: 4 },
      { min: 20001, max: 50000, percent: 3 },
      { min: 50001, max: 999999999, percent: 2 },
    ];
  }

  function getThresholdModes() {
    var c = getConstants();
    if (c && c.ThresholdMode) return c.ThresholdMode;
    return { ADAPTIVE: 'adaptive', ABSOLUTE: 'absolute', PERCENTAGE: 'percentage' };
  }

  // ─── Custom Dropdown for Settings Modal ──────────────────────────

  /**
   * Create a custom styled dropdown (same pattern as Toolbar.createCustomDropdown).
   * @param {Object} opts
   * @param {Array<{value:string, text:string}>} opts.options
   * @param {string} opts.selected - initial selected value
   * @param {string} opts.ariaLabel
   * @param {string} opts.dataField - data-field attribute for form collection
   * @param {Function} opts.onChange - callback(value)
   * @returns {HTMLElement}
   */
  function createSettingsDropdown(opts) {
    var wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown';
    wrapper.setAttribute('role', 'listbox');
    wrapper.setAttribute('aria-label', opts.ariaLabel || '');
    wrapper.setAttribute('data-field', opts.dataField || '');
    wrapper.tabIndex = 0;

    var selectedOpt = opts.options.find(function (o) { return o.value === opts.selected; }) || opts.options[0];

    var trigger = document.createElement('div');
    trigger.className = 'custom-dropdown-trigger';
    trigger.innerHTML = '<span class="custom-dropdown-text">' + escapeHtml(selectedOpt.text) + '</span>'
      + '<span class="custom-dropdown-arrow">' + (_Icons ? _Icons.el('arrow-down', 12) : '▾') + '</span>';

    var menu = document.createElement('div');
    menu.className = 'custom-dropdown-menu';

    opts.options.forEach(function (opt) {
      var item = document.createElement('div');
      item.className = 'custom-dropdown-item' + (opt.value === selectedOpt.value ? ' active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', opt.value === selectedOpt.value ? 'true' : 'false');
      item.setAttribute('data-value', opt.value);
      item.textContent = opt.text;
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        menu.querySelectorAll('.custom-dropdown-item').forEach(function (el) {
          el.classList.remove('active');
          el.setAttribute('aria-selected', 'false');
        });
        item.classList.add('active');
        item.setAttribute('aria-selected', 'true');
        trigger.querySelector('.custom-dropdown-text').textContent = opt.text;
        wrapper.classList.remove('open');
        wrapper.setAttribute('data-value', opt.value);
        if (typeof opts.onChange === 'function') opts.onChange(opt.value);
      });
      menu.appendChild(item);
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    wrapper.setAttribute('data-value', selectedOpt.value);

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      document.querySelectorAll('.custom-dropdown.open').forEach(function (dd) {
        if (dd !== wrapper) dd.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    wrapper.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        wrapper.classList.toggle('open');
      } else if (e.key === 'Escape') {
        wrapper.classList.remove('open');
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var items = menu.querySelectorAll('.custom-dropdown-item');
        var currentIdx = -1;
        items.forEach(function (el, i) { if (el.classList.contains('active')) currentIdx = i; });
        var nextIdx = e.key === 'ArrowDown'
          ? Math.min(currentIdx + 1, items.length - 1)
          : Math.max(currentIdx - 1, 0);
        if (items[nextIdx]) items[nextIdx].click();
      }
    });

    return wrapper;
  }

  var currentTracker = null;
  var currentContainer = null;
  var currentCallbacks = null;

  // ─── Helpers ──────────────────────────────────────────────────────

  function escapeHtml(str) {
    if (str == null) return '';
    var div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function sendMessage(msg) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(msg, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  // ─── Threshold override section builder ─────────────────────────

  function buildThresholdOverrideSection(notificationThreshold) {
    var modes = getThresholdModes();
    var hasOverride = notificationThreshold != null;
    var config = notificationThreshold || { mode: modes.ADAPTIVE, absoluteValue: 50, percentageValue: 5, adaptiveTiers: getDefaultTiers() };
    var currentMode = config.mode || modes.ADAPTIVE;

    var section = document.createElement('div');
    section.className = 'form-group threshold-override-section';
    section.setAttribute('data-section', 'threshold-override');

    var sectionLabel = document.createElement('label');
    sectionLabel.textContent = 'Порог уведомлений (override)';
    sectionLabel.className = 'section-label';
    section.appendChild(sectionLabel);

    // Toggle: "Использовать свой порог"
    var toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'threshold-override-toggle-wrapper';

    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    var toggleCheckbox = document.createElement('input');
    toggleCheckbox.type = 'checkbox';
    toggleCheckbox.checked = hasOverride;
    toggleCheckbox.setAttribute('data-field', 'thresholdOverrideEnabled');
    var slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(toggleCheckbox);
    toggleLabel.appendChild(slider);

    var toggleText = document.createElement('span');
    toggleText.className = 'threshold-override-toggle-text';
    toggleText.textContent = 'Использовать свой порог';
    toggleText.style.marginLeft = '8px';

    toggleWrapper.appendChild(toggleLabel);
    toggleWrapper.appendChild(toggleText);
    section.appendChild(toggleWrapper);

    // Content area (shown/hidden based on toggle)
    var contentArea = document.createElement('div');
    contentArea.className = 'threshold-override-content';
    contentArea.setAttribute('data-area', 'threshold-override-content');

    // Global fallback message (shown when toggle is OFF)
    var globalMsg = document.createElement('p');
    globalMsg.className = 'threshold-global-msg';
    globalMsg.textContent = 'Используются глобальные настройки';
    globalMsg.style.cssText = 'color:var(--text-muted);font-style:italic;margin:8px 0 0 0;font-size:13px';
    globalMsg.style.display = hasOverride ? 'none' : '';

    // Override controls (shown when toggle is ON)
    var overrideControls = document.createElement('div');
    overrideControls.className = 'threshold-override-controls';
    overrideControls.style.display = hasOverride ? '' : 'none';

    // Radio buttons for mode selection
    var radioGroup = document.createElement('div');
    radioGroup.className = 'threshold-mode-group';
    radioGroup.setAttribute('role', 'radiogroup');
    radioGroup.setAttribute('aria-label', 'Режим порога уведомлений (override)');

    var modeOptions = [
      { value: modes.ADAPTIVE, label: 'Адаптивный' },
      { value: modes.ABSOLUTE, label: 'Абсолютный' },
      { value: modes.PERCENTAGE, label: 'Процентный' },
    ];

    for (var i = 0; i < modeOptions.length; i++) {
      var opt = modeOptions[i];
      var radioLabel = document.createElement('label');
      radioLabel.className = 'threshold-radio-label';

      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'thresholdOverrideMode';
      radio.value = opt.value;
      radio.checked = currentMode === opt.value;
      radio.setAttribute('data-field', 'thresholdOverrideMode');

      var labelSpan = document.createElement('span');
      labelSpan.textContent = opt.label;

      radioLabel.appendChild(radio);
      radioLabel.appendChild(labelSpan);
      radioGroup.appendChild(radioLabel);
    }

    overrideControls.appendChild(radioGroup);

    // Absolute value panel
    var absolutePanel = document.createElement('div');
    absolutePanel.className = 'threshold-panel threshold-absolute-panel';
    absolutePanel.setAttribute('data-panel', 'override-absolute');
    absolutePanel.style.display = currentMode === modes.ABSOLUTE ? '' : 'none';

    var absLabel = document.createElement('label');
    absLabel.textContent = 'Пороговое значение (UAH)';
    var absInput = document.createElement('input');
    absInput.type = 'number';
    absInput.className = 'input';
    absInput.min = '0';
    absInput.step = '1';
    absInput.value = config.absoluteValue != null ? config.absoluteValue : 50;
    absInput.setAttribute('data-field', 'thresholdOverrideAbsoluteValue');
    absInput.setAttribute('aria-label', 'Пороговое значение override (UAH)');
    absolutePanel.appendChild(absLabel);
    absolutePanel.appendChild(absInput);
    overrideControls.appendChild(absolutePanel);

    // Percentage value panel
    var percentagePanel = document.createElement('div');
    percentagePanel.className = 'threshold-panel threshold-percentage-panel';
    percentagePanel.setAttribute('data-panel', 'override-percentage');
    percentagePanel.style.display = currentMode === modes.PERCENTAGE ? '' : 'none';

    var pctLabel = document.createElement('label');
    pctLabel.textContent = 'Пороговое значение (%)';
    var pctInput = document.createElement('input');
    pctInput.type = 'number';
    pctInput.className = 'input';
    pctInput.min = '0';
    pctInput.step = '0.1';
    pctInput.value = config.percentageValue != null ? config.percentageValue : 5;
    pctInput.setAttribute('data-field', 'thresholdOverridePercentageValue');
    pctInput.setAttribute('aria-label', 'Пороговое значение override (%)');
    percentagePanel.appendChild(pctLabel);
    percentagePanel.appendChild(pctInput);
    overrideControls.appendChild(percentagePanel);

    // Adaptive tiers description panel
    var adaptivePanel = document.createElement('div');
    adaptivePanel.className = 'threshold-panel threshold-adaptive-panel';
    adaptivePanel.setAttribute('data-panel', 'override-adaptive');
    adaptivePanel.style.display = currentMode === modes.ADAPTIVE ? '' : 'none';

    var tiers = config.adaptiveTiers || getDefaultTiers();
    var table = document.createElement('table');
    table.className = 'adaptive-tiers-table';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    var headers = ['Диапазон цен (UAH)', 'Порог (%)'];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement('th');
      th.textContent = headers[h];
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var t = 0; t < tiers.length; t++) {
      var tier = tiers[t];
      var row = document.createElement('tr');
      var rangeCell = document.createElement('td');
      var maxLabel = tier.max >= 999999999 ? '∞' : tier.max.toLocaleString();
      rangeCell.textContent = tier.min.toLocaleString() + ' — ' + maxLabel;
      var pctCell = document.createElement('td');
      pctCell.textContent = tier.percent + '%';
      row.appendChild(rangeCell);
      row.appendChild(pctCell);
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    adaptivePanel.appendChild(table);
    overrideControls.appendChild(adaptivePanel);

    // Wire radio change events for mode panels
    var radios = radioGroup.querySelectorAll('input[name="thresholdOverrideMode"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', function () {
        var selected = this.value;
        absolutePanel.style.display = selected === modes.ABSOLUTE ? '' : 'none';
        percentagePanel.style.display = selected === modes.PERCENTAGE ? '' : 'none';
        adaptivePanel.style.display = selected === modes.ADAPTIVE ? '' : 'none';
      });
    }

    contentArea.appendChild(globalMsg);
    contentArea.appendChild(overrideControls);
    section.appendChild(contentArea);

    // Wire toggle change event
    toggleCheckbox.addEventListener('change', function () {
      var isOn = toggleCheckbox.checked;
      globalMsg.style.display = isOn ? 'none' : '';
      overrideControls.style.display = isOn ? '' : 'none';
    });

    return section;
  }

  // ─── Render ───────────────────────────────────────────────────────

  function buildModal(tracker) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('data-testid', 'settings-modal-overlay');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Настройки трекера');

    // ── Header ──
    var header = document.createElement('div');
    header.className = 'modal-header';

    var title = document.createElement('h2');
    title.textContent = tracker.productName || 'Трекер';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.type = 'button';
    closeBtn.innerHTML = _Icons ? _Icons.el('close', 20) : '×';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.addEventListener('click', close);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // ── Body ──
    var body = document.createElement('div');
    body.className = 'modal-body';

    // Notifications toggle
    var notifGroup = createFormGroup('Уведомления', 'notifications');
    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    var notifCheckbox = document.createElement('input');
    notifCheckbox.type = 'checkbox';
    notifCheckbox.checked = tracker.notificationsEnabled !== false;
    notifCheckbox.setAttribute('data-field', 'notificationsEnabled');
    var slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(notifCheckbox);
    toggleLabel.appendChild(slider);
    notifGroup.appendChild(toggleLabel);
    body.appendChild(notifGroup);

    // Divider after notifications
    body.appendChild(createSectionDivider());

    // Check interval radio buttons
    var intervalGroup = createFormGroup('Интервал проверки', 'refresh');
    var radioGroup = document.createElement('div');
    radioGroup.className = 'radio-group';
    radioGroup.setAttribute('role', 'radiogroup');
    radioGroup.setAttribute('aria-label', 'Интервал проверки');

    var intervals = [
      { value: 3, label: '3 часа' },
      { value: 6, label: '6 часов' },
      { value: 12, label: '12 часов' },
      { value: 24, label: '1 день' },
      { value: 0, label: 'Не обновлять' },
      { value: -1, label: 'Свой' },
    ];

    var presetValues = [3, 6, 12, 24, 0];
    var isCustom = presetValues.indexOf(tracker.checkIntervalHours) === -1 && tracker.checkIntervalHours > 0;

    // Custom interval input (hidden by default)
    var customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.className = 'input';
    customInput.min = '1';
    customInput.max = '720';
    customInput.placeholder = 'Часы';
    customInput.setAttribute('data-field', 'customInterval');
    customInput.setAttribute('aria-label', 'Свой интервал в часах');
    customInput.style.width = '80px';
    customInput.style.marginTop = 'var(--spacing-xs)';
    customInput.style.display = isCustom ? '' : 'none';
    if (isCustom) {
      customInput.value = String(tracker.checkIntervalHours);
    }

    intervals.forEach(function (opt) {
      var optLabel = document.createElement('label');
      optLabel.className = 'radio-option';
      var isSelected = opt.value === -1 ? isCustom : tracker.checkIntervalHours === opt.value;
      if (isSelected) {
        optLabel.classList.add('selected');
      }
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'checkInterval';
      radio.value = String(opt.value);
      radio.checked = isSelected;
      radio.addEventListener('change', function () {
        radioGroup.querySelectorAll('.radio-option').forEach(function (el) {
          el.classList.remove('selected');
        });
        optLabel.classList.add('selected');
        // Show/hide custom input
        if (opt.value === -1) {
          customInput.style.display = '';
          customInput.focus();
        } else {
          customInput.style.display = 'none';
        }
      });
      var span = document.createElement('span');
      span.textContent = opt.label;
      optLabel.appendChild(radio);
      optLabel.appendChild(span);
      radioGroup.appendChild(optLabel);
    });

    intervalGroup.appendChild(radioGroup);
    intervalGroup.appendChild(customInput);
    body.appendChild(intervalGroup);

    // Divider after interval
    body.appendChild(createSectionDivider());

    // Product name input
    var nameGroup = createFormGroup('Название товара');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'input';
    nameInput.value = tracker.productName || '';
    nameInput.setAttribute('data-field', 'productName');
    nameInput.setAttribute('aria-label', 'Название товара');
    nameGroup.appendChild(nameInput);
    body.appendChild(nameGroup);

    // Divider after name
    body.appendChild(createSectionDivider());

    // Image URL input
    var imageGroup = createFormGroup('URL изображения', 'link');
    var imageInput = document.createElement('input');
    imageInput.type = 'text';
    imageInput.className = 'input';
    imageInput.value = tracker.imageUrl || '';
    imageInput.setAttribute('data-field', 'imageUrl');
    imageInput.setAttribute('aria-label', 'URL изображения');
    imageGroup.appendChild(imageInput);
    body.appendChild(imageGroup);

    // Divider after image URL
    body.appendChild(createSectionDivider());

    // Variant selector input (for dynamic price pages)
    var variantGroup = createFormGroup('Селектор варианта');
    var variantInput = document.createElement('input');
    variantInput.type = 'text';
    variantInput.className = 'input';
    variantInput.value = tracker.variantSelector || '';
    variantInput.placeholder = 'CSS-селектор для клика перед проверкой';
    variantInput.setAttribute('data-field', 'variantSelector');
    variantInput.setAttribute('aria-label', 'CSS-селектор варианта товара');
    variantGroup.appendChild(variantInput);
    body.appendChild(variantGroup);

    // Divider after variant selector
    body.appendChild(createSectionDivider());

    // Product group dropdown (tag-like: select existing or create new)
    var groupGroup = createFormGroup('Группа товара');
    var groupWrapper = document.createElement('div');
    groupWrapper.className = 'group-dropdown-wrapper';
    groupWrapper.style.position = 'relative';

    var groupDisplay = document.createElement('button');
    groupDisplay.type = 'button';
    groupDisplay.className = 'input group-dropdown-btn';
    groupDisplay.setAttribute('data-field', 'productGroup');
    groupDisplay.setAttribute('aria-label', 'Группа товара для сравнения цен');
    groupDisplay.setAttribute('aria-haspopup', 'listbox');
    groupDisplay.style.textAlign = 'left';
    groupDisplay.style.cursor = 'pointer';
    groupDisplay.style.width = '100%';
    groupDisplay.textContent = tracker.productGroup || 'Выбрать группу...';
    if (!tracker.productGroup) {
      groupDisplay.style.color = 'var(--text-muted)';
    }

    // Hidden input to store value for collectFormData
    var groupHidden = document.createElement('input');
    groupHidden.type = 'hidden';
    groupHidden.setAttribute('data-field', 'productGroup');
    groupHidden.value = tracker.productGroup || '';

    var groupDropdown = document.createElement('div');
    groupDropdown.className = 'group-dropdown-list';
    groupDropdown.setAttribute('role', 'listbox');
    groupDropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;right:0;z-index:10;'
      + 'background:var(--bg-card);border:1px solid var(--border-primary);border-radius:var(--radius-md);'
      + 'max-height:180px;overflow-y:auto;margin-top:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3)';

    function setGroupValue(val) {
      groupHidden.value = val;
      groupDisplay.textContent = val || 'Выбрать группу...';
      groupDisplay.style.color = val ? '' : 'var(--text-muted)';
      groupDropdown.style.display = 'none';
    }

    function populateGroupDropdown() {
      groupDropdown.innerHTML = '';

      // "Нет группы" option to clear
      var noneItem = document.createElement('div');
      noneItem.className = 'group-dropdown-item';
      noneItem.setAttribute('role', 'option');
      noneItem.textContent = '— Нет группы —';
      noneItem.style.cssText = 'padding:8px 12px;cursor:pointer;color:var(--text-muted);font-style:italic';
      noneItem.addEventListener('click', function (e) {
        e.stopPropagation();
        setGroupValue('');
      });
      noneItem.addEventListener('mouseenter', function () { noneItem.style.background = 'var(--bg-input)'; });
      noneItem.addEventListener('mouseleave', function () { noneItem.style.background = ''; });
      groupDropdown.appendChild(noneItem);

      // Fetch existing groups from API
      sendMessage({ action: 'getAllTrackers' }).then(function (response) {
        var trackers = [];
        if (response && Array.isArray(response.data)) {
          trackers = response.data;
        } else if (response && Array.isArray(response.trackers)) {
          trackers = response.trackers;
        } else if (Array.isArray(response)) {
          trackers = response;
        }
        var groups = {};
        trackers.forEach(function (t) {
          if (t.productGroup) {
            groups[t.productGroup] = true;
          }
        });
        var groupNames = Object.keys(groups).sort();

        groupNames.forEach(function (name) {
          var item = document.createElement('div');
          item.className = 'group-dropdown-item';
          item.setAttribute('role', 'option');
          item.textContent = name;
          item.style.cssText = 'padding:8px 12px;cursor:pointer;color:var(--text-primary)';
          if (name === groupHidden.value) {
            item.style.background = 'var(--bg-input)';
            item.style.fontWeight = '600';
          }
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            setGroupValue(name);
          });
          item.addEventListener('mouseenter', function () { item.style.background = 'var(--bg-input)'; });
          item.addEventListener('mouseleave', function () {
            item.style.background = name === groupHidden.value ? 'var(--bg-input)' : '';
          });
          groupDropdown.appendChild(item);
        });

        // "Создать новую" option
        var createItem = document.createElement('div');
        createItem.className = 'group-dropdown-item group-dropdown-create';
        createItem.setAttribute('role', 'option');
        createItem.textContent = '+ Создать новую...';
        createItem.style.cssText = 'padding:8px 12px;cursor:pointer;color:var(--accent-primary);font-weight:500;border-top:1px solid var(--border-primary)';
        createItem.addEventListener('click', function (e) {
          e.stopPropagation();
          // Replace dropdown with text input for new group name
          groupDropdown.style.display = 'none';
          var newInput = document.createElement('input');
          newInput.type = 'text';
          newInput.className = 'input';
          newInput.placeholder = 'Название новой группы';
          newInput.setAttribute('aria-label', 'Название новой группы');
          newInput.style.marginTop = '4px';
          groupWrapper.appendChild(newInput);
          newInput.focus();
          newInput.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              var val = newInput.value.trim();
              if (val) setGroupValue(val);
              newInput.remove();
            } else if (ev.key === 'Escape') {
              newInput.remove();
            }
          });
          newInput.addEventListener('blur', function () {
            var val = newInput.value.trim();
            if (val) setGroupValue(val);
            newInput.remove();
          });
        });
        createItem.addEventListener('mouseenter', function () { createItem.style.background = 'var(--bg-input)'; });
        createItem.addEventListener('mouseleave', function () { createItem.style.background = ''; });
        groupDropdown.appendChild(createItem);
      }).catch(function () {
        // On error, just show create option
        var createItem = document.createElement('div');
        createItem.className = 'group-dropdown-item group-dropdown-create';
        createItem.textContent = '+ Создать новую...';
        createItem.style.cssText = 'padding:8px 12px;cursor:pointer;color:var(--accent-primary)';
        createItem.addEventListener('click', function (e) {
          e.stopPropagation();
          groupDropdown.style.display = 'none';
          var newInput = document.createElement('input');
          newInput.type = 'text';
          newInput.className = 'input';
          newInput.placeholder = 'Название новой группы';
          newInput.style.marginTop = '4px';
          groupWrapper.appendChild(newInput);
          newInput.focus();
          newInput.addEventListener('blur', function () {
            var val = newInput.value.trim();
            if (val) setGroupValue(val);
            newInput.remove();
          });
        });
        groupDropdown.appendChild(createItem);
      });
    }

    groupDisplay.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = groupDropdown.style.display !== 'none';
      if (isOpen) {
        groupDropdown.style.display = 'none';
      } else {
        populateGroupDropdown();
        groupDropdown.style.display = '';
      }
    });

    // Close dropdown on outside click
    overlay.addEventListener('click', function () {
      groupDropdown.style.display = 'none';
    });

    groupWrapper.appendChild(groupDisplay);
    groupWrapper.appendChild(groupHidden);
    groupWrapper.appendChild(groupDropdown);
    groupGroup.appendChild(groupWrapper);
    body.appendChild(groupGroup);

    // Divider after product group
    body.appendChild(createSectionDivider());

    // Check mode radio buttons
    var modeGroup = createFormGroup('Режим проверки');
    var modeRadioGroup = document.createElement('div');
    modeRadioGroup.className = 'radio-group';
    modeRadioGroup.setAttribute('role', 'radiogroup');
    modeRadioGroup.setAttribute('aria-label', 'Режим проверки');

    var modes = [
      { value: 'auto', label: 'Авто' },
      { value: 'pinTab', label: 'Pin Tab' },
    ];

    modes.forEach(function (opt) {
      var optLabel = document.createElement('label');
      optLabel.className = 'radio-option';
      if ((tracker.checkMode || 'auto') === opt.value) {
        optLabel.classList.add('selected');
      }
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'checkMode';
      radio.value = opt.value;
      radio.checked = (tracker.checkMode || 'auto') === opt.value;
      radio.addEventListener('change', function () {
        modeRadioGroup.querySelectorAll('.radio-option').forEach(function (el) {
          el.classList.remove('selected');
        });
        optLabel.classList.add('selected');
      });
      var span = document.createElement('span');
      span.textContent = opt.label;
      optLabel.appendChild(radio);
      optLabel.appendChild(span);
      modeRadioGroup.appendChild(optLabel);
    });

    modeGroup.appendChild(modeRadioGroup);
    body.appendChild(modeGroup);

    // Divider after check mode
    body.appendChild(createSectionDivider());

    // Notification filter (custom dropdown — no native <select>)
    var filterGroup = createFormGroup('Фильтр уведомлений');

    var filterTypes = [
      { value: 'none', text: 'Нет фильтра' },
      { value: 'contains', text: 'Содержит' },
      { value: 'greaterThan', text: 'Больше значения' },
      { value: 'lessThan', text: 'Меньше значения' },
      { value: 'increased', text: 'Увеличилось' },
      { value: 'decreased', text: 'Уменьшилось' },
    ];

    var currentFilterType = (tracker.notificationFilter && tracker.notificationFilter.type) || 'none';
    var currentFilterValue = (tracker.notificationFilter && tracker.notificationFilter.value) || '';

    var filterDropdown = createSettingsDropdown({
      options: filterTypes,
      selected: currentFilterType,
      ariaLabel: 'Тип фильтра уведомлений',
      dataField: 'filterType',
      onChange: function (value) {
        updateFilterValueVisibility(value);
      },
    });

    var filterValueInput = document.createElement('input');
    filterValueInput.type = 'text';
    filterValueInput.className = 'input';
    filterValueInput.placeholder = 'Значение фильтра';
    filterValueInput.value = currentFilterValue != null ? String(currentFilterValue) : '';
    filterValueInput.setAttribute('data-field', 'filterValue');
    filterValueInput.setAttribute('aria-label', 'Значение фильтра');
    filterValueInput.style.marginTop = 'var(--spacing-sm)';

    // Show/hide filter value based on type
    function updateFilterValueVisibility(type) {
      var noValueTypes = ['none', 'increased', 'decreased'];
      if (noValueTypes.indexOf(type) !== -1) {
        filterValueInput.style.display = 'none';
      } else {
        filterValueInput.style.display = '';
      }
    }

    updateFilterValueVisibility(currentFilterType);

    filterGroup.appendChild(filterDropdown);
    filterGroup.appendChild(filterValueInput);
    body.appendChild(filterGroup);

    // Divider after notification filter
    body.appendChild(createSectionDivider());

    // Threshold override section (Req 1.11)
    body.appendChild(buildThresholdOverrideSection(tracker.notificationThreshold));

    // Price History section
    if (typeof PriceHistory !== 'undefined' && PriceHistory.render) {
      var historySection = document.createElement('div');
      historySection.className = 'form-group';
      historySection.setAttribute('data-testid', 'price-history-section');
      PriceHistory.render(tracker, historySection);
      body.appendChild(historySection);
    }

    // ── Footer ──
    var footer = document.createElement('div');
    footer.className = 'modal-footer';

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.setAttribute('aria-label', 'Удалить трекер');
    deleteBtn.addEventListener('click', function () {
      handleDelete(tracker.id);
    });

    var pauseBtn = document.createElement('button');
    pauseBtn.className = 'btn';
    pauseBtn.type = 'button';
    var isPaused = tracker.status === 'paused';
    pauseBtn.textContent = isPaused ? 'Возобновить' : 'Приостановить';
    pauseBtn.setAttribute('aria-label', isPaused ? 'Возобновить трекер' : 'Приостановить трекер');
    pauseBtn.addEventListener('click', function () {
      handleTogglePause(overlay, tracker);
    });

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Сохранить';
    saveBtn.setAttribute('aria-label', 'Сохранить настройки');
    saveBtn.addEventListener('click', function () {
      handleSave(overlay, tracker.id);
    });

    footer.appendChild(deleteBtn);
    footer.appendChild(pauseBtn);
    footer.appendChild(saveBtn);

    // Assemble modal
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    // Close on overlay click (outside modal)
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
      }
    });

    return overlay;
  }

  function createFormGroup(labelText, iconName) {
    var group = document.createElement('div');
    group.className = 'form-group';
    var label = document.createElement('label');
    if (iconName && _Icons) {
      label.innerHTML = _Icons.el(iconName, 16) + ' ' + escapeHtml(labelText);
    } else {
      label.textContent = labelText;
    }
    group.appendChild(label);
    return group;
  }

  function createSectionDivider() {
    var hr = document.createElement('hr');
    hr.className = 'modal-section-divider';
    return hr;
  }

  // ─── Actions ──────────────────────────────────────────────────────

  function collectFormData(overlay) {
    var modal = overlay.querySelector('.modal');

    var notifCheckbox = modal.querySelector('[data-field="notificationsEnabled"]');
    var notificationsEnabled = notifCheckbox ? notifCheckbox.checked : true;

    var intervalRadio = modal.querySelector('input[name="checkInterval"]:checked');
    var checkIntervalHours = intervalRadio ? parseFloat(intervalRadio.value) : 3;
    // Handle custom interval
    if (checkIntervalHours === -1) {
      var customInput = modal.querySelector('[data-field="customInterval"]');
      checkIntervalHours = customInput ? (parseInt(customInput.value, 10) || 3) : 3;
      if (checkIntervalHours < 1) checkIntervalHours = 1;
      if (checkIntervalHours > 720) checkIntervalHours = 720;
    }

    var nameInput = modal.querySelector('[data-field="productName"]');
    var productName = nameInput ? nameInput.value : '';

    var imageInput = modal.querySelector('[data-field="imageUrl"]');
    var imageUrl = imageInput ? imageInput.value : '';

    var variantSelectorInput = modal.querySelector('[data-field="variantSelector"]');
    var variantSelector = variantSelectorInput ? variantSelectorInput.value : '';

    var modeRadio = modal.querySelector('input[name="checkMode"]:checked');
    var checkMode = modeRadio ? modeRadio.value : 'auto';

    var groupInput = modal.querySelector('input[data-field="productGroup"]');
    var productGroup = groupInput ? groupInput.value : '';

    var filterTypeDropdown = modal.querySelector('[data-field="filterType"]');
    var filterType = filterTypeDropdown ? (filterTypeDropdown.getAttribute('data-value') || 'none') : 'none';

    var filterValueInput = modal.querySelector('[data-field="filterValue"]');
    var filterValue = filterValueInput ? filterValueInput.value : '';

    var notificationFilter = { type: filterType };
    if (filterType !== 'none' && filterValue !== '') {
      if (filterType === 'greaterThan' || filterType === 'lessThan') {
        notificationFilter.value = parseFloat(filterValue) || 0;
      } else {
        notificationFilter.value = filterValue;
      }
    }

    // Threshold override
    var thresholdOverrideEnabled = modal.querySelector('[data-field="thresholdOverrideEnabled"]');
    var notificationThreshold = null;

    if (thresholdOverrideEnabled && thresholdOverrideEnabled.checked) {
      var modes = getThresholdModes();
      var selectedModeRadio = modal.querySelector('input[name="thresholdOverrideMode"]:checked');
      var selectedMode = selectedModeRadio ? selectedModeRadio.value : modes.ADAPTIVE;

      var overrideAbsInput = modal.querySelector('[data-field="thresholdOverrideAbsoluteValue"]');
      var overrideAbsoluteValue = overrideAbsInput ? parseFloat(overrideAbsInput.value) || 50 : 50;

      var overridePctInput = modal.querySelector('[data-field="thresholdOverridePercentageValue"]');
      var overridePercentageValue = overridePctInput ? parseFloat(overridePctInput.value) || 5 : 5;

      notificationThreshold = {
        mode: selectedMode,
        absoluteValue: overrideAbsoluteValue,
        percentageValue: overridePercentageValue,
        adaptiveTiers: selectedMode === modes.ADAPTIVE ? getDefaultTiers() : null,
      };
    }

    return {
      notificationsEnabled: notificationsEnabled,
      checkIntervalHours: checkIntervalHours,
      productName: productName,
      imageUrl: imageUrl,
      variantSelector: variantSelector,
      checkMode: checkMode,
      productGroup: productGroup,
      notificationFilter: notificationFilter,
      notificationThreshold: notificationThreshold,
    };
  }

  function handleSave(overlay, trackerId) {
    var data = collectFormData(overlay);

    sendMessage({
      action: 'updateTracker',
      trackerId: trackerId,
      data: data,
    })
      .then(function (response) {
        var updatedTracker = response && response.tracker ? response.tracker : Object.assign({}, currentTracker, data);
        if (currentCallbacks && typeof currentCallbacks.onSave === 'function') {
          currentCallbacks.onSave(updatedTracker);
        }
        close();
      })
      .catch(function () {
        // Silently close on error — could add error UI later
        close();
      });
  }

  function handleDelete(trackerId) {
    var confirmed = confirm('Вы уверены, что хотите удалить этот трекер?');
    if (!confirmed) return;

    // Apply shake animation before closing
    if (currentContainer) {
      var modal = currentContainer.querySelector('.modal');
      if (modal) {
        modal.classList.add('modal-shake');
      }
    }

    sendMessage({
      action: 'deleteTracker',
      trackerId: trackerId,
    })
      .then(function () {
        if (currentCallbacks && typeof currentCallbacks.onDelete === 'function') {
          currentCallbacks.onDelete(trackerId);
        }
        close();
      })
      .catch(function () {
        close();
      });
  }

  function handleTogglePause(overlay, tracker) {
    var isPaused = tracker.status === 'paused';
    var newStatus = isPaused ? 'active' : 'paused';
    var newInterval = isPaused ? (tracker.checkIntervalHours || 3) : 0;

    sendMessage({
      action: 'updateTracker',
      trackerId: tracker.id,
      data: { status: newStatus, checkIntervalHours: isPaused ? tracker.checkIntervalHours : tracker.checkIntervalHours },
    })
      .then(function (response) {
        var updatedTracker = response && response.tracker ? response.tracker : Object.assign({}, tracker, { status: newStatus });
        // If pausing, also cancel alarm; if resuming, reschedule
        if (!isPaused) {
          // Pausing — cancel alarm via setting interval to 0 then back
          sendMessage({ action: 'updateTracker', trackerId: tracker.id, data: { status: 'paused' } }).catch(function () {});
        }
        if (currentCallbacks && typeof currentCallbacks.onSave === 'function') {
          currentCallbacks.onSave(updatedTracker);
        }
        close();
      })
      .catch(function () {
        close();
      });
  }

  // ─── Public API ─────────────────────────────────────────────────

  function open(tracker, container, callbacks) {
    currentTracker = tracker;
    currentContainer = container;
    currentCallbacks = callbacks || {};

    // Build and insert modal
    var overlay = buildModal(tracker);
    container.innerHTML = '';
    container.appendChild(overlay);

    // Activate overlay
    overlay.classList.add('active');

    // If tracker has "updated" status, mark as read (Req 18.4)
    if (tracker.status === 'updated') {
      sendMessage({
        action: 'markAsRead',
        trackerId: tracker.id,
      }).catch(function () {});
    }
  }

  function close() {
    if (currentContainer) {
      currentContainer.innerHTML = '';
    }
    currentTracker = null;
    currentCallbacks = null;
  }

  return {
    open: open,
    close: close,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsModal;
}

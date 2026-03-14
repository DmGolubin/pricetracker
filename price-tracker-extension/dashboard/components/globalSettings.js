/**
 * Global Settings component for Price Tracker Extension dashboard.
 *
 * Renders a modal with global extension settings:
 * - API Base URL input
 * - Telegram Bot Token input
 * - Telegram Chat ID input
 * - Permanent Pin Tab toggle
 * - Save button — saves settings via service worker (saveSettings)
 *
 * Usage: GlobalSettings.open(container)
 *
 * Requirements: 10.1, 11.3, 19.4
 */

const GlobalSettings = (function () {
  var currentContainer = null;

  // ─── Helpers ──────────────────────────────────────────────────────

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

  function createFormGroup(labelText) {
    var group = document.createElement('div');
    group.className = 'form-group';
    var label = document.createElement('label');
    label.textContent = labelText;
    group.appendChild(label);
    return group;
  }

  // ─── Threshold helpers ──────────────────────────────────────────

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

  function buildThresholdSection(thresholdConfig) {
    var modes = getThresholdModes();
    var config = thresholdConfig || { mode: modes.ADAPTIVE, absoluteValue: 50, percentageValue: 5, adaptiveTiers: getDefaultTiers() };
    var currentMode = config.mode || modes.ADAPTIVE;

    var section = document.createElement('div');
    section.className = 'form-group threshold-section';
    section.setAttribute('data-section', 'threshold');

    var sectionLabel = document.createElement('label');
    sectionLabel.textContent = 'Порог уведомлений';
    sectionLabel.className = 'section-label';
    section.appendChild(sectionLabel);

    // Radio buttons for mode selection
    var radioGroup = document.createElement('div');
    radioGroup.className = 'threshold-mode-group';
    radioGroup.setAttribute('role', 'radiogroup');
    radioGroup.setAttribute('aria-label', 'Режим порога уведомлений');

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
      radio.name = 'thresholdMode';
      radio.value = opt.value;
      radio.checked = currentMode === opt.value;
      radio.setAttribute('data-field', 'thresholdMode');

      var labelText = document.createElement('span');
      labelText.textContent = opt.label;

      radioLabel.appendChild(radio);
      radioLabel.appendChild(labelText);
      radioGroup.appendChild(radioLabel);
    }

    section.appendChild(radioGroup);

    // Conditional panels
    var absolutePanel = document.createElement('div');
    absolutePanel.className = 'threshold-panel threshold-absolute-panel';
    absolutePanel.setAttribute('data-panel', 'absolute');
    absolutePanel.style.display = currentMode === modes.ABSOLUTE ? '' : 'none';

    var absLabel = document.createElement('label');
    absLabel.textContent = 'Пороговое значение (UAH)';
    var absInput = document.createElement('input');
    absInput.type = 'number';
    absInput.className = 'input';
    absInput.min = '0';
    absInput.step = '1';
    absInput.value = config.absoluteValue != null ? config.absoluteValue : 50;
    absInput.setAttribute('data-field', 'thresholdAbsoluteValue');
    absInput.setAttribute('aria-label', 'Пороговое значение (UAH)');
    absolutePanel.appendChild(absLabel);
    absolutePanel.appendChild(absInput);
    section.appendChild(absolutePanel);

    var percentagePanel = document.createElement('div');
    percentagePanel.className = 'threshold-panel threshold-percentage-panel';
    percentagePanel.setAttribute('data-panel', 'percentage');
    percentagePanel.style.display = currentMode === modes.PERCENTAGE ? '' : 'none';

    var pctLabel = document.createElement('label');
    pctLabel.textContent = 'Пороговое значение (%)';
    var pctInput = document.createElement('input');
    pctInput.type = 'number';
    pctInput.className = 'input';
    pctInput.min = '0';
    pctInput.step = '0.1';
    pctInput.value = config.percentageValue != null ? config.percentageValue : 5;
    pctInput.setAttribute('data-field', 'thresholdPercentageValue');
    pctInput.setAttribute('aria-label', 'Пороговое значение (%)');
    percentagePanel.appendChild(pctLabel);
    percentagePanel.appendChild(pctInput);
    section.appendChild(percentagePanel);

    var adaptivePanel = document.createElement('div');
    adaptivePanel.className = 'threshold-panel threshold-adaptive-panel';
    adaptivePanel.setAttribute('data-panel', 'adaptive');
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
    section.appendChild(adaptivePanel);

    // Wire radio change events
    var radios = radioGroup.querySelectorAll('input[name="thresholdMode"]');
    for (var r = 0; r < radios.length; r++) {
      radios[r].addEventListener('change', function () {
        var selected = this.value;
        absolutePanel.style.display = selected === modes.ABSOLUTE ? '' : 'none';
        percentagePanel.style.display = selected === modes.PERCENTAGE ? '' : 'none';
        adaptivePanel.style.display = selected === modes.ADAPTIVE ? '' : 'none';
      });
    }

    return section;
  }

  function buildDigestToggle(enabled) {
    var group = document.createElement('div');
    group.className = 'form-group digest-section';
    group.setAttribute('data-section', 'digest');

    var label = document.createElement('label');
    label.textContent = 'Telegram дайджест';
    label.className = 'section-label';
    group.appendChild(label);

    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled !== false; // default: enabled
    checkbox.setAttribute('data-field', 'telegramDigestEnabled');
    var slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(slider);
    group.appendChild(toggleLabel);

    return group;
  }

  // ─── Render ───────────────────────────────────────────────────────

  function buildModal(settings) {
    var s = settings || {};

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('data-testid', 'global-settings-overlay');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Глобальные настройки');

    // ── Header ──
    var header = document.createElement('div');
    header.className = 'modal-header';

    var titleWrap = document.createElement('span');
    titleWrap.className = 'modal-title-wrap';
    if (typeof Icons !== 'undefined') {
      titleWrap.innerHTML = Icons.el('settings', 20);
    }
    var title = document.createElement('h2');
    title.textContent = 'Глобальные настройки';
    titleWrap.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.type = 'button';
    if (typeof Icons !== 'undefined') {
      closeBtn.innerHTML = Icons.el('close', 20);
    } else {
      closeBtn.textContent = '×';
    }
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.addEventListener('click', close);

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    // ── Body ──
    var body = document.createElement('div');
    body.className = 'modal-body';

    // API Base URL
    var apiGroup = createFormGroup('API Base URL');
    var apiInput = document.createElement('input');
    apiInput.type = 'text';
    apiInput.className = 'input';
    apiInput.value = s.apiBaseUrl || '';
    apiInput.placeholder = 'https://api.example.com';
    apiInput.setAttribute('data-field', 'apiBaseUrl');
    apiInput.setAttribute('aria-label', 'API Base URL');
    apiGroup.appendChild(apiInput);
    body.appendChild(apiGroup);

    // Telegram info note (fields removed — auto-configured by bot)
    var tgNote = document.createElement('div');
    tgNote.className = 'form-group';
    var tgNoteLabel = document.createElement('label');
    tgNoteLabel.textContent = 'Telegram';
    tgNote.appendChild(tgNoteLabel);
    var tgNoteText = document.createElement('p');
    tgNoteText.className = 'settings-info-note';
    tgNoteText.textContent = 'Telegram настраивается автоматически при отправке /start боту. Chat ID и токен задаются на сервере.';
    tgNote.appendChild(tgNoteText);
    body.appendChild(tgNote);

    // Permanent Pin Tab toggle
    var pinGroup = createFormGroup('Постоянная вкладка для Pin Tab');
    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    var pinCheckbox = document.createElement('input');
    pinCheckbox.type = 'checkbox';
    pinCheckbox.checked = s.permanentPinTab === true;
    pinCheckbox.setAttribute('data-field', 'permanentPinTab');
    var slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggleLabel.appendChild(pinCheckbox);
    toggleLabel.appendChild(slider);
    pinGroup.appendChild(toggleLabel);
    body.appendChild(pinGroup);

    // ── Threshold section (Req 1.10) ──
    body.appendChild(buildThresholdSection(s.thresholdConfig));

    // ── Telegram digest toggle (Req 2.9) ──
    body.appendChild(buildDigestToggle(s.telegramDigestEnabled));

    // ── Footer ──
    var footer = document.createElement('div');
    footer.className = 'modal-footer';

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.type = 'button';
    saveBtn.textContent = 'Сохранить';
    saveBtn.setAttribute('aria-label', 'Сохранить настройки');
    saveBtn.addEventListener('click', function () {
      handleSave(overlay);
    });

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

  // ─── Actions ──────────────────────────────────────────────────────

  function collectFormData(overlay) {
    var modal = overlay.querySelector('.modal');

    var apiInput = modal.querySelector('[data-field="apiBaseUrl"]');
    var apiBaseUrl = apiInput ? apiInput.value : '';

    // Telegram fields removed — auto-configured by bot

    var pinCheckbox = modal.querySelector('[data-field="permanentPinTab"]');
    var permanentPinTab = pinCheckbox ? pinCheckbox.checked : false;

    // Threshold config
    var modes = getThresholdModes();
    var selectedModeRadio = modal.querySelector('input[name="thresholdMode"]:checked');
    var selectedMode = selectedModeRadio ? selectedModeRadio.value : modes.ADAPTIVE;

    var absInput = modal.querySelector('[data-field="thresholdAbsoluteValue"]');
    var absoluteValue = absInput ? parseFloat(absInput.value) || 50 : 50;

    var pctInput = modal.querySelector('[data-field="thresholdPercentageValue"]');
    var percentageValue = pctInput ? parseFloat(pctInput.value) || 5 : 5;

    var thresholdConfig = {
      mode: selectedMode,
      absoluteValue: absoluteValue,
      percentageValue: percentageValue,
      adaptiveTiers: getDefaultTiers(),
    };

    // Telegram digest toggle
    var digestCheckbox = modal.querySelector('[data-field="telegramDigestEnabled"]');
    var telegramDigestEnabled = digestCheckbox ? digestCheckbox.checked : true;

    return {
      apiBaseUrl: apiBaseUrl,
      permanentPinTab: permanentPinTab,
      thresholdConfig: thresholdConfig,
      telegramDigestEnabled: telegramDigestEnabled,
    };
  }

  var API_BASE = 'https://pricetracker-production-ac69.up.railway.app';

  function handleSave(overlay) {
    var settings = collectFormData(overlay);
    var saveBtn = overlay.querySelector('.btn-primary');
    var originalText = saveBtn ? saveBtn.textContent : 'Сохранить';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="save-spinner"></span>';
    }

    // Try service worker first, fall back to direct fetch
    sendMessage({
      action: 'saveSettings',
      settings: settings,
    })
      .then(function () {
        if (saveBtn && typeof Icons !== 'undefined') {
          saveBtn.innerHTML = Icons.el('check', 18);
          saveBtn.style.color = 'var(--accent-green, #4CAF50)';
        }
        setTimeout(function () {
          close();
          if (typeof window !== 'undefined' && window.location) {
            window.location.reload();
          }
        }, 600);
      })
      .catch(function () {
        // Fallback: save directly via fetch
        return fetch(API_BASE + '/settings/global', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, settings, { id: 'global' })),
        }).then(function (res) {
          if (res.ok) {
            if (saveBtn && typeof Icons !== 'undefined') {
              saveBtn.innerHTML = Icons.el('check', 18);
              saveBtn.style.color = 'var(--accent-green, #4CAF50)';
            }
            setTimeout(function () {
              close();
              if (typeof window !== 'undefined' && window.location) {
                window.location.reload();
              }
            }, 600);
          } else {
            throw new Error('HTTP ' + res.status);
          }
        });
      })
      .catch(function (err) {
        if (saveBtn) {
          saveBtn.disabled = false;
          if (typeof Icons !== 'undefined') {
            saveBtn.innerHTML = Icons.el('warning', 18) + ' ' + originalText;
            saveBtn.style.color = '';
          } else {
            saveBtn.textContent = originalText;
          }
        }
        var errorEl = overlay.querySelector('.settings-error');
        if (!errorEl) {
          errorEl = document.createElement('p');
          errorEl.className = 'settings-error';
          errorEl.style.cssText = 'color:#F44336;text-align:center;margin-top:8px;font-size:13px;';
          var footer = overlay.querySelector('.modal-footer');
          if (footer) footer.insertBefore(errorEl, footer.firstChild);
        }
        errorEl.textContent = 'Ошибка сохранения: ' + (err.message || 'неизвестная ошибка');
        if (typeof Icons !== 'undefined') {
          errorEl.innerHTML = Icons.el('warning', 14) + ' ' + errorEl.textContent;
        }
      });
  }

  // ─── Public API ─────────────────────────────────────────────────

  function open(container) {
    currentContainer = container;

    // Try service worker first, fall back to direct fetch
    sendMessage({ action: 'getSettings' })
      .then(function (response) {
        var settings = {};
        if (response && response.data) {
          settings = response.data;
        } else if (response && response.settings) {
          settings = response.settings;
        } else if (response && typeof response === 'object') {
          settings = response;
        }
        return settings;
      })
      .catch(function () {
        // Fallback: fetch directly
        if (typeof fetch === 'undefined') return {};
        return fetch(API_BASE + '/settings/global')
          .then(function (res) { return res.ok ? res.json() : {}; })
          .catch(function () { return {}; });
      })
      .then(function (settings) {
        var overlay = buildModal(settings);
        container.innerHTML = '';
        container.appendChild(overlay);
        overlay.classList.add('active');
      });
  }

  function close() {
    if (currentContainer) {
      currentContainer.innerHTML = '';
    }
    currentContainer = null;
  }

  return {
    open: open,
    close: close,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GlobalSettings;
}

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

    // Telegram Bot Token
    var tokenGroup = createFormGroup('Telegram Bot Token');
    var tokenInput = document.createElement('input');
    tokenInput.type = 'text';
    tokenInput.className = 'input';
    tokenInput.value = s.telegramBotToken || '';
    tokenInput.placeholder = 'Введите токен бота';
    tokenInput.setAttribute('data-field', 'telegramBotToken');
    tokenInput.setAttribute('aria-label', 'Telegram Bot Token');
    tokenGroup.appendChild(tokenInput);
    body.appendChild(tokenGroup);

    // Telegram Chat ID
    var chatGroup = createFormGroup('Telegram Chat ID');
    var chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'input';
    chatInput.value = s.telegramChatId || '';
    chatInput.placeholder = 'Введите Chat ID';
    chatInput.setAttribute('data-field', 'telegramChatId');
    chatInput.setAttribute('aria-label', 'Telegram Chat ID');
    chatGroup.appendChild(chatInput);
    body.appendChild(chatGroup);

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

    var tokenInput = modal.querySelector('[data-field="telegramBotToken"]');
    var telegramBotToken = tokenInput ? tokenInput.value : '';

    var chatInput = modal.querySelector('[data-field="telegramChatId"]');
    var telegramChatId = chatInput ? chatInput.value : '';

    var pinCheckbox = modal.querySelector('[data-field="permanentPinTab"]');
    var permanentPinTab = pinCheckbox ? pinCheckbox.checked : false;

    return {
      apiBaseUrl: apiBaseUrl,
      telegramBotToken: telegramBotToken,
      telegramChatId: telegramChatId,
      permanentPinTab: permanentPinTab,
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

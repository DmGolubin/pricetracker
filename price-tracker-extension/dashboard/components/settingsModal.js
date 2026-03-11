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
      { value: 0.003, label: '10 сек (тест)' },
      { value: 3, label: '3 часа' },
      { value: 6, label: '6 часов' },
      { value: 12, label: '12 часов' },
      { value: 24, label: '1 день' },
      { value: 0, label: 'Не обновлять' },
      { value: -1, label: 'Свой' },
    ];

    var presetValues = [0.003, 3, 6, 12, 24, 0];
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

    // Notification filter
    var filterGroup = createFormGroup('Фильтр уведомлений');
    var filterSelect = document.createElement('select');
    filterSelect.className = 'input';
    filterSelect.setAttribute('data-field', 'filterType');
    filterSelect.setAttribute('aria-label', 'Тип фильтра уведомлений');

    var filterTypes = [
      { value: 'none', label: 'Нет фильтра' },
      { value: 'contains', label: 'Содержит' },
      { value: 'greaterThan', label: 'Больше значения' },
      { value: 'lessThan', label: 'Меньше значения' },
      { value: 'increased', label: 'Увеличилось' },
      { value: 'decreased', label: 'Уменьшилось' },
    ];

    var currentFilterType = (tracker.notificationFilter && tracker.notificationFilter.type) || 'none';
    var currentFilterValue = (tracker.notificationFilter && tracker.notificationFilter.value) || '';

    filterTypes.forEach(function (opt) {
      var option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === currentFilterType) {
        option.selected = true;
      }
      filterSelect.appendChild(option);
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
    function updateFilterValueVisibility() {
      var noValueTypes = ['none', 'increased', 'decreased'];
      if (noValueTypes.indexOf(filterSelect.value) !== -1) {
        filterValueInput.style.display = 'none';
      } else {
        filterValueInput.style.display = '';
      }
    }

    filterSelect.addEventListener('change', updateFilterValueVisibility);
    updateFilterValueVisibility();

    filterGroup.appendChild(filterSelect);
    filterGroup.appendChild(filterValueInput);
    body.appendChild(filterGroup);

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
    var checkIntervalHours = intervalRadio ? parseFloat(intervalRadio.value) : 12;
    // Handle custom interval
    if (checkIntervalHours === -1) {
      var customInput = modal.querySelector('[data-field="customInterval"]');
      checkIntervalHours = customInput ? (parseInt(customInput.value, 10) || 12) : 12;
      if (checkIntervalHours < 1) checkIntervalHours = 1;
      if (checkIntervalHours > 720) checkIntervalHours = 720;
    }

    var nameInput = modal.querySelector('[data-field="productName"]');
    var productName = nameInput ? nameInput.value : '';

    var imageInput = modal.querySelector('[data-field="imageUrl"]');
    var imageUrl = imageInput ? imageInput.value : '';

    var modeRadio = modal.querySelector('input[name="checkMode"]:checked');
    var checkMode = modeRadio ? modeRadio.value : 'auto';

    var filterTypeSelect = modal.querySelector('[data-field="filterType"]');
    var filterType = filterTypeSelect ? filterTypeSelect.value : 'none';

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

    return {
      notificationsEnabled: notificationsEnabled,
      checkIntervalHours: checkIntervalHours,
      productName: productName,
      imageUrl: imageUrl,
      checkMode: checkMode,
      notificationFilter: notificationFilter,
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
    var newInterval = isPaused ? (tracker.checkIntervalHours || 12) : 0;

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

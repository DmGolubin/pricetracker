/**
 * Unit tests for SettingsModal component (dashboard/components/settingsModal.js)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 16.1, 18.4, 19.1
 */

const SettingsModal = require('../../dashboard/components/settingsModal');

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTracker(overrides) {
  return Object.assign(
    {
      id: 'tracker-1',
      pageUrl: 'https://shop.example.com/product/123',
      cssSelector: '.price',
      productName: 'Test Product',
      imageUrl: 'https://shop.example.com/img.jpg',
      initialPrice: 100,
      currentPrice: 90,
      minPrice: 85,
      maxPrice: 110,
      checkIntervalHours: 12,
      notificationsEnabled: true,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      trackingType: 'price',
      isAutoDetected: false,
      checkMode: 'auto',
      unread: false,
      notificationFilter: { type: 'none' },
    },
    overrides || {}
  );
}

function createContainer() {
  var c = document.createElement('div');
  c.id = 'modal-container';
  document.body.appendChild(c);
  return c;
}

function flushPromises() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('SettingsModal', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
    // Default mock: resolve immediately
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({});
    });
  });

  // ─── open() renders modal with all form elements (Req 6.1) ─────

  describe('open() renders modal structure', () => {
    test('renders modal overlay and modal', () => {
      SettingsModal.open(makeTracker(), container, {});

      expect(container.querySelector('.modal-overlay')).not.toBeNull();
      expect(container.querySelector('.modal')).not.toBeNull();
    });

    test('modal header shows tracker product name', () => {
      SettingsModal.open(makeTracker({ productName: 'My Widget' }), container, {});

      const header = container.querySelector('.modal-header h2');
      expect(header.textContent).toBe('My Widget');
    });

    test('modal has close button with SVG icon', () => {
      SettingsModal.open(makeTracker(), container, {});

      const closeBtn = container.querySelector('.modal-header .btn-icon');
      expect(closeBtn).not.toBeNull();
      const svg = closeBtn.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    test('modal has notifications toggle', () => {
      SettingsModal.open(makeTracker(), container, {});

      const toggle = container.querySelector('.toggle');
      expect(toggle).not.toBeNull();
      expect(toggle.querySelector('input[type="checkbox"]')).not.toBeNull();
    });

    test('modal has interval radio buttons (6h, 12h, 24h, disabled)', () => {
      SettingsModal.open(makeTracker(), container, {});

      const radios = container.querySelectorAll('input[name="checkInterval"]');
      expect(radios.length).toBe(7);
      expect(Array.from(radios).map(r => r.value)).toEqual(['0.003', '3', '6', '12', '24', '0', '-1']);
    });

    test('modal has product name input', () => {
      SettingsModal.open(makeTracker(), container, {});

      const input = container.querySelector('[data-field="productName"]');
      expect(input).not.toBeNull();
      expect(input.tagName).toBe('INPUT');
    });

    test('modal has image URL input', () => {
      SettingsModal.open(makeTracker(), container, {});

      const input = container.querySelector('[data-field="imageUrl"]');
      expect(input).not.toBeNull();
      expect(input.tagName).toBe('INPUT');
    });

    test('modal has check mode radio buttons (auto, pinTab)', () => {
      SettingsModal.open(makeTracker(), container, {});

      const radios = container.querySelectorAll('input[name="checkMode"]');
      expect(radios.length).toBe(2);
      expect(Array.from(radios).map(r => r.value)).toEqual(['auto', 'pinTab']);
    });

    test('modal has notification filter select with all types', () => {
      SettingsModal.open(makeTracker(), container, {});

      const select = container.querySelector('[data-field="filterType"]');
      expect(select).not.toBeNull();
      expect(Array.from(select.options).map(o => o.value)).toEqual([
        'none', 'contains', 'greaterThan', 'lessThan', 'increased', 'decreased',
      ]);
    });

    test('modal has filter value input', () => {
      SettingsModal.open(makeTracker(), container, {});
      expect(container.querySelector('[data-field="filterValue"]')).not.toBeNull();
    });

    test('modal has save and delete buttons in footer', () => {
      SettingsModal.open(makeTracker(), container, {});

      const footer = container.querySelector('.modal-footer');
      expect(footer.querySelector('.btn-primary').textContent).toBe('Сохранить');
      expect(footer.querySelector('.btn-danger').textContent).toBe('Удалить');
    });
  });

  // ─── Pre-fills fields from tracker data ──────────────────────────

  describe('pre-fills fields from tracker data', () => {
    test('notifications toggle reflects notificationsEnabled=false', () => {
      SettingsModal.open(makeTracker({ notificationsEnabled: false }), container, {});
      expect(container.querySelector('[data-field="notificationsEnabled"]').checked).toBe(false);
    });

    test('notifications toggle reflects notificationsEnabled=true', () => {
      SettingsModal.open(makeTracker({ notificationsEnabled: true }), container, {});
      expect(container.querySelector('[data-field="notificationsEnabled"]').checked).toBe(true);
    });

    test('interval radio reflects checkIntervalHours', () => {
      SettingsModal.open(makeTracker({ checkIntervalHours: 24 }), container, {});
      expect(container.querySelector('input[name="checkInterval"]:checked').value).toBe('24');
    });

    test('product name input has tracker name', () => {
      SettingsModal.open(makeTracker({ productName: 'Widget Pro' }), container, {});
      expect(container.querySelector('[data-field="productName"]').value).toBe('Widget Pro');
    });

    test('image URL input has tracker imageUrl', () => {
      SettingsModal.open(makeTracker({ imageUrl: 'https://img.test/pic.jpg' }), container, {});
      expect(container.querySelector('[data-field="imageUrl"]').value).toBe('https://img.test/pic.jpg');
    });

    test('check mode radio reflects tracker checkMode', () => {
      SettingsModal.open(makeTracker({ checkMode: 'pinTab' }), container, {});
      expect(container.querySelector('input[name="checkMode"]:checked').value).toBe('pinTab');
    });

    test('notification filter type is pre-selected', () => {
      SettingsModal.open(
        makeTracker({ notificationFilter: { type: 'greaterThan', value: 50 } }),
        container, {}
      );
      expect(container.querySelector('[data-field="filterType"]').value).toBe('greaterThan');
    });

    test('notification filter value is pre-filled', () => {
      SettingsModal.open(
        makeTracker({ notificationFilter: { type: 'contains', value: 'sale' } }),
        container, {}
      );
      expect(container.querySelector('[data-field="filterValue"]').value).toBe('sale');
    });
  });

  // ─── Notifications toggle works ─────────────────────────────────

  describe('notifications toggle', () => {
    test('toggle can be switched', () => {
      SettingsModal.open(makeTracker({ notificationsEnabled: true }), container, {});
      const cb = container.querySelector('[data-field="notificationsEnabled"]');
      expect(cb.checked).toBe(true);
      cb.checked = false;
      expect(cb.checked).toBe(false);
    });
  });

  // ─── Interval radio buttons work ───────────────────────────────

  describe('interval radio buttons', () => {
    test('changing interval updates selected radio', () => {
      SettingsModal.open(makeTracker({ checkIntervalHours: 12 }), container, {});
      const radio6 = container.querySelector('input[name="checkInterval"][value="6"]');
      radio6.checked = true;
      radio6.dispatchEvent(new Event('change', { bubbles: true }));
      expect(container.querySelector('input[name="checkInterval"]:checked').value).toBe('6');
    });

    test('selected radio option gets "selected" class', () => {
      SettingsModal.open(makeTracker({ checkIntervalHours: 6 }), container, {});
      const opt = container.querySelector('input[name="checkInterval"][value="6"]').closest('.radio-option');
      expect(opt.classList.contains('selected')).toBe(true);
    });
  });

  // ─── Check mode selection (Req 19.1) ───────────────────────────

  describe('check mode selection', () => {
    test('defaults to "auto" when checkMode not set', () => {
      SettingsModal.open(makeTracker({ checkMode: undefined }), container, {});
      expect(container.querySelector('input[name="checkMode"]:checked').value).toBe('auto');
    });

    test('can select Pin Tab mode', () => {
      SettingsModal.open(makeTracker({ checkMode: 'auto' }), container, {});
      const pinTab = container.querySelector('input[name="checkMode"][value="pinTab"]');
      pinTab.checked = true;
      pinTab.dispatchEvent(new Event('change', { bubbles: true }));
      expect(container.querySelector('input[name="checkMode"]:checked').value).toBe('pinTab');
    });
  });

  // ─── Notification filter type and value (Req 16.1) ─────────────

  describe('notification filter', () => {
    test('filter value input is hidden when type is "none"', () => {
      SettingsModal.open(makeTracker(), container, {});
      expect(container.querySelector('[data-field="filterValue"]').style.display).toBe('none');
    });

    test('filter value input is visible when type is not "none"', () => {
      SettingsModal.open(
        makeTracker({ notificationFilter: { type: 'contains', value: 'test' } }),
        container, {}
      );
      expect(container.querySelector('[data-field="filterValue"]').style.display).not.toBe('none');
    });

    test('changing filter type toggles value input visibility', () => {
      SettingsModal.open(makeTracker(), container, {});
      const sel = container.querySelector('[data-field="filterType"]');
      const val = container.querySelector('[data-field="filterValue"]');

      expect(val.style.display).toBe('none');

      sel.value = 'contains';
      sel.dispatchEvent(new Event('change'));
      expect(val.style.display).not.toBe('none');

      sel.value = 'decreased';
      sel.dispatchEvent(new Event('change'));
      expect(val.style.display).toBe('none');

      sel.value = 'increased';
      sel.dispatchEvent(new Event('change'));
      expect(val.style.display).toBe('none');

      sel.value = 'greaterThan';
      sel.dispatchEvent(new Event('change'));
      expect(val.style.display).not.toBe('none');

      sel.value = 'none';
      sel.dispatchEvent(new Event('change'));
      expect(val.style.display).toBe('none');
    });
  });

  // ─── Save button sends updateTracker message (Req 6.4) ──────────

  describe('save button', () => {
    test('sends updateTracker message to service worker', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ tracker: makeTracker() });
      });

      SettingsModal.open(makeTracker({ id: 'save-test' }), container, { onSave: jest.fn() });
      container.querySelector('.btn-primary').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updateTracker',
          trackerId: 'save-test',
          data: expect.objectContaining({
            notificationsEnabled: expect.any(Boolean),
            checkIntervalHours: expect.any(Number),
            productName: expect.any(String),
          }),
        }),
        expect.any(Function)
      );
    });

    test('calls onSave callback with updated tracker', async () => {
      const updated = makeTracker({ id: 'save-cb', productName: 'Updated' });
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'updateTracker') {
          if (cb) cb({ tracker: updated });
        } else {
          if (cb) cb({});
        }
      });

      const onSave = jest.fn();
      SettingsModal.open(makeTracker({ id: 'save-cb' }), container, { onSave });
      container.querySelector('.btn-primary').click();
      await flushPromises();

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'save-cb' }));
    });

    test('closes modal after save', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ tracker: makeTracker() });
      });

      SettingsModal.open(makeTracker(), container, {});
      container.querySelector('.btn-primary').click();
      await flushPromises();

      expect(container.querySelector('.modal-overlay')).toBeNull();
    });

    test('collects correct form data on save', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ tracker: makeTracker() });
      });

      SettingsModal.open(makeTracker({ id: 'form-test', checkIntervalHours: 12 }), container, {});

      // Change product name
      container.querySelector('[data-field="productName"]').value = 'New Name';
      // Change interval to 6h
      container.querySelector('input[name="checkInterval"][value="6"]').checked = true;
      // Change check mode to pinTab
      container.querySelector('input[name="checkMode"][value="pinTab"]').checked = true;

      container.querySelector('.btn-primary').click();
      await flushPromises();

      const sentMsg = chrome.runtime.sendMessage.mock.calls.find(
        c => c[0] && c[0].action === 'updateTracker'
      );
      expect(sentMsg[0].data.productName).toBe('New Name');
      expect(sentMsg[0].data.checkIntervalHours).toBe(6);
      expect(sentMsg[0].data.checkMode).toBe('pinTab');
    });
  });

  // ─── Delete button with confirmation (Req 6.5, 6.6) ────────────

  describe('delete button', () => {
    test('shows confirm dialog on delete', () => {
      window.confirm = jest.fn(() => false);
      SettingsModal.open(makeTracker(), container, {});
      container.querySelector('.btn-danger').click();
      expect(window.confirm).toHaveBeenCalledTimes(1);
    });

    test('sends deleteTracker message when confirmed', async () => {
      window.confirm = jest.fn(() => true);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      SettingsModal.open(makeTracker({ id: 'del-confirm' }), container, { onDelete: jest.fn() });
      container.querySelector('.btn-danger').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deleteTracker', trackerId: 'del-confirm' }),
        expect.any(Function)
      );
    });

    test('calls onDelete callback with trackerId', async () => {
      window.confirm = jest.fn(() => true);
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      const onDelete = jest.fn();
      SettingsModal.open(makeTracker({ id: 'del-cb' }), container, { onDelete });
      container.querySelector('.btn-danger').click();
      await flushPromises();

      expect(onDelete).toHaveBeenCalledWith('del-cb');
    });

    test('does not delete when confirm is cancelled', async () => {
      window.confirm = jest.fn(() => false);
      SettingsModal.open(makeTracker({ id: 'del-cancel' }), container, {});
      container.querySelector('.btn-danger').click();
      await flushPromises();

      const deleteCalls = chrome.runtime.sendMessage.mock.calls.filter(
        c => c[0] && c[0].action === 'deleteTracker'
      );
      expect(deleteCalls.length).toBe(0);
    });
  });

  // ─── Close button removes modal ────────────────────────────────

  describe('close button', () => {
    test('close button removes modal from container', () => {
      SettingsModal.open(makeTracker(), container, {});
      expect(container.querySelector('.modal-overlay')).not.toBeNull();

      container.querySelector('.modal-header .btn-icon').click();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });

    test('clicking overlay background closes modal', () => {
      SettingsModal.open(makeTracker(), container, {});
      const overlay = container.querySelector('.modal-overlay');
      overlay.click();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });

    test('close() can be called directly', () => {
      SettingsModal.open(makeTracker(), container, {});
      SettingsModal.close();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });
  });

  // ─── Mark as read on open for "updated" status (Req 18.4) ──────

  describe('mark as read for updated trackers', () => {
    test('sends markAsRead when tracker status is "updated"', () => {
      SettingsModal.open(makeTracker({ id: 'read-test', status: 'updated' }), container, {});

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'markAsRead', trackerId: 'read-test' }),
        expect.any(Function)
      );
    });

    test('does not send markAsRead when tracker status is "active"', () => {
      SettingsModal.open(makeTracker({ status: 'active' }), container, {});

      const markCalls = chrome.runtime.sendMessage.mock.calls.filter(
        c => c[0] && c[0].action === 'markAsRead'
      );
      expect(markCalls.length).toBe(0);
    });

    test('does not send markAsRead when tracker status is "error"', () => {
      SettingsModal.open(makeTracker({ status: 'error' }), container, {});

      const markCalls = chrome.runtime.sendMessage.mock.calls.filter(
        c => c[0] && c[0].action === 'markAsRead'
      );
      expect(markCalls.length).toBe(0);
    });
  });

  // ─── Section dividers and icons (Req 9.1, 9.5) ─────────────────

  describe('section dividers and icons', () => {
    test('modal body contains section dividers between form groups', () => {
      SettingsModal.open(makeTracker(), container, {});
      const dividers = container.querySelectorAll('.modal-section-divider');
      expect(dividers.length).toBeGreaterThanOrEqual(3);
    });

    test('section dividers are <hr> elements', () => {
      SettingsModal.open(makeTracker(), container, {});
      const dividers = container.querySelectorAll('.modal-section-divider');
      dividers.forEach(d => {
        expect(d.tagName).toBe('HR');
      });
    });

    test('form group labels with icons contain SVG elements', () => {
      SettingsModal.open(makeTracker(), container, {});
      const labels = container.querySelectorAll('.form-group label');
      const labelsWithSvg = Array.from(labels).filter(l => l.querySelector('svg'));
      // At least notifications, refresh/interval, and link/image URL should have icons
      expect(labelsWithSvg.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Overlay gets active class ─────────────────────────────────

  describe('overlay activation', () => {
    test('overlay gets active class after open', () => {
      SettingsModal.open(makeTracker(), container, {});
      const overlay = container.querySelector('.modal-overlay');
      expect(overlay.classList.contains('active')).toBe(true);
    });
  });
});

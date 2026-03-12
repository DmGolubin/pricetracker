/**
 * Unit tests for GlobalSettings component (dashboard/components/globalSettings.js)
 *
 * Requirements: 10.1, 11.3, 19.4
 */

const GlobalSettings = require('../../dashboard/components/globalSettings');
const Icons = require('../../shared/icons');

// ─── Helpers ──────────────────────────────────────────────────────────

function makeSettings(overrides) {
  return Object.assign(
    {
      apiBaseUrl: 'https://api.example.com',
      telegramBotToken: 'bot123:ABC',
      telegramChatId: '987654',
      permanentPinTab: false,
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

describe('GlobalSettings', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
    chrome.runtime.lastError = null;
    // Make Icons available globally for globalSettings.js which checks typeof Icons
    global.Icons = Icons;
  });

  afterEach(() => {
    delete global.Icons;
  });

  // ─── open() loads settings and renders modal ───────────────────

  describe('open() loads settings and renders modal', () => {
    test('sends getSettings message on open', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'getSettings') {
          if (cb) cb({ settings: makeSettings() });
        }
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'getSettings' }),
        expect.any(Function)
      );
    });

    test('renders modal overlay and modal', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal-overlay')).not.toBeNull();
      expect(container.querySelector('.modal')).not.toBeNull();
    });

    test('overlay gets active class', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const overlay = container.querySelector('.modal-overlay');
      expect(overlay.classList.contains('active')).toBe(true);
    });

    test('modal header shows "Глобальные настройки"', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const header = container.querySelector('.modal-header h2');
      expect(header.textContent).toBe('Глобальные настройки');
    });

    test('modal has close button with SVG icon', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const closeBtn = container.querySelector('.modal-header .btn-icon');
      expect(closeBtn).not.toBeNull();
      const svg = closeBtn.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    test('modal has all four form fields', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="apiBaseUrl"]')).not.toBeNull();
      expect(container.querySelector('[data-field="telegramBotToken"]')).not.toBeNull();
      expect(container.querySelector('[data-field="telegramChatId"]')).not.toBeNull();
      expect(container.querySelector('[data-field="permanentPinTab"]')).not.toBeNull();
    });

    test('modal has save button in footer', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const footer = container.querySelector('.modal-footer');
      const saveBtn = footer.querySelector('.btn-primary');
      expect(saveBtn).not.toBeNull();
      expect(saveBtn.textContent).toBe('Сохранить');
    });
  });

  // ─── SVG icons and save animation (Req 10.1, 10.2, 10.3) ──────

  describe('SVG icons and save animation', () => {
    test('modal header contains settings SVG icon', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const titleWrap = container.querySelector('.modal-title-wrap');
      expect(titleWrap).not.toBeNull();
      const svg = titleWrap.querySelector('svg');
      expect(svg).not.toBeNull();
    });

    test('save button shows spinner during save', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'getSettings') {
          if (cb) cb({ settings: makeSettings() });
        }
        // Don't call cb for saveSettings to keep it in loading state
      });

      GlobalSettings.open(container);
      await flushPromises();

      container.querySelector('.btn-primary').click();
      // After click, button should show spinner
      const saveBtn = container.querySelector('.btn-primary');
      expect(saveBtn.disabled).toBe(true);
      expect(saveBtn.querySelector('.save-spinner')).not.toBeNull();
    });

    test('save button shows check icon on success', async () => {
      const originalReload = window.location.reload;
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: jest.fn() },
      });

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      container.querySelector('.btn-primary').click();
      await flushPromises();

      const saveBtn = container.querySelector('.btn-primary');
      // After successful save, button should show check icon
      const svg = saveBtn.querySelector('svg');
      expect(svg).not.toBeNull();

      // Wait for close timeout
      await new Promise(resolve => setTimeout(resolve, 700));

      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: originalReload },
      });
    });
  });

  // ─── Pre-fills fields from loaded settings ─────────────────────

  describe('pre-fills fields from loaded settings', () => {
    test('API Base URL is pre-filled', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ apiBaseUrl: 'https://my-api.test' }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="apiBaseUrl"]').value).toBe('https://my-api.test');
    });

    test('Telegram Bot Token is pre-filled', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ telegramBotToken: 'tok-xyz' }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="telegramBotToken"]').value).toBe('tok-xyz');
    });

    test('Telegram Chat ID is pre-filled', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ telegramChatId: '12345' }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="telegramChatId"]').value).toBe('12345');
    });

    test('Permanent Pin Tab toggle reflects true', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ permanentPinTab: true }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="permanentPinTab"]').checked).toBe(true);
    });

    test('Permanent Pin Tab toggle reflects false', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ permanentPinTab: false }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="permanentPinTab"]').checked).toBe(false);
    });
  });

  // ─── Save button sends saveSettings message ────────────────────

  describe('save button', () => {
    test('sends saveSettings message with correct data', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      // Modify fields
      container.querySelector('[data-field="apiBaseUrl"]').value = 'https://new-api.test';
      container.querySelector('[data-field="telegramBotToken"]').value = 'new-token';
      container.querySelector('[data-field="telegramChatId"]').value = '999';
      container.querySelector('[data-field="permanentPinTab"]').checked = true;

      // Reset mock to track save call
      chrome.runtime.sendMessage.mockClear();
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      container.querySelector('.btn-primary').click();
      await flushPromises();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'saveSettings',
          settings: expect.objectContaining({
            apiBaseUrl: 'https://new-api.test',
            telegramBotToken: 'new-token',
            telegramChatId: '999',
            permanentPinTab: true,
          }),
        }),
        expect.any(Function)
      );
    });

    test('closes modal on successful save', async () => {
      // Mock window.location.reload to prevent jsdom navigation error
      const originalReload = window.location.reload;
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: jest.fn() },
      });

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      container.querySelector('.btn-primary').click();
      await flushPromises();

      // Save shows check icon then closes after 600ms delay
      await new Promise(function (resolve) { setTimeout(resolve, 700); });

      expect(container.querySelector('.modal-overlay')).toBeNull();
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { reload: originalReload },
      });
    });
  });

  // ─── Close button removes modal ────────────────────────────────

  describe('close button', () => {
    test('close button removes modal from container', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal-overlay')).not.toBeNull();
      container.querySelector('.modal-header .btn-icon').click();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });

    test('clicking overlay background closes modal', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const overlay = container.querySelector('.modal-overlay');
      overlay.click();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });

    test('close() can be called directly', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      GlobalSettings.close();
      expect(container.querySelector('.modal-overlay')).toBeNull();
    });
  });

  // ─── Handles missing/empty settings gracefully ─────────────────

  describe('handles missing/empty settings', () => {
    test('renders with empty fields when settings are empty', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: {} });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="apiBaseUrl"]').value).toBe('');
      expect(container.querySelector('[data-field="telegramBotToken"]').value).toBe('');
      expect(container.querySelector('[data-field="telegramChatId"]').value).toBe('');
      expect(container.querySelector('[data-field="permanentPinTab"]').checked).toBe(false);
    });

    test('renders with empty fields when getSettings returns null response', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(null);
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal-overlay')).not.toBeNull();
      expect(container.querySelector('[data-field="apiBaseUrl"]').value).toBe('');
    });

    test('renders modal even when getSettings fails', async () => {
      chrome.runtime.lastError = { message: 'Connection error' };
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb(undefined);
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal-overlay')).not.toBeNull();
      expect(container.querySelector('[data-field="apiBaseUrl"]').value).toBe('');

      chrome.runtime.lastError = null;
    });
  });

  // ─── Permanent Pin Tab toggle works ────────────────────────────

  describe('permanent Pin Tab toggle', () => {
    test('toggle can be switched on', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ permanentPinTab: false }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const cb = container.querySelector('[data-field="permanentPinTab"]');
      expect(cb.checked).toBe(false);
      cb.checked = true;
      expect(cb.checked).toBe(true);
    });

    test('toggle can be switched off', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ permanentPinTab: true }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      const cb = container.querySelector('[data-field="permanentPinTab"]');
      expect(cb.checked).toBe(true);
      cb.checked = false;
      expect(cb.checked).toBe(false);
    });

    test('toggle state is included in save data', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings({ permanentPinTab: false }) });
      });

      GlobalSettings.open(container);
      await flushPromises();

      container.querySelector('[data-field="permanentPinTab"]').checked = true;

      chrome.runtime.sendMessage.mockClear();
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({});
      });

      container.querySelector('.btn-primary').click();
      await flushPromises();

      const saveCall = chrome.runtime.sendMessage.mock.calls.find(
        c => c[0] && c[0].action === 'saveSettings'
      );
      expect(saveCall[0].settings.permanentPinTab).toBe(true);
    });
  });

  // ─── Accessibility attributes ──────────────────────────────────

  describe('accessibility', () => {
    test('modal has role="dialog"', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal').getAttribute('role')).toBe('dialog');
    });

    test('modal has aria-label', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.modal').getAttribute('aria-label')).toBe('Глобальные настройки');
    });

    test('close button has aria-label', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.btn-icon').getAttribute('aria-label')).toBe('Закрыть');
    });

    test('all inputs have aria-label attributes', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('[data-field="apiBaseUrl"]').getAttribute('aria-label')).toBe('API Base URL');
      expect(container.querySelector('[data-field="telegramBotToken"]').getAttribute('aria-label')).toBe('Telegram Bot Token');
      expect(container.querySelector('[data-field="telegramChatId"]').getAttribute('aria-label')).toBe('Telegram Chat ID');
    });

    test('save button has aria-label', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (cb) cb({ settings: makeSettings() });
      });

      GlobalSettings.open(container);
      await flushPromises();

      expect(container.querySelector('.btn-primary').getAttribute('aria-label')).toBe('Сохранить настройки');
    });
  });
});

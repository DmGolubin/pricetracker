/**
 * Unit tests for Selector Picker content script.
 *
 * Since selectorPicker.js is a self-contained IIFE, we test it by
 * loading the script into jsdom and simulating user interactions.
 */
const fs = require('fs');
const path = require('path');

const PICKER_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '../../content/selectorPicker.js'),
  'utf-8'
);

function injectPicker() {
  // Reset state
  window.__ptPickerActive = false;
  eval(PICKER_SCRIPT);
}

function cleanupPicker() {
  // Trigger Escape to run the IIFE's internal cleanup (removes event listeners)
  if (window.__ptPickerActive) {
    const escEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escEvt);
  }
  // Remove any remaining picker elements
  document.querySelectorAll(
    '.pt-picker-overlay, .pt-picker-nav, .pt-picker-error, .pt-picker-form-overlay'
  ).forEach(el => el.remove());
  window.__ptPickerActive = false;
}

describe('SelectorPicker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    cleanupPicker();
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanupPicker();
  });

  describe('Initialization', () => {
    test('creates overlay element on init', () => {
      injectPicker();
      const overlay = document.querySelector('.pt-picker-overlay');
      expect(overlay).not.toBeNull();
    });

    test('sets __ptPickerActive flag', () => {
      injectPicker();
      expect(window.__ptPickerActive).toBe(true);
    });

    test('prevents double injection', () => {
      injectPicker();
      // Second call should be a no-op since __ptPickerActive is still true
      eval(PICKER_SCRIPT);
      const overlays = document.querySelectorAll('.pt-picker-overlay');
      expect(overlays.length).toBe(1);
    });
  });

  describe('Overlay highlighting', () => {
    test('overlay positions over hovered element', () => {
      document.body.innerHTML = '<div id="target" style="width:100px;height:50px;">Price</div>';
      injectPicker();

      const target = document.getElementById('target');
      const event = new MouseEvent('mousemove', { bubbles: true });
      target.dispatchEvent(event);

      const overlay = document.querySelector('.pt-picker-overlay');
      expect(overlay.style.display).not.toBe('none');
    });
  });

  describe('Element selection and nav panel', () => {
    test('clicking an element shows navigation panel', () => {
      document.body.innerHTML = '<div id="product"><span id="price">$19.99</span></div>';
      injectPicker();

      const priceEl = document.getElementById('price');
      priceEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      expect(nav).not.toBeNull();
      expect(nav.textContent).toContain('Внешний блок');
      expect(nav.textContent).toContain('Внутренний блок');
      expect(nav.textContent).toContain('Удалить внутренний');
      expect(nav.textContent).toContain('Подтвердить');
      expect(nav.textContent).toContain('Отмена');
    });
  });

  describe('Navigate Up (parent element)', () => {
    test('navigating up switches to parent element', () => {
      document.body.innerHTML = '<div id="parent"><span id="child">$10</span></div>';
      injectPicker();

      // Select child
      const child = document.getElementById('child');
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Click "↑ Внешний блок"
      const nav = document.querySelector('.pt-picker-nav');
      const upBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Внешний блок')
      );
      upBtn.click();

      // Overlay should now cover the parent
      const overlay = document.querySelector('.pt-picker-overlay');
      expect(overlay.style.display).not.toBe('none');
    });
  });

  describe('Confirmation form', () => {
    test('confirm button shows form with pre-filled fields', () => {
      document.body.innerHTML = '<div><span id="price-el">$29.99</span></div>';
      Object.defineProperty(document, 'title', { value: 'Test Product Page', writable: true, configurable: true });
      injectPicker();

      const priceEl = document.getElementById('price-el');
      priceEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      expect(nav).not.toBeNull();

      const confirmBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Подтвердить')
      );
      confirmBtn.click();

      const formOverlay = document.querySelector('.pt-picker-form-overlay');
      expect(formOverlay).not.toBeNull();

      const nameInput = document.getElementById('pt-field-name');
      expect(nameInput.value).toBe('Test Product Page');

      const urlInput = document.getElementById('pt-field-url');
      expect(urlInput.readOnly).toBe(true);

      const priceInput = document.getElementById('pt-field-price');
      expect(priceInput.value).toBe('29.99');
    });

    test('form has tracking type toggle with Цена and Контент', () => {
      document.body.innerHTML = '<span id="type-el">$5</span>';
      injectPicker();

      const el = document.getElementById('type-el');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      expect(nav).not.toBeNull();
      const confirmBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Подтвердить')
      );
      confirmBtn.click();

      const typeBtns = document.querySelectorAll('.pt-picker-type-btn');
      expect(typeBtns.length).toBe(2);
      expect(typeBtns[0].textContent).toBe('Цена');
      expect(typeBtns[1].textContent).toBe('Контент');
      expect(typeBtns[0].classList.contains('active')).toBe(true);
    });

    test('auto-selects content type when price cannot be parsed', () => {
      document.body.innerHTML = '<span id="no-price-el">Some text without price</span>';
      injectPicker();

      const el = document.getElementById('no-price-el');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      const confirmBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Подтвердить')
      );
      confirmBtn.click();

      const typeBtns = document.querySelectorAll('.pt-picker-type-btn');
      // Content button should be active since price couldn't be parsed
      expect(typeBtns[1].textContent).toBe('Контент');
      expect(typeBtns[1].classList.contains('active')).toBe(true);
      expect(typeBtns[0].classList.contains('active')).toBe(false);
    });
  });

  describe('Sending messages', () => {
    test('save button sends elementSelected message', () => {
      document.body.innerHTML = '<span id="save-el">$15.50</span>';
      injectPicker();

      const el = document.getElementById('save-el');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      expect(nav).not.toBeNull();
      const confirmBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Подтвердить')
      );
      confirmBtn.click();

      const saveBtn = document.querySelector('.pt-picker-btn-save');
      expect(saveBtn).not.toBeNull();
      saveBtn.click();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'elementSelected',
          price: 15.5,
          trackingType: 'price'
        })
      );
    });

    test('cancel sends pickerCancelled message', () => {
      injectPicker();

      // Press Escape
      const escEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escEvt);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'pickerCancelled' })
      );
    });
  });

  describe('Error handling', () => {
    test('shows error when price cannot be parsed but still shows form', () => {
      document.body.innerHTML = '<span id="no-price-el">No price here</span>';
      injectPicker();

      const el = document.getElementById('no-price-el');
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const nav = document.querySelector('.pt-picker-nav');
      const confirmBtn = Array.from(nav.querySelectorAll('button')).find(
        b => b.textContent.includes('Подтвердить')
      );
      confirmBtn.click();

      // Error should be shown
      const error = document.querySelector('.pt-picker-error');
      expect(error).not.toBeNull();
      expect(error.textContent).toContain('Не удалось распознать цену');

      // Form should still appear (user can switch to Content type)
      const formOverlay = document.querySelector('.pt-picker-form-overlay');
      expect(formOverlay).not.toBeNull();
    });
  });

  describe('Escape key cleanup', () => {
    test('Escape removes all picker elements', () => {
      document.body.innerHTML = '<span id="esc-el">$10</span>';
      injectPicker();

      const escEvt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escEvt);

      expect(document.querySelector('.pt-picker-overlay')).toBeNull();
      expect(document.querySelector('.pt-picker-nav')).toBeNull();
      expect(window.__ptPickerActive).toBe(false);
    });
  });
});

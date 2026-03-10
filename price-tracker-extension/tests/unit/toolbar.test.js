/**
 * Unit tests for Toolbar component (dashboard/components/toolbar.js)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

const Toolbar = require('../../dashboard/components/toolbar');

describe('Toolbar', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
  });

  // ─── Rendering ──────────────────────────────────────────────────

  describe('init renders all toolbar elements', () => {
    test('renders toolbar wrapper with correct class', () => {
      Toolbar.init(container, {});
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar).not.toBeNull();
    });

    test('renders refresh button with btn btn-primary classes', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn.btn-primary');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('Обновить все');
    });

    test('renders search input with input class', () => {
      Toolbar.init(container, {});
      const input = container.querySelector('input.input');
      expect(input).not.toBeNull();
      expect(input.type).toBe('text');
    });

    test('renders filter select with input class', () => {
      Toolbar.init(container, {});
      const select = container.querySelector('select.input');
      expect(select).not.toBeNull();
    });

    test('renders settings icon button with btn-icon class', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn-icon');
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe('⚙️');
    });
  });

  // ─── Search input ───────────────────────────────────────────────

  describe('search input', () => {
    test('has correct placeholder text', () => {
      Toolbar.init(container, {});
      const input = container.querySelector('input.input');
      expect(input.placeholder).toBe('Поиск по названию...');
    });

    test('triggers onSearch callback on input event', () => {
      const onSearch = jest.fn();
      Toolbar.init(container, { onSearch });

      const input = container.querySelector('input.input');
      input.value = 'test query';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith('test query');
    });

    test('triggers onSearch with empty string when cleared', () => {
      const onSearch = jest.fn();
      Toolbar.init(container, { onSearch });

      const input = container.querySelector('input.input');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onSearch).toHaveBeenCalledWith('');
    });
  });

  // ─── Filter select ─────────────────────────────────────────────

  describe('filter select', () => {
    test('has three options: all, down, up', () => {
      Toolbar.init(container, {});
      const select = container.querySelector('select.input');
      const options = select.querySelectorAll('option');

      expect(options).toHaveLength(3);
      expect(options[0].value).toBe('all');
      expect(options[0].textContent).toBe('Все');
      expect(options[1].value).toBe('down');
      expect(options[1].textContent).toBe('Цена снизилась');
      expect(options[2].value).toBe('up');
      expect(options[2].textContent).toBe('Цена выросла');
    });

    test('triggers onFilter callback on change event', () => {
      const onFilter = jest.fn();
      Toolbar.init(container, { onFilter });

      const select = container.querySelector('select.input');
      select.value = 'down';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilter).toHaveBeenCalledTimes(1);
      expect(onFilter).toHaveBeenCalledWith('down');
    });

    test('triggers onFilter with "up" value', () => {
      const onFilter = jest.fn();
      Toolbar.init(container, { onFilter });

      const select = container.querySelector('select.input');
      select.value = 'up';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      expect(onFilter).toHaveBeenCalledWith('up');
    });
  });

  // ─── Refresh button ────────────────────────────────────────────

  describe('refresh button', () => {
    test('triggers onRefreshAll callback on click', () => {
      const onRefreshAll = jest.fn();
      Toolbar.init(container, { onRefreshAll });

      const btn = container.querySelector('.btn.btn-primary');
      btn.click();

      expect(onRefreshAll).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Settings button ──────────────────────────────────────────

  describe('settings button', () => {
    test('triggers onSettingsClick callback on click', () => {
      const onSettingsClick = jest.fn();
      Toolbar.init(container, { onSettingsClick });

      const btn = container.querySelector('.btn-icon');
      btn.click();

      expect(onSettingsClick).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Accessibility ─────────────────────────────────────────────

  describe('accessibility', () => {
    test('toolbar has role="toolbar"', () => {
      Toolbar.init(container, {});
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar.getAttribute('role')).toBe('toolbar');
    });

    test('toolbar has aria-label', () => {
      Toolbar.init(container, {});
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar.getAttribute('aria-label')).toBeTruthy();
    });

    test('refresh button has aria-label', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn.btn-primary');
      expect(btn.getAttribute('aria-label')).toBe('Обновить все трекеры');
    });

    test('search input has aria-label', () => {
      Toolbar.init(container, {});
      const input = container.querySelector('input.input');
      expect(input.getAttribute('aria-label')).toBeTruthy();
    });

    test('filter select has aria-label', () => {
      Toolbar.init(container, {});
      const select = container.querySelector('select.input');
      expect(select.getAttribute('aria-label')).toBeTruthy();
    });

    test('settings button has aria-label', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn-icon');
      expect(btn.getAttribute('aria-label')).toBe('Открыть настройки');
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    test('does not throw when container is null', () => {
      expect(() => Toolbar.init(null, {})).not.toThrow();
    });

    test('does not throw when callbacks are missing', () => {
      expect(() => Toolbar.init(container)).not.toThrow();
    });

    test('does not throw when callback functions are undefined', () => {
      Toolbar.init(container, {});
      const input = container.querySelector('input.input');
      const select = container.querySelector('select.input');
      const refreshBtn = container.querySelector('.btn.btn-primary');
      const settingsBtn = container.querySelector('.btn-icon');

      expect(() => {
        input.dispatchEvent(new Event('input'));
        select.dispatchEvent(new Event('change'));
        refreshBtn.click();
        settingsBtn.click();
      }).not.toThrow();
    });
  });
});

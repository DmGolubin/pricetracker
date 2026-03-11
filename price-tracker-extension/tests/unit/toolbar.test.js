/**
 * Unit tests for Toolbar component (dashboard/components/toolbar.js)
 *
 * Requirements: 2.4, 2.8, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
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
      expect(btn.textContent).toContain('Обновить все');
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

    test('renders settings icon button with btn-icon class and SVG icon', () => {
      Toolbar.init(container, {});
      const btns = container.querySelectorAll('.toolbar-group-right .btn-icon');
      const settingsBtn = btns[btns.length - 1];
      expect(settingsBtn).not.toBeNull();
      const svg = settingsBtn.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });

  // ─── SVG Icons ──────────────────────────────────────────────────

  describe('SVG icons', () => {
    test('refresh button contains SVG refresh icon', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn.btn-primary');
      const svg = btn.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });

    test('settings button contains SVG settings icon', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn-icon');
      const svg = btn.querySelector('svg');
      expect(svg).not.toBeNull();
    });

    test('search wrapper contains SVG search icon', () => {
      Toolbar.init(container, {});
      const searchIcon = container.querySelector('.toolbar-search-icon');
      expect(searchIcon).not.toBeNull();
      const svg = searchIcon.querySelector('svg');
      expect(svg).not.toBeNull();
    });
  });

  // ─── Layout Groups ─────────────────────────────────────────────

  describe('toolbar layout groups', () => {
    test('has left group with refresh button', () => {
      Toolbar.init(container, {});
      const leftGroup = container.querySelector('.toolbar-group-left');
      expect(leftGroup).not.toBeNull();
      expect(leftGroup.querySelector('.btn.btn-primary')).not.toBeNull();
    });

    test('has center group with search and filter', () => {
      Toolbar.init(container, {});
      const centerGroup = container.querySelector('.toolbar-group-center');
      expect(centerGroup).not.toBeNull();
      expect(centerGroup.querySelector('.toolbar-search-wrapper')).not.toBeNull();
      expect(centerGroup.querySelector('select.input')).not.toBeNull();
    });

    test('has right group with settings button', () => {
      Toolbar.init(container, {});
      const rightGroup = container.querySelector('.toolbar-group-right');
      expect(rightGroup).not.toBeNull();
      expect(rightGroup.querySelector('.btn-icon')).not.toBeNull();
    });

    test('has right group with export, import, select, and settings buttons', () => {
      Toolbar.init(container, {});
      const rightGroup = container.querySelector('.toolbar-group-right');
      const btns = rightGroup.querySelectorAll('.btn-icon');
      expect(btns.length).toBe(4);
      expect(btns[0].getAttribute('aria-label')).toBe('Экспорт трекеров');
      expect(btns[1].getAttribute('aria-label')).toBe('Импорт трекеров');
      expect(btns[2].getAttribute('aria-label')).toBe('Выбрать трекеры');
      expect(btns[3].getAttribute('aria-label')).toBe('Открыть настройки');
    });

    test('has dividers between groups', () => {
      Toolbar.init(container, {});
      const dividers = container.querySelectorAll('.toolbar-divider');
      expect(dividers.length).toBe(2);
    });
  });

  // ─── Search input ───────────────────────────────────────────────

  describe('search input', () => {
    test('has correct placeholder text', () => {
      Toolbar.init(container, {});
      const input = container.querySelector('input.input');
      expect(input.placeholder).toBe('Поиск по названию...');
    });

    test('is wrapped in search wrapper with icon', () => {
      Toolbar.init(container, {});
      const wrapper = container.querySelector('.toolbar-search-wrapper');
      expect(wrapper).not.toBeNull();
      expect(wrapper.querySelector('input.input')).not.toBeNull();
      expect(wrapper.querySelector('.toolbar-search-icon')).not.toBeNull();
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
    test('has four options: all, down, up, groups', () => {
      Toolbar.init(container, {});
      const select = container.querySelector('select.input');
      const options = select.querySelectorAll('option');

      expect(options).toHaveLength(4);
      expect(options[0].value).toBe('all');
      expect(options[0].textContent).toBe('Все');
      expect(options[1].value).toBe('down');
      expect(options[1].textContent).toBe('Цена снизилась');
      expect(options[2].value).toBe('up');
      expect(options[2].textContent).toBe('Цена выросла');
      expect(options[3].value).toBe('groups');
      expect(options[3].textContent).toBe('Группы товаров');
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

    test('adds toolbar-refresh-spin class to SVG on click', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn.btn-primary');
      const svg = btn.querySelector('svg');

      btn.click();

      expect(svg.classList.contains('toolbar-refresh-spin')).toBe(true);
    });

    test('removes toolbar-refresh-spin class after animationend', () => {
      Toolbar.init(container, {});
      const btn = container.querySelector('.btn.btn-primary');
      const svg = btn.querySelector('svg');

      btn.click();
      expect(svg.classList.contains('toolbar-refresh-spin')).toBe(true);

      svg.dispatchEvent(new Event('animationend'));
      expect(svg.classList.contains('toolbar-refresh-spin')).toBe(false);
    });
  });

  // ─── Settings button ──────────────────────────────────────────

  describe('settings button', () => {
    test('triggers onSettingsClick callback on click', () => {
      const onSettingsClick = jest.fn();
      Toolbar.init(container, { onSettingsClick });

      const btns = container.querySelectorAll('.toolbar-group-right .btn-icon');
      const settingsBtn = btns[btns.length - 1]; // settings is last
      settingsBtn.click();

      expect(onSettingsClick).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Export / Import buttons ──────────────────────────────────

  describe('export and import buttons', () => {
    test('triggers onExport callback on click', () => {
      const onExport = jest.fn();
      Toolbar.init(container, { onExport });

      const btns = container.querySelectorAll('.toolbar-group-right .btn-icon');
      btns[0].click();

      expect(onExport).toHaveBeenCalledTimes(1);
    });

    test('triggers onImport callback on click', () => {
      const onImport = jest.fn();
      Toolbar.init(container, { onImport });

      const btns = container.querySelectorAll('.toolbar-group-right .btn-icon');
      btns[1].click();

      expect(onImport).toHaveBeenCalledTimes(1);
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
      const btns = container.querySelectorAll('.toolbar-group-right .btn-icon');
      const settingsBtn = btns[btns.length - 1];
      expect(settingsBtn.getAttribute('aria-label')).toBe('Открыть настройки');
    });

    test('search icon is aria-hidden', () => {
      Toolbar.init(container, {});
      const searchIcon = container.querySelector('.toolbar-search-icon');
      expect(searchIcon.getAttribute('aria-hidden')).toBe('true');
    });

    test('dividers are aria-hidden', () => {
      Toolbar.init(container, {});
      const dividers = container.querySelectorAll('.toolbar-divider');
      dividers.forEach(d => {
        expect(d.getAttribute('aria-hidden')).toBe('true');
      });
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

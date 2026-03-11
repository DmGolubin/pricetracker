/**
 * Unit tests for Icons module (shared/icons.js)
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

const Icons = require('../../shared/icons');

describe('Icons module', () => {
  // ─── Icons.get() ──────────────────────────────────────────────────

  describe('get()', () => {
    test('returns SVG string for known icon name', () => {
      const svg = Icons.get('settings');
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });

    test('SVG has viewBox="0 0 24 24"', () => {
      const svg = Icons.get('settings');
      expect(svg).toContain('viewBox="0 0 24 24"');
    });

    test('SVG has fill="none"', () => {
      const svg = Icons.get('close');
      expect(svg).toContain('fill="none"');
    });

    test('SVG has stroke="currentColor"', () => {
      const svg = Icons.get('refresh');
      expect(svg).toContain('stroke="currentColor"');
    });

    test('SVG has aria-hidden="true"', () => {
      const svg = Icons.get('search');
      expect(svg).toContain('aria-hidden="true"');
    });

    test('returns empty string for unknown icon name', () => {
      expect(Icons.get('nonexistent')).toBe('');
      expect(Icons.get('does-not-exist')).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(Icons.get(null)).toBe('');
      expect(Icons.get(undefined)).toBe('');
    });

    test.each([
      'logo', 'package', 'settings', 'close', 'warning', 'refresh',
      'search', 'filter', 'delete', 'save', 'chart',
      'arrow-up', 'arrow-down', 'arrow-neutral',
      'auto-detect', 'notifications', 'link',
      'chevron-up', 'chevron-down', 'check', 'plus', 'minus',
    ])('returns valid SVG for icon "%s"', (name) => {
      const svg = Icons.get(name);
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  });

  // ─── Icons.el() ──────────────────────────────────────────────────

  describe('el()', () => {
    test('returns SVG string with default size 24', () => {
      const svg = Icons.el('settings');
      expect(svg).toContain('width="24"');
      expect(svg).toContain('height="24"');
    });

    test('returns SVG string with custom size', () => {
      const svg = Icons.el('close', 16);
      expect(svg).toContain('width="16"');
      expect(svg).toContain('height="16"');
    });

    test('returns SVG with viewBox and aria-hidden', () => {
      const svg = Icons.el('refresh', 20);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('aria-hidden="true"');
    });

    test('returns empty string for unknown icon name', () => {
      expect(Icons.el('nonexistent')).toBe('');
      expect(Icons.el('nonexistent', 16)).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(Icons.el(null)).toBe('');
      expect(Icons.el(undefined, 20)).toBe('');
    });
  });

  // ─── DOM rendering ────────────────────────────────────────────────

  describe('DOM rendering', () => {
    test('get() output can be parsed as valid SVG in DOM', () => {
      const div = document.createElement('div');
      div.innerHTML = Icons.get('settings');
      const svg = div.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    test('el() output renders SVG with correct dimensions in DOM', () => {
      const div = document.createElement('div');
      div.innerHTML = Icons.el('arrow-up', 18);
      const svg = div.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('width')).toBe('18');
      expect(svg.getAttribute('height')).toBe('18');
    });
  });
});

/**
 * Unit tests for content/selectorGenerator.js
 */
const { generateSelector } = require('../../content/selectorGenerator');

/**
 * Helper: create a DOM tree from an HTML string and return the document body.
 */
function setupDOM(html) {
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('generateSelector', () => {
  // --- Element with id ---
  describe('element with id', () => {
    test('returns #id selector for element with unique id', () => {
      setupDOM('<div id="price">$99.99</div>');
      const el = document.getElementById('price');
      const selector = generateSelector(el);
      expect(selector).toBe('#price');
      expect(document.querySelector(selector)).toBe(el);
    });

    test('returns #id with special characters escaped', () => {
      setupDOM('<div id="price-box.main">$99.99</div>');
      const el = document.getElementById('price-box.main');
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
    });
  });

  // --- Element with unique data-* attribute ---
  describe('element with unique data attribute', () => {
    test('returns [data-*] selector for element with unique data attribute', () => {
      setupDOM('<div><span data-testid="product-price">$49.99</span></div>');
      const el = document.querySelector('[data-testid="product-price"]');
      const selector = generateSelector(el);
      expect(selector).toBe('[data-testid="product-price"]');
      expect(document.querySelector(selector)).toBe(el);
    });

    test('skips non-unique data attribute and falls back', () => {
      setupDOM(
        '<div>' +
          '<span data-type="price">$10</span>' +
          '<span data-type="price">$20</span>' +
        '</div>'
      );
      const el = document.querySelectorAll('[data-type="price"]')[1];
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
    });
  });

  // --- Element needing nth-child ---
  describe('element needing nth-child', () => {
    test('generates nth-child selector for element without id or data attrs', () => {
      setupDOM(
        '<ul>' +
          '<li>Item 1</li>' +
          '<li>Item 2</li>' +
          '<li>Item 3</li>' +
        '</ul>'
      );
      const el = document.querySelectorAll('li')[1]; // second li
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
    });

    test('generates selector for deeply nested element', () => {
      setupDOM(
        '<div>' +
          '<div>' +
            '<span>A</span>' +
            '<span>B</span>' +
          '</div>' +
          '<div>' +
            '<span>C</span>' +
            '<span>D</span>' +
          '</div>' +
        '</div>'
      );
      const el = document.querySelectorAll('span')[3]; // "D"
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
      expect(el.textContent).toBe('D');
    });
  });

  // --- Nested elements requiring parent traversal ---
  describe('nested elements requiring parent traversal', () => {
    test('climbs DOM tree to build unique selector', () => {
      setupDOM(
        '<div id="container">' +
          '<div class="row">' +
            '<p>First</p>' +
            '<p>Second</p>' +
          '</div>' +
          '<div class="row">' +
            '<p>Third</p>' +
            '<p>Fourth</p>' +
          '</div>' +
        '</div>'
      );
      const el = document.querySelectorAll('p')[2]; // "Third"
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
      expect(el.textContent).toBe('Third');
    });

    test('uses ancestor id to shorten selector path', () => {
      setupDOM(
        '<div id="wrapper">' +
          '<div>' +
            '<span>Target</span>' +
          '</div>' +
        '</div>'
      );
      const el = document.querySelector('span');
      const selector = generateSelector(el);
      expect(selector).not.toBeNull();
      expect(document.querySelector(selector)).toBe(el);
      // Should leverage the #wrapper id in the path
    });
  });

  // --- Validation: generated selector resolves to original element ---
  describe('validation', () => {
    test('generated selector always resolves to the original element', () => {
      setupDOM(
        '<table>' +
          '<tr><td>A1</td><td>A2</td></tr>' +
          '<tr><td>B1</td><td>B2</td></tr>' +
        '</table>'
      );
      const cells = document.querySelectorAll('td');
      cells.forEach((cell) => {
        const selector = generateSelector(cell);
        expect(selector).not.toBeNull();
        expect(document.querySelector(selector)).toBe(cell);
      });
    });

    test('returns null for null input', () => {
      expect(generateSelector(null)).toBeNull();
    });

    test('returns null for document.body', () => {
      expect(generateSelector(document.body)).toBeNull();
    });

    test('returns null for document.documentElement', () => {
      expect(generateSelector(document.documentElement)).toBeNull();
    });
  });
});

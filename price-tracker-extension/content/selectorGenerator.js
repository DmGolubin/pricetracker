/**
 * CSS Selector Generator
 *
 * Generates a unique CSS selector for a given DOM element.
 * Priority: #id → [data-*] unique attributes → tag + :nth-child (climbing DOM tree)
 * Validates that document.querySelector(selector) returns exactly the target element.
 *
 * @module content/selectorGenerator
 */

/**
 * Escape a string for use in a CSS selector.
 * Uses CSS.escape when available, otherwise a simple fallback.
 * @param {string} str
 * @returns {string}
 */
function cssEscape(str) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(str);
  }
  return str.replace(/([^\w-])/g, '\\$1');
}

/**
 * Generate a unique CSS selector for the given DOM element.
 * @param {Element} element - The target DOM element
 * @returns {string|null} A unique CSS selector string, or null if element is invalid
 */
function generateSelector(element) {
  if (!element || !(element instanceof Element)) return null;
  if (element === document.documentElement || element === document.body) return null;

  // Strategy 1: element has an id
  const idSelector = getIdSelector(element);
  if (idSelector && isUnique(idSelector, element)) return idSelector;

  // Strategy 2: unique data-* attribute
  const dataSelector = getDataAttrSelector(element);
  if (dataSelector && isUnique(dataSelector, element)) return dataSelector;

  // Strategy 3: build path climbing up the DOM tree
  const pathSelector = buildPathSelector(element);
  if (pathSelector && isUnique(pathSelector, element)) return pathSelector;

  return null;
}

/**
 * @param {Element} element
 * @returns {string|null}
 */
function getIdSelector(element) {
  if (element.id) {
    return '#' + cssEscape(element.id);
  }
  return null;
}

/**
 * @param {Element} element
 * @returns {string|null}
 */
function getDataAttrSelector(element) {
  const attrs = element.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr.name.startsWith('data-')) {
      const selector = '[' + cssEscape(attr.name) + '="' + cssEscape(attr.value) + '"]';
      if (isUnique(selector, element)) return selector;
    }
  }
  return null;
}

/**
 * Build a selector path climbing up the DOM tree using tag:nth-child.
 * @param {Element} element
 * @returns {string|null}
 */
function buildPathSelector(element) {
  const parts = [];
  let current = element;

  while (current && current !== document.documentElement && current !== document.body) {
    parts.unshift(getElementPart(current));
    const candidate = parts.join(' > ');
    if (isUnique(candidate, element)) return candidate;
    current = current.parentElement;
  }

  // Final attempt with accumulated parts
  if (parts.length > 0) {
    const candidate = parts.join(' > ');
    if (isUnique(candidate, element)) return candidate;
  }

  return null;
}

/**
 * Get a tag:nth-child descriptor for a single element.
 * Uses id if available for a shorter path.
 * @param {Element} element
 * @returns {string}
 */
function getElementPart(element) {
  if (element.id) return '#' + cssEscape(element.id);

  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;

  const index = Array.from(parent.children).indexOf(element) + 1;
  return tag + ':nth-child(' + index + ')';
}

/**
 * Check if a selector uniquely identifies the target element.
 * @param {string} selector
 * @param {Element} target
 * @returns {boolean}
 */
function isUnique(selector, target) {
  try {
    return document.querySelector(selector) === target;
  } catch (e) {
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateSelector };
}

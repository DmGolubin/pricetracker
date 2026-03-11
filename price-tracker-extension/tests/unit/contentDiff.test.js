/**
 * Unit tests for ContentDiff component (dashboard/components/contentDiff.js)
 *
 * Requirements: 15.3
 */

const ContentDiff = require('../../dashboard/components/contentDiff');
const Icons = require('../../shared/icons');

// ─── Helpers ──────────────────────────────────────────────────────────

function createContainer() {
  var c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

// ─── computeDiff() ────────────────────────────────────────────────────

describe('ContentDiff.computeDiff', () => {

  test('identical texts produce only equal operations', () => {
    var ops = ContentDiff.computeDiff('hello world', 'hello world');
    expect(ops).toEqual([
      { type: 'equal', value: 'hello' },
      { type: 'equal', value: 'world' },
    ]);
  });

  test('completely different texts produce removed + added operations', () => {
    var ops = ContentDiff.computeDiff('old text', 'new content');
    var types = ops.map(function (o) { return o.type; });
    // All old words removed, all new words added
    expect(types).toContain('removed');
    expect(types).toContain('added');
    // Values should include all words
    var values = ops.map(function (o) { return o.value; });
    expect(values).toContain('old');
    expect(values).toContain('text');
    expect(values).toContain('new');
    expect(values).toContain('content');
  });

  test('partial changes produce mixed operations', () => {
    var ops = ContentDiff.computeDiff('the quick brown fox', 'the slow brown cat');
    // "the" and "brown" are equal; "quick" removed, "slow" added; "fox" removed, "cat" added
    var equal = ops.filter(function (o) { return o.type === 'equal'; });
    var removed = ops.filter(function (o) { return o.type === 'removed'; });
    var added = ops.filter(function (o) { return o.type === 'added'; });

    expect(equal.map(function (o) { return o.value; })).toContain('the');
    expect(equal.map(function (o) { return o.value; })).toContain('brown');
    expect(removed.map(function (o) { return o.value; })).toContain('quick');
    expect(removed.map(function (o) { return o.value; })).toContain('fox');
    expect(added.map(function (o) { return o.value; })).toContain('slow');
    expect(added.map(function (o) { return o.value; })).toContain('cat');
  });

  test('empty old text produces all added operations', () => {
    var ops = ContentDiff.computeDiff('', 'hello world');
    expect(ops).toEqual([
      { type: 'added', value: 'hello' },
      { type: 'added', value: 'world' },
    ]);
  });

  test('empty new text produces all removed operations', () => {
    var ops = ContentDiff.computeDiff('hello world', '');
    expect(ops).toEqual([
      { type: 'removed', value: 'hello' },
      { type: 'removed', value: 'world' },
    ]);
  });

  test('both empty texts produce empty array', () => {
    var ops = ContentDiff.computeDiff('', '');
    expect(ops).toEqual([]);
  });

  test('single word unchanged', () => {
    var ops = ContentDiff.computeDiff('hello', 'hello');
    expect(ops).toEqual([{ type: 'equal', value: 'hello' }]);
  });

  test('single word changed', () => {
    var ops = ContentDiff.computeDiff('hello', 'world');
    expect(ops).toEqual([
      { type: 'removed', value: 'hello' },
      { type: 'added', value: 'world' },
    ]);
  });

  test('handles extra whitespace in input', () => {
    var ops = ContentDiff.computeDiff('  hello   world  ', '  hello   world  ');
    expect(ops).toEqual([
      { type: 'equal', value: 'hello' },
      { type: 'equal', value: 'world' },
    ]);
  });

  test('word added at the end', () => {
    var ops = ContentDiff.computeDiff('hello', 'hello world');
    expect(ops).toEqual([
      { type: 'equal', value: 'hello' },
      { type: 'added', value: 'world' },
    ]);
  });

  test('word removed from the end', () => {
    var ops = ContentDiff.computeDiff('hello world', 'hello');
    expect(ops).toEqual([
      { type: 'equal', value: 'hello' },
      { type: 'removed', value: 'world' },
    ]);
  });

  test('null/undefined inputs treated as empty', () => {
    var ops1 = ContentDiff.computeDiff(null, 'hello');
    expect(ops1).toEqual([{ type: 'added', value: 'hello' }]);

    var ops2 = ContentDiff.computeDiff('hello', undefined);
    expect(ops2).toEqual([{ type: 'removed', value: 'hello' }]);
  });
});

// ─── render() ─────────────────────────────────────────────────────────

describe('ContentDiff.render', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
  });

  test('renders diff with correct CSS classes for removed and added words', () => {
    var record = {
      previousContent: 'old price',
      content: 'new price',
    };

    ContentDiff.render(record, container);

    var removed = container.querySelectorAll('[data-testid="diff-removed"]');
    var added = container.querySelectorAll('[data-testid="diff-added"]');
    var equal = container.querySelectorAll('[data-testid="diff-equal"]');

    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
    expect(equal.length).toBeGreaterThan(0); // "price" is equal

    // Check CSS classes
    expect(removed[0].classList.contains('diff-removed')).toBe(true);
    expect(added[0].classList.contains('diff-added')).toBe(true);
  });

  test('renders only current content when no previousContent', () => {
    var record = {
      content: 'В наличии',
    };

    ContentDiff.render(record, container);

    var textEl = container.querySelector('[data-testid="content-diff-text"]');
    expect(textEl).not.toBeNull();
    expect(textEl.textContent).toBe('В наличии');

    // No diff elements
    expect(container.querySelector('[data-testid="diff-removed"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-added"]')).toBeNull();
  });

  test('renders nothing when no content at all', () => {
    var record = {};

    ContentDiff.render(record, container);

    expect(container.innerHTML).toBe('');
  });

  test('handles empty string previousContent and non-empty content', () => {
    var record = {
      previousContent: '',
      content: 'hello world',
    };

    ContentDiff.render(record, container);

    // Empty previousContent is falsy, so should show content as-is
    var textEl = container.querySelector('[data-testid="content-diff-text"]');
    expect(textEl).not.toBeNull();
    expect(textEl.textContent).toBe('hello world');
  });

  test('uses currentContent field as fallback for content', () => {
    var record = {
      previousContent: 'old text',
      currentContent: 'new text',
    };

    ContentDiff.render(record, container);

    var removed = container.querySelectorAll('[data-testid="diff-removed"]');
    var added = container.querySelectorAll('[data-testid="diff-added"]');
    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
  });

  test('content field takes priority over currentContent', () => {
    var record = {
      previousContent: 'hello',
      content: 'world',
      currentContent: 'ignored',
    };

    ContentDiff.render(record, container);

    var wrapper = container.querySelector('[data-testid="content-diff"]');
    expect(wrapper.textContent).toContain('world');
    expect(wrapper.textContent).not.toContain('ignored');
  });

  test('renders identical content as all equal spans', () => {
    var record = {
      previousContent: 'same text here',
      content: 'same text here',
    };

    ContentDiff.render(record, container);

    expect(container.querySelector('[data-testid="diff-removed"]')).toBeNull();
    expect(container.querySelector('[data-testid="diff-added"]')).toBeNull();

    var equalSpans = container.querySelectorAll('[data-testid="diff-equal"]');
    expect(equalSpans.length).toBe(3);
  });

  test('does nothing when record is null', () => {
    ContentDiff.render(null, container);
    expect(container.innerHTML).toBe('');
  });

  test('does nothing when container is null', () => {
    // Should not throw
    expect(() => ContentDiff.render({ content: 'test' }, null)).not.toThrow();
  });

  test('renders wrapper with content-diff class', () => {
    var record = {
      previousContent: 'a',
      content: 'b',
    };

    ContentDiff.render(record, container);

    var wrapper = container.querySelector('.content-diff');
    expect(wrapper).not.toBeNull();
  });
});

// ─── Icons +/− in diff blocks ─────────────────────────────────────────

describe('ContentDiff.render with Icons', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    global.Icons = Icons;
  });

  afterEach(() => {
    delete global.Icons;
  });

  test('added blocks contain plus SVG icon when Icons is available', () => {
    var record = {
      previousContent: 'hello',
      content: 'hello world',
    };

    ContentDiff.render(record, container);

    var added = container.querySelector('[data-testid="diff-added"]');
    expect(added).not.toBeNull();
    var svg = added.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  test('removed blocks contain minus SVG icon when Icons is available', () => {
    var record = {
      previousContent: 'hello world',
      content: 'hello',
    };

    ContentDiff.render(record, container);

    var removed = container.querySelector('[data-testid="diff-removed"]');
    expect(removed).not.toBeNull();
    var svg = removed.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  test('equal blocks do not contain SVG icons', () => {
    var record = {
      previousContent: 'same text',
      content: 'same text',
    };

    ContentDiff.render(record, container);

    var equal = container.querySelector('[data-testid="diff-equal"]');
    expect(equal).not.toBeNull();
    expect(equal.querySelector('svg')).toBeNull();
  });
});

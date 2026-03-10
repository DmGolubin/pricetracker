/**
 * Content Diff component for Price Tracker Extension dashboard.
 *
 * Visualises changes between previous and current content:
 * - Removed words are rendered with the `diff-removed` CSS class (red, line-through)
 * - Added words are rendered with the `diff-added` CSS class (green)
 * - Unchanged words are rendered as plain text
 *
 * Uses a simple word-level LCS (Longest Common Subsequence) diff algorithm.
 *
 * Usage: ContentDiff.render(record, container)
 *        ContentDiff.computeDiff(oldText, newText)
 *
 * Requirements: 15.3
 */

const ContentDiff = (function () {

  // ─── LCS-based word diff ──────────────────────────────────────────

  /**
   * Compute the Longest Common Subsequence table for two arrays of words.
   * Returns a 2D array where lcs[i][j] = length of LCS of oldWords[0..i-1] and newWords[0..j-1].
   */
  function buildLCSTable(oldWords, newWords) {
    var m = oldWords.length;
    var n = newWords.length;
    var table = [];
    for (var i = 0; i <= m; i++) {
      table[i] = [];
      for (var j = 0; j <= n; j++) {
        if (i === 0 || j === 0) {
          table[i][j] = 0;
        } else if (oldWords[i - 1] === newWords[j - 1]) {
          table[i][j] = table[i - 1][j - 1] + 1;
        } else {
          table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
        }
      }
    }
    return table;
  }

  /**
   * Backtrack through the LCS table to produce diff operations.
   * Returns an array of { type: 'equal'|'added'|'removed', value: string }.
   */
  function backtrack(table, oldWords, newWords, i, j) {
    var ops = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
        ops.push({ type: 'equal', value: oldWords[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
        ops.push({ type: 'added', value: newWords[j - 1] });
        j--;
      } else {
        ops.push({ type: 'removed', value: oldWords[i - 1] });
        i--;
      }
    }

    ops.reverse();
    return ops;
  }

  /**
   * Split text into words by whitespace. Returns an array of non-empty strings.
   */
  function splitWords(text) {
    if (!text) return [];
    return text.split(/\s+/).filter(function (w) { return w.length > 0; });
  }

  /**
   * Compute a word-level diff between oldText and newText.
   *
   * @param {string} oldText - The previous content.
   * @param {string} newText - The current content.
   * @returns {Array<{type: string, value: string}>} Array of diff operations.
   */
  function computeDiff(oldText, newText) {
    var oldWords = splitWords(oldText);
    var newWords = splitWords(newText);

    if (oldWords.length === 0 && newWords.length === 0) {
      return [];
    }

    if (oldWords.length === 0) {
      return newWords.map(function (w) { return { type: 'added', value: w }; });
    }

    if (newWords.length === 0) {
      return oldWords.map(function (w) { return { type: 'removed', value: w }; });
    }

    var table = buildLCSTable(oldWords, newWords);
    return backtrack(table, oldWords, newWords, oldWords.length, newWords.length);
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /**
   * Render a content diff into the given container element.
   *
   * @param {Object} record - A record object with optional `previousContent` and
   *   `content` (or `currentContent`) fields.
   * @param {HTMLElement} container - The DOM element to render into.
   */
  function render(record, container) {
    if (!record || !container) return;

    var currentContent = record.content != null ? record.content : (record.currentContent || '');
    var previousContent = record.previousContent || '';

    // Nothing to show
    if (!currentContent && !previousContent) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'content-diff';
    wrapper.setAttribute('data-testid', 'content-diff');

    // If no previous content, just show current as-is
    if (!previousContent) {
      var span = document.createElement('span');
      span.setAttribute('data-testid', 'content-diff-text');
      span.textContent = currentContent;
      wrapper.appendChild(span);
      container.appendChild(wrapper);
      return;
    }

    // Compute and render diff
    var ops = computeDiff(previousContent, currentContent);

    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      var el = document.createElement('span');

      if (op.type === 'removed') {
        el.className = 'diff-removed';
        el.setAttribute('data-testid', 'diff-removed');
      } else if (op.type === 'added') {
        el.className = 'diff-added';
        el.setAttribute('data-testid', 'diff-added');
      } else {
        el.setAttribute('data-testid', 'diff-equal');
      }

      el.textContent = op.value;
      wrapper.appendChild(el);

      // Add space between words (except after the last one)
      if (i < ops.length - 1) {
        wrapper.appendChild(document.createTextNode(' '));
      }
    }

    container.appendChild(wrapper);
  }

  return {
    render: render,
    computeDiff: computeDiff,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentDiff;
}

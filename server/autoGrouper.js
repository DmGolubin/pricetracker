/**
 * Auto-Grouper — server-side module for automatic tracker grouping by product name.
 * Uses bigram-based Dice coefficient for fuzzy matching of normalized product names.
 */

// Store suffixes to strip during normalization
const STORE_SUFFIXES = [
  '| makeup.ua',
  '| notino.ua',
  '| parfums.ua',
  '- купить в украине',
  '- купити в україні',
  '| makeup',
  '| notino',
  '| parfums',
  '- купить',
  '- купити',
];

/**
 * Normalize a product name for comparison:
 * - lowercase
 * - remove store-specific suffixes
 * - normalize Unicode (NFC)
 * - collapse whitespace
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';

  let result = name.toLowerCase().trim();

  // Normalize Unicode to NFC form
  try {
    result = result.normalize('NFC');
  } catch (e) {
    // If normalization fails on invalid Unicode, continue with raw string
  }

  // Remove known store suffixes (case-insensitive, already lowercased)
  for (const suffix of STORE_SUFFIXES) {
    const idx = result.lastIndexOf(suffix);
    if (idx !== -1) {
      result = result.slice(0, idx);
    }
  }

  // Collapse whitespace and trim
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Extract bigrams (character pairs) from a string.
 * @param {string} str
 * @returns {string[]}
 */
function getBigrams(str) {
  const bigrams = [];
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Calculate similarity between two strings using bigram-based Dice coefficient.
 * Returns a value in [0, 1]. 1.0 for identical strings, symmetric.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function similarity(a, b) {
  try {
    if (a === b) return 1.0;
    if (!a || !b) return 0;
    if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0;

    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);

    // Count bigram occurrences in B for intersection calculation
    const bigramCountB = {};
    for (const bg of bigramsB) {
      bigramCountB[bg] = (bigramCountB[bg] || 0) + 1;
    }

    // Count intersection (shared bigrams, respecting multiplicity)
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramCountB[bg] && bigramCountB[bg] > 0) {
        intersection++;
        bigramCountB[bg]--;
      }
    }

    return (2 * intersection) / (bigramsA.length + bigramsB.length);
  } catch (e) {
    // Catch any errors from invalid Unicode or unexpected input
    return 0;
  }
}

/**
 * Find the best matching group for a normalized tracker name.
 * @param {string} normalizedName — already normalized name to match
 * @param {Array<{groupName: string, normalizedName: string}>} existingGroups
 * @param {number} [threshold=0.85] — minimum similarity to consider a match
 * @returns {string|null} — matching group name or null
 */
function findMatchingGroup(normalizedName, existingGroups, threshold = 0.85) {
  if (!normalizedName || !existingGroups || existingGroups.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const group of existingGroups) {
    const score = similarity(normalizedName, group.normalizedName);
    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestMatch = group.groupName;
    }
  }

  return bestMatch;
}

/**
 * Auto-group all ungrouped trackers by matching their normalized product names
 * against existing groups. Skips trackers with manually set productGroup.
 * @param {import('pg').Pool} pool — PostgreSQL connection pool
 * @returns {Promise<{grouped: number, total: number}>}
 */
async function autoGroupAll(pool) {
  // 1. Get all trackers that have no group (empty string or NULL)
  const ungroupedResult = await pool.query(
    `SELECT id, "productName", "productGroup" FROM trackers
     WHERE "productGroup" IS NULL OR "productGroup" = ''`
  );
  const ungrouped = ungroupedResult.rows;

  // 2. Collect existing groups (distinct non-empty productGroup values) with normalized names
  const groupsResult = await pool.query(
    `SELECT DISTINCT "productGroup" FROM trackers
     WHERE "productGroup" IS NOT NULL AND "productGroup" != ''`
  );
  const existingGroups = groupsResult.rows.map(row => ({
    groupName: row.productGroup,
    normalizedName: normalizeName(row.productGroup),
  }));

  let grouped = 0;

  // 3. For each ungrouped tracker, try to find a matching group
  for (const tracker of ungrouped) {
    const normalized = normalizeName(tracker.productName);
    if (!normalized) continue;

    const matchedGroup = findMatchingGroup(normalized, existingGroups, 0.85);

    if (matchedGroup) {
      await pool.query(
        `UPDATE trackers SET "productGroup" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [matchedGroup, tracker.id]
      );
      grouped++;
    }
  }

  return { grouped, total: ungrouped.length };
}

module.exports = {
  normalizeName,
  similarity,
  findMatchingGroup,
  autoGroupAll,
};

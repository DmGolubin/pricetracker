/**
 * Auto-Grouper — server-side module for automatic tracker grouping by product name.
 * Uses bigram-based Dice coefficient for fuzzy matching of normalized product names.
 *
 * Two modes:
 * 1. assignToExisting(pool, trackerId) — silently assign a new tracker to an existing group
 * 2. suggestGroups(pool) — return suggestions for ungrouped trackers (preview, no apply)
 * 3. applyGrouping(pool, assignments) — apply selected suggestions
 * 4. autoGroupAll(pool) — legacy: assign to existing groups only (no new group creation)
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
 * Normalize a product name for comparison.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  let result = name.toLowerCase().trim();
  try { result = result.normalize('NFC'); } catch (e) {}
  for (const suffix of STORE_SUFFIXES) {
    const idx = result.lastIndexOf(suffix);
    if (idx !== -1) result = result.slice(0, idx);
  }
  // Remove trailing noise: variant info, volume, store names
  result = result.replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '');
  result = result.replace(/\s*Большой ассортимент.*$/i, '');
  result = result.replace(/\s*Великий асортимент.*$/i, '');
  result = result.replace(/\s*\|\s*[\w.]+\s*$/, '');
  result = result.replace(/\s*[-–—]\s*\d+\s*(ml)?\s*([-–—]\s*\d+)?\s*$/i, '');
  result = result.replace(/\s*,?\s*\d+\s*мл\s*(\([^)]*\))?\s*$/i, '');
  // Remove "набор", "набір", "set", "gift set" etc for better matching
  result = result.replace(/\s*(набор|набір|gift\s*set|set)\s*(\(.*?\))?\s*$/i, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

function getBigrams(str) {
  const bigrams = [];
  for (let i = 0; i < str.length - 1; i++) bigrams.push(str.slice(i, i + 2));
  return bigrams;
}

function similarity(a, b) {
  try {
    if (a === b) return 1.0;
    if (!a || !b) return 0;
    if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0;
    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    const countB = {};
    for (const bg of bigramsB) countB[bg] = (countB[bg] || 0) + 1;
    let intersection = 0;
    for (const bg of bigramsA) {
      if (countB[bg] && countB[bg] > 0) { intersection++; countB[bg]--; }
    }
    return (2 * intersection) / (bigramsA.length + bigramsB.length);
  } catch (e) { return 0; }
}

function findMatchingGroup(normalizedName, existingGroups, threshold = 0.75) {
  if (!normalizedName || !existingGroups || existingGroups.length === 0) return null;

  // Priority 1: exact substring match — group name is fully contained in product name.
  // This allows users to name groups like "16 Pro Max" and only products
  // containing that exact phrase will match, avoiding false positives.
  // If multiple groups match, pick the longest (most specific) one.
  let substringMatch = null;
  let substringLen = 0;
  for (const group of existingGroups) {
    if (!group.normalizedName || group.normalizedName.length < 2) continue;
    if (normalizedName.includes(group.normalizedName) && group.normalizedName.length > substringLen) {
      substringMatch = group.groupName;
      substringLen = group.normalizedName.length;
    }
  }
  if (substringMatch) return substringMatch;

  // Priority 2: fuzzy bigram similarity
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

function cleanGroupName(name) {
  if (!name) return '';
  let result = name.trim();
  for (const suffix of STORE_SUFFIXES) {
    const idx = result.toLowerCase().lastIndexOf(suffix);
    if (idx !== -1) result = result.slice(0, idx);
  }
  result = result.replace(/\s*[-–—]\s*(купить|купити)\s+на\s+.*$/i, '');
  result = result.replace(/\s*Большой ассортимент.*$/i, '');
  result = result.replace(/\s*Великий асортимент.*$/i, '');
  result = result.replace(/\s*\|\s*[\w.]+\s*$/, '');
  result = result.replace(/\s*[-–—]\s*\d+\s*(ml)?\s*([-–—]\s*\d+)?\s*$/i, '');
  result = result.replace(/\s*,?\s*\d+\s*мл\s*(\([^)]*\))?\s*$/i, '');
  // Remove set/gift set/набор suffixes for cleaner group names
  result = result.replace(/\s*[-–—]?\s*(набор|набір|gift\s*set|set)\s*(\(.*?\))?\s*$/i, '');
  result = result.replace(/\s+/g, ' ').trim();
  if (!result || /^[\s?!.,;:]+$/.test(result)) return '';
  return result;
}

/**
 * Get existing groups with normalized names from DB.
 */
async function getExistingGroups(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT "productGroup" FROM trackers
     WHERE "productGroup" IS NOT NULL AND "productGroup" != ''`
  );
  return rows.map(row => ({
    groupName: row.productGroup,
    normalizedName: normalizeName(row.productGroup),
  }));
}

/**
 * Silently assign a single tracker to an existing group if a match is found.
 * Does NOT create new groups. Returns the matched group name or null.
 * @param {import('pg').Pool} pool
 * @param {number|string} trackerId
 * @returns {Promise<string|null>} matched group name or null
 */
async function assignToExisting(pool, trackerId) {
  const { rows } = await pool.query('SELECT id, "productName", "productGroup" FROM trackers WHERE id = $1', [trackerId]);
  if (!rows.length) return null;
  const tracker = rows[0];

  // Skip if already grouped
  if (tracker.productGroup) return tracker.productGroup;

  const normalized = normalizeName(tracker.productName);
  if (!normalized) return null;

  const existingGroups = await getExistingGroups(pool);
  const matchedGroup = findMatchingGroup(normalized, existingGroups, 0.75);

  if (matchedGroup) {
    await pool.query(
      `UPDATE trackers SET "productGroup" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [matchedGroup, tracker.id]
    );
    return matchedGroup;
  }

  return null;
}

/**
 * Suggest groupings for ungrouped trackers WITHOUT applying them.
 * Returns two arrays:
 * - existingMatches: trackers that match an existing group
 * - newGroupSuggestions: clusters of ungrouped trackers that could form new groups
 * @param {import('pg').Pool} pool
 * @returns {Promise<{existingMatches: Array, newGroupSuggestions: Array, ungroupedCount: number}>}
 */
async function suggestGroups(pool) {
  const { rows: ungrouped } = await pool.query(
    `SELECT id, "productName", "pageUrl" FROM trackers
     WHERE ("productGroup" IS NULL OR "productGroup" = '')`
  );

  const existingGroups = await getExistingGroups(pool);

  const existingMatches = [];
  const stillUngrouped = [];

  for (const tracker of ungrouped) {
    const normalized = normalizeName(tracker.productName);
    if (!normalized) { stillUngrouped.push({ ...tracker, normalized: '' }); continue; }

    const matchedGroup = findMatchingGroup(normalized, existingGroups, 0.75);
    if (matchedGroup) {
      existingMatches.push({
        trackerId: tracker.id,
        trackerName: tracker.productName,
        suggestedGroup: matchedGroup,
      });
    } else {
      stillUngrouped.push({ ...tracker, normalized });
    }
  }

  // Cross-match ungrouped to find potential new groups
  const newGroupSuggestions = [];
  const assigned = new Set();

  for (let i = 0; i < stillUngrouped.length; i++) {
    if (assigned.has(stillUngrouped[i].id)) continue;
    if (!stillUngrouped[i].normalized) continue;

    const cluster = [stillUngrouped[i]];
    for (let j = i + 1; j < stillUngrouped.length; j++) {
      if (assigned.has(stillUngrouped[j].id)) continue;
      if (!stillUngrouped[j].normalized) continue;
      const score = similarity(stillUngrouped[i].normalized, stillUngrouped[j].normalized);
      if (score >= 0.75) cluster.push(stillUngrouped[j]);
    }

    if (cluster.length >= 2) {
      const suggestedName = cluster
        .map(t => cleanGroupName(t.productName))
        .filter(n => n.length > 0)
        .sort((a, b) => a.length - b.length)[0] || '';

      if (suggestedName) {
        newGroupSuggestions.push({
          suggestedName,
          trackers: cluster.map(t => ({ id: t.id, name: t.productName })),
        });
        cluster.forEach(t => assigned.add(t.id));
      }
    }
  }

  return {
    existingMatches,
    newGroupSuggestions,
    ungroupedCount: ungrouped.length,
  };
}

/**
 * Apply specific grouping assignments.
 * @param {import('pg').Pool} pool
 * @param {Array<{trackerId: number, groupName: string}>} assignments
 * @returns {Promise<{applied: number}>}
 */
async function applyGrouping(pool, assignments) {
  let applied = 0;
  for (const a of assignments) {
    if (!a.trackerId || !a.groupName) continue;
    await pool.query(
      `UPDATE trackers SET "productGroup" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [a.groupName, a.trackerId]
    );
    applied++;
  }
  return { applied };
}

/**
 * Legacy: auto-group all ungrouped trackers into existing groups only.
 * Does NOT create new groups (safe mode).
 */
async function autoGroupAll(pool) {
  const { rows: ungrouped } = await pool.query(
    `SELECT id, "productName" FROM trackers
     WHERE "productGroup" IS NULL OR "productGroup" = ''`
  );

  const existingGroups = await getExistingGroups(pool);
  let grouped = 0;

  for (const tracker of ungrouped) {
    const normalized = normalizeName(tracker.productName);
    if (!normalized) continue;
    const matchedGroup = findMatchingGroup(normalized, existingGroups, 0.75);
    if (matchedGroup) {
      await pool.query(
        `UPDATE trackers SET "productGroup" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [matchedGroup, tracker.id]
      );
      grouped++;
    }
  }

  return { grouped, total: ungrouped.length, newGroups: 0 };
}


module.exports = {
  normalizeName,
  similarity,
  findMatchingGroup,
  cleanGroupName,
  assignToExisting,
  suggestGroups,
  applyGrouping,
  autoGroupAll,
};

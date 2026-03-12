/**
 * Server-side Price Checker — orchestrates the full check cycle:
 * 1. Fetch all active trackers from DB
 * 2. Launch Puppeteer, extract prices one by one
 * 3. Update tracker records, compute thresholds
 * 4. Collect digest entries
 * 5. Send Telegram digest
 * 6. Close browser
 *
 * Designed to be called by the scheduler (cron) or manually via API endpoint.
 */

const { Pool } = require('pg');
const scraper = require('./scraper');
const thresholdEngine = require('./serverThresholdEngine');
const digestComposer = require('./serverDigestComposer');
const telegram = require('./telegramSender');

// Concurrency: check N trackers at a time to balance speed vs memory
const CONCURRENCY = 2;

/**
 * Run a full price check cycle for all active trackers.
 * @param {Pool} pool — PostgreSQL connection pool
 * @returns {Promise<{checked: number, changed: number, errors: number}>}
 */
async function runCheckCycle(pool) {
  const startTime = Date.now();
  console.log('[ServerCheck] Starting price check cycle...');

  // 1. Fetch settings
  const settingsResult = await pool.query("SELECT * FROM settings WHERE id = 'global'");
  const settings = settingsResult.rows[0] || {};

  // 2. Fetch all active/updated trackers
  const trackersResult = await pool.query(
    `SELECT * FROM trackers WHERE status IN ('active', 'updated') ORDER BY id`
  );
  const trackers = trackersResult.rows;

  if (trackers.length === 0) {
    console.log('[ServerCheck] No active trackers found.');
    return { checked: 0, changed: 0, errors: 0 };
  }

  console.log(`[ServerCheck] Found ${trackers.length} active trackers.`);

  // 3. Create digest collector
  const collector = digestComposer.createCollector();

  let checked = 0;
  let changed = 0;
  let errors = 0;

  // 4. Process trackers with concurrency limit
  let index = 0;

  async function processNext() {
    while (index < trackers.length) {
      const tracker = trackers[index++];

      // Skip content trackers — they need full DOM comparison, not just price
      if (tracker.trackingType === 'content') {
        collector.addUnchanged();
        checked++;
        continue;
      }

      try {
        const result = await checkSingleTracker(pool, tracker, settings, collector);
        checked++;
        if (result === 'changed') changed++;
        else if (result === 'error') errors++;
      } catch (err) {
        console.error(`[ServerCheck] Unexpected error for tracker ${tracker.id}:`, err.message);
        errors++;
        checked++;
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(CONCURRENCY, trackers.length); w++) {
    workers.push(processNext());
  }
  await Promise.all(workers);

  // 5. Close browser after cycle
  await scraper.closeBrowser();

  // 6. Send Telegram digest
  if (collector.hasChanges() && settings.telegramDigestEnabled) {
    const messages = collector.compose();
    if (messages.length > 0 && settings.telegramBotToken && settings.telegramChatId) {
      const sent = await telegram.sendDigest(
        settings.telegramBotToken, settings.telegramChatId, messages
      );
      console.log(`[ServerCheck] Digest sent: ${sent}/${messages.length} messages.`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[ServerCheck] Cycle complete: ${checked} checked, ${changed} changed, ${errors} errors in ${elapsed}s`);

  return { checked, changed, errors };
}

/**
 * Check a single tracker: extract price, compare, update DB, feed digest.
 * @param {Pool} pool
 * @param {Object} tracker — DB row
 * @param {Object} settings — global settings
 * @param {Object} collector — digest collector
 * @returns {Promise<'unchanged'|'changed'|'error'>}
 */
async function checkSingleTracker(pool, tracker, settings, collector) {
  const result = await scraper.extractPrice(tracker);

  if (!result.success) {
    console.warn(`[ServerCheck] Tracker ${tracker.id} (${tracker.productName}): ${result.error}`);

    // Update tracker status to error
    await pool.query(
      `UPDATE trackers SET status = 'error', "errorMessage" = $1, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $2`,
      [result.error, tracker.id]
    );

    return 'error';
  }

  const newPrice = result.price;
  const oldPrice = Number(tracker.currentPrice);
  const now = new Date().toISOString();

  // Save price history record
  await pool.query(
    `INSERT INTO price_history ("trackerId", price, "checkedAt") VALUES ($1, $2, $3)`,
    [tracker.id, newPrice, now]
  );

  // Detect first check for variant trackers
  const isFirstVariantCheck = tracker.variantSelector
    && !tracker.variantPriceVerified;

  // Compute updated stats
  const baseMin = isFirstVariantCheck ? newPrice : Number(tracker.minPrice);
  const baseMax = isFirstVariantCheck ? newPrice : Number(tracker.maxPrice);
  const updatedMin = Math.min(baseMin, newPrice);
  const updatedMax = Math.max(baseMax, newPrice);
  const priceChanged = newPrice !== oldPrice;

  // Build update fields
  const updateFields = {
    currentPrice: newPrice,
    minPrice: updatedMin,
    maxPrice: updatedMax,
    lastCheckedAt: now,
    status: 'active',
  };

  if (isFirstVariantCheck) {
    updateFields.initialPrice = newPrice;
    updateFields.variantPriceVerified = true;
  }

  if (priceChanged && !isFirstVariantCheck) {
    updateFields.status = 'updated';
    updateFields.unread = true;
    updateFields.previousPrice = oldPrice;
  }

  // Execute update
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(updateFields)) {
    setClauses.push(`"${key}" = $${idx}`);
    values.push(val);
    idx++;
  }
  setClauses.push(`"updatedAt" = NOW()`);
  values.push(tracker.id);

  await pool.query(
    `UPDATE trackers SET ${setClauses.join(', ')} WHERE id = $${idx}`,
    values
  );

  // Check historical minimum (only when price decreased)
  let isHistMin = false;
  if (priceChanged && !isFirstVariantCheck && newPrice < oldPrice) {
    isHistMin = thresholdEngine.isHistoricalMinimum(newPrice, Number(tracker.minPrice));
  }

  // Feed digest collector
  if (priceChanged && !isFirstVariantCheck) {
    // Check threshold significance
    const thresholdConfig = thresholdEngine.resolveThresholdConfig(tracker, settings);
    const significant = thresholdEngine.isSignificant(oldPrice, newPrice, thresholdConfig);

    if (significant || isHistMin) {
      collector.addChange(tracker, oldPrice, newPrice, isHistMin);
    } else {
      // Price changed but not significantly — treat as unchanged for digest
      collector.addUnchanged();
    }
    return 'changed';
  } else {
    collector.addUnchanged();
    return 'unchanged';
  }
}

module.exports = { runCheckCycle };

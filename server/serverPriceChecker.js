/**
 * Server-side Price Checker — orchestrates the full check cycle:
 * 1. Fetch all active trackers from DB
 * 2. Launch Puppeteer, extract prices one by one
 * 3. Update tracker records, compute thresholds
 * 4. Collect digest entries
 * 5. Send Telegram digest
 * 6. Close browser
 */

const { Pool } = require('pg');
const scraper = require('./scraper');
const thresholdEngine = require('./serverThresholdEngine');
const digestComposer = require('./serverDigestComposer');
const telegram = require('./telegramSender');

const CONCURRENCY = 1;

/**
 * Run a full price check cycle for all active trackers.
 * @param {Pool} pool
 * @returns {Promise<{checked: number, changed: number, errors: number}>}
 */
async function runCheckCycle(pool) {
  const startTime = Date.now();
  console.log('[ServerCheck] ═══════════════════════════════════════════════');
  console.log('[ServerCheck] 🚀 Starting price check cycle');
  console.log('[ServerCheck] Time: ' + new Date().toISOString());
  console.log('[ServerCheck] ═══════════════════════════════════════════════');

  // 1. Fetch settings
  var settings;
  try {
    var settingsResult = await pool.query("SELECT * FROM settings WHERE id = 'global'");
    settings = settingsResult.rows[0] || {};
    var tgStatus = (settings.telegramBotToken && settings.telegramChatId) ? 'configured' : 'NOT configured';
    console.log('[ServerCheck] Settings loaded. Digest: ' + (settings.telegramDigestEnabled ? 'ON' : 'OFF') + ' | Telegram: ' + tgStatus);
  } catch (err) {
    console.error('[ServerCheck] ❌ Failed to load settings: ' + err.message);
    return { checked: 0, changed: 0, errors: 0, error: 'Settings load failed' };
  }

  // 2. Fetch all active/updated trackers
  var trackers;
  try {
    var trackersResult = await pool.query(
      "SELECT * FROM trackers WHERE status IN ('active', 'updated', 'error') ORDER BY id"
    );
    trackers = trackersResult.rows;
  } catch (err) {
    console.error('[ServerCheck] ❌ Failed to load trackers: ' + err.message);
    return { checked: 0, changed: 0, errors: 0, error: 'Trackers load failed' };
  }

  if (trackers.length === 0) {
    console.log('[ServerCheck] No active trackers found. Nothing to do.');
    return { checked: 0, changed: 0, errors: 0 };
  }

  var priceTrackers = trackers.filter(function(t) { return t.trackingType !== 'content'; });
  var contentTrackers = trackers.filter(function(t) { return t.trackingType === 'content'; });
  console.log('[ServerCheck] Found ' + trackers.length + ' active trackers (' + priceTrackers.length + ' price, ' + contentTrackers.length + ' content — skipped)');

  // 3. Create digest collector
  var collector = digestComposer.createCollector();

  var checked = 0;
  var changed = 0;
  var errors = 0;

  // Count content trackers as unchanged
  contentTrackers.forEach(function() { collector.addUnchanged(); checked++; });

  // 4. Process price trackers with concurrency limit
  var index = 0;

  async function processNext() {
    while (index < priceTrackers.length) {
      var tracker = priceTrackers[index++];
      try {
        var result = await checkSingleTracker(pool, tracker, settings, collector);
        checked++;
        if (result === 'changed') changed++;
        else if (result === 'error') errors++;
      } catch (err) {
        console.error('[ServerCheck] ❌ Unexpected error for #' + tracker.id + ': ' + err.message);
        errors++;
        checked++;
      }
    }
  }

  var workers = [];
  for (var w = 0; w < Math.min(CONCURRENCY, priceTrackers.length); w++) {
    workers.push(processNext());
  }
  await Promise.all(workers);

  // 5. Close browser after cycle
  await scraper.closeBrowser();

  // 6. Send Telegram digest
  var digestEntries = collector.getEntries();
  var unchangedCount = collector.getUnchangedCount();
  console.log('[ServerCheck] Digest: ' + digestEntries.length + ' changes, ' + unchangedCount + ' unchanged');

  if (collector.hasChanges() && settings.telegramDigestEnabled) {
    var messages = collector.compose();
    if (messages.length > 0 && settings.telegramBotToken && settings.telegramChatId) {
      console.log('[ServerCheck] 📨 Sending digest (' + messages.length + ' message(s), ' + digestEntries.length + ' changes)...');
      var sent = await telegram.sendDigest(settings.telegramBotToken, settings.telegramChatId, messages);
      var icon = sent === messages.length ? '✅' : '⚠';
      console.log('[ServerCheck] ' + icon + ' Digest sent: ' + sent + '/' + messages.length + ' messages');
    } else if (messages.length === 0) {
      console.log('[ServerCheck] Digest composed but empty — skipping send.');
    } else {
      console.log('[ServerCheck] ⚠ Telegram not configured — digest not sent.');
    }
  } else if (!collector.hasChanges()) {
    console.log('[ServerCheck] No price changes — no digest to send.');
  } else {
    console.log('[ServerCheck] Digest mode disabled — skipping.');
  }

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('[ServerCheck] ═══════════════════════════════════════════════');
  console.log('[ServerCheck] ✅ Cycle complete in ' + elapsed + 's');
  console.log('[ServerCheck]    Checked: ' + checked + ' | Changed: ' + changed + ' | Errors: ' + errors);
  console.log('[ServerCheck] ═══════════════════════════════════════════════');

  return { checked: checked, changed: changed, errors: errors };
}

/**
 * Check a single tracker: extract price, compare, update DB, feed digest.
 */
async function checkSingleTracker(pool, tracker, settings, collector) {
  var result = await scraper.extractPrice(tracker);

  if (!result.success) {
    console.warn('[ServerCheck] #' + tracker.id + ' ❌ Extraction failed: ' + result.error);

    await pool.query(
      'UPDATE trackers SET status = $1, "errorMessage" = $2, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $3',
      ['error', result.error, tracker.id]
    );

    return 'error';
  }

  var newPrice = result.price;
  var oldPrice = Number(tracker.currentPrice);
  var now = new Date().toISOString();

  // Save price history record
  await pool.query(
    'INSERT INTO price_history ("trackerId", price, "checkedAt") VALUES ($1, $2, $3)',
    [tracker.id, newPrice, now]
  );

  // Detect first check for variant trackers
  var isFirstVariantCheck = tracker.variantSelector && !tracker.variantPriceVerified;

  if (isFirstVariantCheck) {
    console.log('[ServerCheck] #' + tracker.id + ' First variant check — setting initial price to ' + newPrice);
  }

  // Compute updated stats
  var baseMin = isFirstVariantCheck ? newPrice : Number(tracker.minPrice);
  var baseMax = isFirstVariantCheck ? newPrice : Number(tracker.maxPrice);
  var updatedMin = Math.min(baseMin, newPrice);
  var updatedMax = Math.max(baseMax, newPrice);
  var priceChanged = newPrice !== oldPrice;

  // Build update fields
  var updateFields = {
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

  // Execute update — build parameterized query
  var setClauses = [];
  var values = [];
  var idx = 1;

  var keys = Object.keys(updateFields);
  for (var k = 0; k < keys.length; k++) {
    setClauses.push('"' + keys[k] + '" = $' + idx);
    values.push(updateFields[keys[k]]);
    idx++;
  }
  setClauses.push('"updatedAt" = NOW()');
  values.push(tracker.id);

  await pool.query(
    'UPDATE trackers SET ' + setClauses.join(', ') + ' WHERE id = $' + idx,
    values
  );

  // Check historical minimum (only when price decreased)
  var isHistMin = false;
  if (priceChanged && !isFirstVariantCheck && newPrice < oldPrice) {
    isHistMin = thresholdEngine.isHistoricalMinimum(newPrice, Number(tracker.minPrice));
  }

  // Feed digest collector
  if (priceChanged && !isFirstVariantCheck) {
    var thresholdConfig = thresholdEngine.resolveThresholdConfig(tracker, settings);
    var significant = thresholdEngine.isSignificant(oldPrice, newPrice, thresholdConfig);
    var direction = newPrice > oldPrice ? '📈' : '📉';
    var diff = newPrice - oldPrice;
    var pctChange = oldPrice !== 0 ? ((diff / oldPrice) * 100).toFixed(1) : 'N/A';

    var logMsg = '[ServerCheck] #' + tracker.id + ' ' + direction + ' ' + oldPrice + ' → ' + newPrice
      + ' (' + (diff > 0 ? '+' : '') + pctChange + '%)'
      + (isHistMin ? ' 🏆 HIST MIN' : '')
      + (significant ? '' : ' (below threshold)');
    console.log(logMsg);

    if (significant || isHistMin) {
      collector.addChange(tracker, oldPrice, newPrice, isHistMin);
    } else {
      collector.addUnchanged();
    }
    return 'changed';
  } else {
    collector.addUnchanged();
    return 'unchanged';
  }
}

module.exports = { runCheckCycle };

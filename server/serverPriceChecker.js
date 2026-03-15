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
const autoGrouper = require('./autoGrouper');

const CONCURRENCY = 1;

/**
 * Extract domain from URL for WAF cooldown tracking.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch (_) {
    return 'unknown';
  }
}

/**
 * Shuffle array in-place (Fisher-Yates).
 * Randomizes tracker order so we don't hit the same domain repeatedly.
 */
function shuffleArray(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Random delay between min and max milliseconds.
 */
function randomDelay(minMs, maxMs) {
  var ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Run a full price check cycle for all active trackers.
 * @param {Pool} pool
 * @returns {Promise<{checked: number, changed: number, errors: number}>}
 */
async function runCheckCycle(pool, isCancelled) {
  if (typeof isCancelled !== 'function') isCancelled = function() { return false; };
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

  // Shuffle trackers to randomize order — avoids hitting same domain repeatedly
  shuffleArray(priceTrackers);
  console.log('[ServerCheck] Tracker order randomized');

  // WAF cooldown tracker: domain → timestamp of last WAF block
  var wafCooldowns = {};
  var WAF_COOLDOWN_MS = 60000; // 60s cooldown per domain after WAF block

  // 4. Process price trackers with concurrency limit
  var index = 0;

  async function processNext() {
    while (index < priceTrackers.length) {
      if (isCancelled()) {
        console.log('[ServerCheck] ⛔ Check cancelled by user.');
        break;
      }
      var tracker = priceTrackers[index++];
      var domain = getDomain(tracker.pageUrl || '');

      // Check WAF cooldown for this domain
      if (wafCooldowns[domain]) {
        var elapsed = Date.now() - wafCooldowns[domain];
        if (elapsed < WAF_COOLDOWN_MS) {
          var waitMs = WAF_COOLDOWN_MS - elapsed;
          console.log('[ServerCheck] ⏳ WAF cooldown for ' + domain + ' — waiting ' + Math.round(waitMs / 1000) + 's');
          await new Promise(function(r) { setTimeout(r, waitMs); });
        }
      }

      // Random delay between trackers
      // Notino needs longer delays to avoid bot detection (wait page)
      if (index > 1) {
        var isNotinoDomain = domain.indexOf('notino') !== -1;
        var delayMs = isNotinoDomain
          ? 20000 + Math.floor(Math.random() * 15000)   // 20-35s for Notino
          : 5000 + Math.floor(Math.random() * 10000);    // 5-15s for others
        console.log('[ServerCheck] ⏳ Delay ' + Math.round(delayMs / 1000) + 's before #' + tracker.id + (isNotinoDomain ? ' (notino)' : ''));
        await new Promise(function(r) { setTimeout(r, delayMs); });
      }

      try {
        var result = await checkSingleTracker(pool, tracker, settings, collector);
        checked++;
        if (result === 'changed') changed++;
        else if (result === 'error') errors++;
        else if (result === 'waf_blocked') {
          errors++;
          wafCooldowns[domain] = Date.now();
          console.log('[ServerCheck] ⛔ WAF block detected for ' + domain + ' — cooldown activated');
        }
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
    if (messages.length > 0 && settings.telegramBotToken && (settings.telegramChatId || settings.telegramPersonalChatId)) {
      console.log('[ServerCheck] 📨 Sending digest (' + messages.length + ' message(s), ' + digestEntries.length + ' changes)...');
      var sent = await telegram.sendDigest(settings.telegramBotToken, settings.telegramChatId, messages, settings.telegramPersonalChatId);
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

  // 7. Run auto-grouping to detect cross-store products
  try {
    var groupResult = await autoGrouper.autoGroupAll(pool);
    if (groupResult.grouped > 0 || groupResult.newGroups > 0) {
      console.log('[ServerCheck] 🔗 Auto-grouped: ' + groupResult.grouped + ' trackers, ' + (groupResult.newGroups || 0) + ' new groups');
    }
  } catch (err) {
    console.warn('[ServerCheck] ⚠ Auto-grouping failed: ' + err.message);
  }

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
    // Check if this was a WAF/Cloudflare block
    if (result.wafBlocked) {
      console.warn('[ServerCheck] #' + tracker.id + ' ⛔ WAF blocked: ' + result.error);
      await pool.query(
        'UPDATE trackers SET "errorMessage" = $1, "retryCount" = COALESCE("retryCount", 0) + 1, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $2',
        [result.error, tracker.id]
      );
      return 'waf_blocked';
    }

    console.warn('[ServerCheck] #' + tracker.id + ' ❌ Extraction failed: ' + result.error);

    await pool.query(
      'UPDATE trackers SET status = $1, "errorMessage" = $2, "retryCount" = COALESCE("retryCount", 0) + 1, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $3',
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
    retryCount: 0,
    errorMessage: null,
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

  // Append volume to productName if scraper returned it and name doesn't already have it
  if (result.volume && tracker.productName) {
    var nameHasVolume = /\d+\s*мл/i.test(tracker.productName) || /\d+\s*ml\b/i.test(tracker.productName);
    if (!nameHasVolume) {
      var newName = tracker.productName + ' — ' + result.volume;
      updateFields.productName = newName;
      console.log('[ServerCheck] #' + tracker.id + ' 📏 Volume appended: "' + newName + '"');
    }
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
  // If tracker belongs to a productGroup, check cross-store minimum
  var isHistMin = false;
  var isCrossStoreMin = false;
  if (priceChanged && !isFirstVariantCheck && newPrice < oldPrice) {
    // Per-tracker historical minimum (as before)
    isHistMin = thresholdEngine.isHistoricalMinimum(newPrice, Number(tracker.minPrice));

    // Cross-store group minimum: find the lowest minPrice across all trackers in the same group
    if (tracker.productGroup) {
      try {
        var groupMinResult = await pool.query(
          'SELECT MIN("minPrice") AS "groupMin" FROM trackers WHERE "productGroup" = $1 AND id != $2 AND "minPrice" > 0',
          [tracker.productGroup, tracker.id]
        );
        var groupMin = groupMinResult.rows[0] && groupMinResult.rows[0].groupMin != null
          ? Number(groupMinResult.rows[0].groupMin) : null;
        if (groupMin != null && newPrice < groupMin) {
          isCrossStoreMin = true;
          isHistMin = true; // Promote to historical minimum if it beats the entire group
        }
      } catch (err) {
        console.warn('[ServerCheck] #' + tracker.id + ' ⚠ Failed to check group minimum: ' + err.message);
      }
    }
  }

  // For grouped trackers: suppress price-drop alerts unless the new price
  // beats the current best price across all other stores in the group.
  var suppressedByGroup = false;
  if (priceChanged && !isFirstVariantCheck && newPrice < oldPrice && tracker.productGroup) {
    try {
      var groupCurrentResult = await pool.query(
        'SELECT MIN("currentPrice") AS "groupCurrentMin" FROM trackers WHERE "productGroup" = $1 AND id != $2 AND "currentPrice" > 0',
        [tracker.productGroup, tracker.id]
      );
      var groupCurrentMin = groupCurrentResult.rows[0] && groupCurrentResult.rows[0].groupCurrentMin != null
        ? Number(groupCurrentResult.rows[0].groupCurrentMin) : null;
      if (groupCurrentMin != null && newPrice >= groupCurrentMin) {
        suppressedByGroup = true;
        console.log('[ServerCheck] #' + tracker.id + ' 📉 ' + oldPrice + ' → ' + newPrice
          + ' — suppressed (group current min is ' + groupCurrentMin + ')');
      }
    } catch (err) {
      console.warn('[ServerCheck] #' + tracker.id + ' ⚠ Failed to check group current min: ' + err.message);
    }
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
      + (isCrossStoreMin ? ' 🏆🏆 CROSS-STORE MIN' : isHistMin ? ' 🏆 HIST MIN' : '')
      + (significant ? '' : ' (below threshold)')
      + (suppressedByGroup ? ' [SUPPRESSED by group]' : '');
    console.log(logMsg);

    if (suppressedByGroup) {
      collector.addUnchanged();
    } else if (significant || isHistMin) {
      collector.addChange(tracker, oldPrice, newPrice, isHistMin, isCrossStoreMin);
    } else {
      collector.addUnchanged();
    }
    return 'changed';
  } else {
    collector.addUnchanged();
    return 'unchanged';
  }
}

module.exports = { runCheckCycle, checkSingleTracker };

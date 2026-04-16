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
  // WAF block counter: domain → consecutive block count
  var wafBlockCounts = {};
  var WAF_COOLDOWN_MS = 60000; // 60s cooldown per domain after WAF block (default)
  var WAF_COOLDOWN_NOTINO_MS = 180000; // 3 min cooldown for Notino
  var WAF_SKIP_THRESHOLD = 3; // Skip remaining domain trackers after N consecutive blocks
  var skippedByWaf = 0;

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

      // Skip domain entirely if too many consecutive WAF blocks
      if (wafBlockCounts[domain] >= WAF_SKIP_THRESHOLD) {
        console.log('[ServerCheck] ⏭ Skipping #' + tracker.id + ' — ' + domain + ' blocked ' + wafBlockCounts[domain] + ' times, skipping rest');
        collector.addUnchanged();
        checked++;
        skippedByWaf++;
        continue;
      }

      // Check WAF cooldown for this domain
      var domainCooldownMs = domain.indexOf('notino') !== -1 ? WAF_COOLDOWN_NOTINO_MS : WAF_COOLDOWN_MS;
      if (wafCooldowns[domain]) {
        var elapsed = Date.now() - wafCooldowns[domain];
        if (elapsed < domainCooldownMs) {
          var waitMs = domainCooldownMs - elapsed;
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
          wafBlockCounts[domain] = (wafBlockCounts[domain] || 0) + 1;
          console.log('[ServerCheck] ⛔ WAF block detected for ' + domain + ' (' + wafBlockCounts[domain] + '/' + WAF_SKIP_THRESHOLD + ')');
        } else {
          // Successful check — reset consecutive block counter for this domain
          wafBlockCounts[domain] = 0;
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

  // 6. Log digest summary (individual alerts already sent inline)
  var digestEntries = collector.getEntries();
  var unchangedCount = collector.getUnchangedCount();
  console.log('[ServerCheck] Digest summary: ' + digestEntries.length + ' changes, ' + unchangedCount + ' unchanged');

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
  console.log('[ServerCheck]    Checked: ' + checked + ' | Changed: ' + changed + ' | Errors: ' + errors + (skippedByWaf > 0 ? ' | WAF-skipped: ' + skippedByWaf : ''));
  console.log('[ServerCheck] ═══════════════════════════════════════════════');

  return { checked: checked, changed: changed, errors: errors };
}

/**
 * Check a single tracker: extract price, compare, update DB, feed digest.
 */
async function checkSingleTracker(pool, tracker, settings, collector) {
  var extractOptions = {};
  if (settings && settings.siteCookies) {
    extractOptions.siteCookies = settings.siteCookies;
  }
  var result = await scraper.extractPrice(tracker, extractOptions);

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

    // Increment consecutive errors
    var newConsecErrors = (Number(tracker.consecutiveErrors) || 0) + 1;
    await pool.query(
      'UPDATE trackers SET status = $1, "errorMessage" = $2, "retryCount" = COALESCE("retryCount", 0) + 1, "consecutiveErrors" = $3, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $4',
      ['error', result.error, newConsecErrors, tracker.id]
    );

    // Smart error alert: notify on 3rd consecutive error, but only once until it recovers
    if (newConsecErrors >= 3 && !tracker.errorNotifiedAt) {
      try {
        var errSettings = await pool.query("SELECT * FROM settings WHERE id = 'global'");
        var s = errSettings.rows[0] || {};
        if (s.telegramBotToken && (s.telegramPersonalChatId || s.telegramChatId)) {
          var chatId = s.telegramPersonalChatId || s.telegramChatId;
          var errMsg = '⚠️ <b>Ошибка трекера</b>\n\n'
            + '🏷 ' + (tracker.productName || '').slice(0, 50) + '\n'
            + '❌ ' + (result.error || 'Unknown error') + '\n'
            + '🔄 Ошибок подряд: ' + newConsecErrors;
          await fetch('https://api.telegram.org/bot' + s.telegramBotToken + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: errMsg, parse_mode: 'HTML' }),
          });
          await pool.query('UPDATE trackers SET "errorNotifiedAt" = NOW() WHERE id = $1', [tracker.id]);
        }
      } catch (_notifErr) {
        console.warn('[ServerCheck] Failed to send error notification:', _notifErr.message);
      }
    }

    return 'error';
  }

  var newPrice = result.price;
  var oldPrice = Number(tracker.currentPrice);
  var now = new Date().toISOString();

  // Sanity check: reject suspiciously low prices that are likely parsing errors
  // (e.g., rating numbers, review counts, etc.)
  if (newPrice < 50) {
    console.warn('[ServerCheck] #' + tracker.id + ' ⚠ Suspicious price: ' + newPrice + ' (too low, likely parsing error)');
    await pool.query(
      'UPDATE trackers SET status = $1, "errorMessage" = $2, "consecutiveErrors" = COALESCE("consecutiveErrors", 0) + 1, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $3',
      ['error', 'Suspicious price: ' + newPrice + ' (too low)', tracker.id]
    );
    return 'error';
  }

  // Sanity check: if price dropped more than 80% from previous known price,
  // it's likely a parsing error (wrong element on page)
  if (oldPrice > 0 && newPrice < oldPrice * 0.2) {
    console.warn('[ServerCheck] #' + tracker.id + ' ⚠ Suspicious price drop: ' + oldPrice + ' → ' + newPrice + ' (-' + ((1 - newPrice / oldPrice) * 100).toFixed(0) + '%)');
    await pool.query(
      'UPDATE trackers SET status = $1, "errorMessage" = $2, "consecutiveErrors" = COALESCE("consecutiveErrors", 0) + 1, "lastCheckedAt" = NOW(), "updatedAt" = NOW() WHERE id = $3',
      ['error', 'Suspicious price: ' + newPrice + ' (dropped ' + ((1 - newPrice / oldPrice) * 100).toFixed(0) + '% from ' + oldPrice + ')', tracker.id]
    );
    return 'error';
  }

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
    consecutiveErrors: 0,
    errorNotifiedAt: null,
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

  // Feed digest collector — only notify on price DECREASES
  if (priceChanged && !isFirstVariantCheck) {
    var direction = newPrice > oldPrice ? '📈' : '📉';
    var diff = newPrice - oldPrice;
    var pctChange = oldPrice !== 0 ? ((diff / oldPrice) * 100).toFixed(1) : 'N/A';

    // Price increased — log but never notify
    if (newPrice > oldPrice) {
      console.log('[ServerCheck] #' + tracker.id + ' ' + direction + ' ' + oldPrice + ' → ' + newPrice
        + ' (+' + pctChange + '%) — increase, no notification');
      collector.addUnchanged();
      return 'changed';
    }

    // Price decreased — check thresholds and group suppression
    var thresholdConfig = thresholdEngine.resolveThresholdConfig(tracker, settings);
    var significant = thresholdEngine.isSignificant(oldPrice, newPrice, thresholdConfig);

    var logMsg = '[ServerCheck] #' + tracker.id + ' ' + direction + ' ' + oldPrice + ' → ' + newPrice
      + ' (' + pctChange + '%)'
      + (isCrossStoreMin ? ' 🏆🏆 CROSS-STORE MIN' : isHistMin ? ' 🏆 HIST MIN' : '')
      + (significant ? '' : ' (below threshold)')
      + (suppressedByGroup ? ' [SUPPRESSED by group]' : '');
    console.log(logMsg);

    if (suppressedByGroup) {
      collector.addUnchanged();
    } else if (significant || isHistMin) {
      collector.addChange(tracker, oldPrice, newPrice, isHistMin, isCrossStoreMin);

      // Send immediate Telegram alert for this price drop
      // (don't wait for end of cycle — process may be killed by hosting timeout)
      try {
        if (settings.telegramDigestEnabled && settings.telegramBotToken && (settings.telegramPersonalChatId || settings.telegramChatId)) {
          var domain = '';
          try { domain = new URL(tracker.pageUrl).hostname; } catch(_) {}
          var shopLabel = domain.indexOf('makeup') !== -1 ? 'Makeup' : domain.indexOf('eva.ua') !== -1 ? 'EVA' : domain.indexOf('notino') !== -1 ? 'Notino' : domain.indexOf('kasta') !== -1 ? 'Kasta' : domain;
          var cleanName = (tracker.productName || '').replace(/\s*[-–—]\s*купит[иь]\s.*$/i, '').substring(0, 60);
          var pctStr = pctChange + '%';
          var minTag = isCrossStoreMin ? ' 🏆🏆 Лучшая цена!' : isHistMin ? ' 🏆 Ист. минимум!' : '';
          var alertMsg = '📉 <b>' + telegram.escapeHtml(cleanName) + '</b>\n'
            + '<s>' + oldPrice + '</s> → <b>' + newPrice + '</b> грн (' + pctStr + ')'
            + ' · ' + telegram.escapeHtml(shopLabel) + minTag
            + '\n<a href="' + (tracker.pageUrl || '') + '">Открыть</a>';
          var chatTarget = settings.telegramPersonalChatId || settings.telegramChatId;
          await telegram.sendMessage(settings.telegramBotToken, chatTarget, alertMsg);
          console.log('[ServerCheck] #' + tracker.id + ' 📨 Immediate alert sent');
        }
      } catch (alertErr) {
        console.warn('[ServerCheck] #' + tracker.id + ' ⚠ Failed to send immediate alert: ' + alertErr.message);
      }
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

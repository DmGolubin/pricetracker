/**
 * Scheduler — cron-based price check scheduler.
 *
 * Runs price checks at configurable intervals using node-cron.
 * Default: every 3 hours (cron: "0 0,3,6,9,12,15,18,21 * * *").
 *
 * Also exposes functions to start/stop the scheduler and trigger manual checks.
 */

const cron = require('node-cron');
const { runCheckCycle, checkSingleTracker } = require('./serverPriceChecker');
const scraper = require('./scraper');

let scheduledTask = null;
let retryInterval = null;
let isRunning = false;
let isRetrying = false;
let lastRunAt = null;
let lastResult = null;
let cancelRequested = false;

// Default cron: every 3 hours
const DEFAULT_CRON = '0 */3 * * *';

// Retry settings
const RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY_BETWEEN_MS = 8000; // 8s between retried trackers

/**
 * Start the cron scheduler.
 * @param {import('pg').Pool} pool — PostgreSQL connection pool
 * @param {string} [cronExpression] — cron expression, defaults to every 3 hours
 */
function start(pool, cronExpression) {
  const expr = cronExpression || DEFAULT_CRON;

  if (scheduledTask) {
    console.log('[Scheduler] Already running, stopping previous task...');
    scheduledTask.stop();
  }

  if (!cron.validate(expr)) {
    console.error('[Scheduler] Invalid cron expression:', expr);
    return;
  }

  console.log('[Scheduler] ═══════════════════════════════════════');
  console.log('[Scheduler] Starting cron scheduler');
  console.log('[Scheduler] Cron expression:', expr);
  console.log('[Scheduler] Current time:', new Date().toISOString());
  console.log('[Scheduler] Retry interval: every ' + (RETRY_INTERVAL_MS / 60000) + ' min, max ' + MAX_RETRIES + ' retries');
  console.log('[Scheduler] ═══════════════════════════════════════');

  scheduledTask = cron.schedule(expr, async () => {
    if (isRunning) {
      console.log('[Scheduler] ⚠ Previous check cycle still running, skipping this tick.');
      return;
    }

    console.log('[Scheduler] ⏰ Cron tick — starting check cycle...');

    // Check if server-side checks are enabled (skip if checkMethod is 'extension')
    try {
      var settingsResult = await pool.query("SELECT * FROM settings WHERE id = 'global'");
      var settings = settingsResult.rows[0] || {};
      if (settings.checkMethod === 'extension') {
        console.log('[Scheduler] ⏭ Skipping — checkMethod is "extension" (browser-only mode)');
        return;
      }
    } catch (_) {}

    isRunning = true;
    cancelRequested = false;
    lastRunAt = new Date().toISOString();

    // Reset retryCount for all error trackers at the start of a new cycle
    try {
      await pool.query('UPDATE trackers SET "retryCount" = 0 WHERE status = $1', ['error']);
    } catch (_) {}

    try {
      lastResult = await runCheckCycle(pool, function() { return cancelRequested; });
      console.log('[Scheduler] ✅ Check cycle completed:', JSON.stringify(lastResult));
    } catch (err) {
      lastResult = { error: err.message };
      console.error('[Scheduler] ❌ Check cycle failed:', err.message);
      console.error('[Scheduler] Stack:', err.stack);
    } finally {
      isRunning = false;
    }
  });

  // Start retry timer for failed trackers
  startRetryTimer(pool);
}

/**
 * Stop the cron scheduler and retry timer.
 */
function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped.');
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
    console.log('[Scheduler] Retry timer stopped.');
  }
}

/**
 * Start the retry timer that periodically re-checks failed trackers.
 * @param {import('pg').Pool} pool
 */
function startRetryTimer(pool) {
  if (retryInterval) clearInterval(retryInterval);

  retryInterval = setInterval(async () => {
    // Don't retry while a full check cycle is running
    if (isRunning || isRetrying) return;

    try {
      await retryFailedTrackers(pool);
    } catch (err) {
      console.error('[Retry] ❌ Unexpected error:', err.message);
    }
  }, RETRY_INTERVAL_MS);
}

/**
 * Find trackers with status='error' and retryCount < MAX_RETRIES,
 * and re-check them one by one with delays.
 * @param {import('pg').Pool} pool
 */
async function retryFailedTrackers(pool) {
  var result;
  try {
    result = await pool.query(
      'SELECT * FROM trackers WHERE status = $1 AND COALESCE("retryCount", 0) < $2 ORDER BY "lastCheckedAt" ASC',
      ['error', MAX_RETRIES]
    );
  } catch (err) {
    console.error('[Retry] Failed to query error trackers:', err.message);
    return;
  }

  var trackers = result.rows;
  if (trackers.length === 0) return;

  isRetrying = true;
  console.log('[Retry] 🔄 Found ' + trackers.length + ' failed tracker(s) to retry (attempt ≤' + MAX_RETRIES + ')');

  var settingsResult;
  try {
    settingsResult = await pool.query("SELECT * FROM settings WHERE id = 'global'");
  } catch (err) {
    console.error('[Retry] Failed to load settings:', err.message);
    isRetrying = false;
    return;
  }
  var settings = (settingsResult.rows && settingsResult.rows[0]) || {};
  var noopCollector = { addChange: function() {}, addUnchanged: function() {} };

  var retried = 0;
  var fixed = 0;

  for (var i = 0; i < trackers.length; i++) {
    var tracker = trackers[i];
    var retryNum = (tracker.retryCount || 0) + 1;
    console.log('[Retry] #' + tracker.id + ' attempt ' + retryNum + '/' + MAX_RETRIES + ' — ' + (tracker.productName || '').substring(0, 50));

    try {
      var checkResult = await checkSingleTracker(pool, tracker, settings, noopCollector);
      retried++;
      if (checkResult !== 'error' && checkResult !== 'waf_blocked') {
        fixed++;
        console.log('[Retry] #' + tracker.id + ' ✅ Recovered! Status: ' + checkResult);
      } else {
        console.log('[Retry] #' + tracker.id + ' ❌ Still failing (retry ' + retryNum + '/' + MAX_RETRIES + ')');
      }
    } catch (err) {
      console.error('[Retry] #' + tracker.id + ' ❌ Error: ' + err.message);
      retried++;
    }

    // Delay between retries to avoid WAF
    if (i < trackers.length - 1) {
      await new Promise(function(r) { setTimeout(r, RETRY_DELAY_BETWEEN_MS); });
    }
  }

  // Close browser after retry batch
  try { await scraper.closeBrowser(); } catch (_) {}

  console.log('[Retry] Done: ' + retried + ' retried, ' + fixed + ' recovered');
  isRetrying = false;
}

/**
 * Trigger a manual check cycle (e.g. from API endpoint).
 * Returns immediately if a cycle is already running.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Object>}
 */
async function triggerManualCheck(pool) {
  if (isRunning) {
    console.log('[Scheduler] ⚠ Manual trigger skipped — cycle already running.');
    return { skipped: true, startedAt: lastRunAt };
  }

  console.log('[Scheduler] 🔄 Manual check triggered.');
  isRunning = true;
  cancelRequested = false;
  lastRunAt = new Date().toISOString();

  try {
    lastResult = await runCheckCycle(pool, function() { return cancelRequested; });
    if (cancelRequested) {
      lastResult = Object.assign({}, lastResult, { cancelled: true });
      console.log('[Scheduler] ⛔ Manual check was cancelled.');
    } else {
      console.log('[Scheduler] ✅ Manual check completed:', JSON.stringify(lastResult));
    }
    return lastResult;
  } catch (err) {
    lastResult = { error: err.message };
    console.error('[Scheduler] ❌ Manual check failed:', err.message);
    throw err;
  } finally {
    isRunning = false;
    cancelRequested = false;
  }
}

/**
 * Request cancellation of the currently running check cycle.
 * @returns {boolean} true if a cycle was running and cancel was requested
 */
function requestCancel() {
  if (!isRunning) return false;
  cancelRequested = true;
  console.log('[Scheduler] ⛔ Cancel requested.');
  return true;
}

/**
 * Check if a check cycle is currently running.
 * @returns {boolean}
 */
function getIsRunning() {
  return isRunning;
}

/**
 * Get scheduler status info for the status endpoint.
 * @returns {Object}
 */
function getStatus() {
  return {
    running: isRunning,
    retrying: isRetrying,
    lastRunAt: lastRunAt,
    lastResult: lastResult,
    schedulerActive: scheduledTask !== null,
    retryTimerActive: retryInterval !== null,
  };
}

module.exports = { start, stop, triggerManualCheck, requestCancel, getIsRunning, getStatus };

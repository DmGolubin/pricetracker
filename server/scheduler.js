/**
 * Scheduler — cron-based price check scheduler.
 *
 * Runs price checks at configurable intervals using node-cron.
 * Default: every 3 hours (cron: "0 0,3,6,9,12,15,18,21 * * *").
 *
 * Also exposes functions to start/stop the scheduler and trigger manual checks.
 */

const cron = require('node-cron');
const { runCheckCycle } = require('./serverPriceChecker');

let scheduledTask = null;
let isRunning = false;
let lastRunAt = null;
let lastResult = null;
let cancelRequested = false;

// Default cron: every 3 hours
const DEFAULT_CRON = '0 */3 * * *';

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
  console.log('[Scheduler] ═══════════════════════════════════════');

  scheduledTask = cron.schedule(expr, async () => {
    if (isRunning) {
      console.log('[Scheduler] ⚠ Previous check cycle still running, skipping this tick.');
      return;
    }

    console.log('[Scheduler] ⏰ Cron tick — starting check cycle...');
    isRunning = true;
    cancelRequested = false;
    lastRunAt = new Date().toISOString();

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
}

/**
 * Stop the cron scheduler.
 */
function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[Scheduler] Stopped.');
  }
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
    lastRunAt: lastRunAt,
    lastResult: lastResult,
    schedulerActive: scheduledTask !== null,
  };
}

module.exports = { start, stop, triggerManualCheck, requestCancel, getIsRunning, getStatus };

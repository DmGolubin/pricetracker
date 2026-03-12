/**
 * Scheduler — cron-based price check scheduler.
 *
 * Runs price checks at configurable intervals using node-cron.
 * Default: every 3 hours.
 *
 * Also exposes functions to start/stop the scheduler and trigger manual checks.
 */

const cron = require('node-cron');
const { runCheckCycle } = require('./serverPriceChecker');

let scheduledTask = null;
let isRunning = false;

/**
 * Start the cron scheduler.
 * @param {import('pg').Pool} pool — PostgreSQL connection pool
 * @param {string} [cronExpression='0 */3 * * *'] — cron expression (default: every 3 hours)
 */
function start(pool, cronExpression = '0 */3 * * *') {
  if (scheduledTask) {
    console.log('[Scheduler] Already running, stopping previous task...');
    scheduledTask.stop();
  }

  console.log(`[Scheduler] Starting with cron: "${cronExpression}"`);

  scheduledTask = cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log('[Scheduler] Previous check cycle still running, skipping...');
      return;
    }

    isRunning = true;
    try {
      await runCheckCycle(pool);
    } catch (err) {
      console.error('[Scheduler] Check cycle failed:', err);
    } finally {
      isRunning = false;
    }
  });

  console.log('[Scheduler] Cron scheduled. Next checks will run automatically.');
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
 * @returns {Promise<{checked: number, changed: number, errors: number}|{skipped: true}>}
 */
async function triggerManualCheck(pool) {
  if (isRunning) {
    console.log('[Scheduler] Check cycle already running, skipping manual trigger.');
    return { skipped: true };
  }

  isRunning = true;
  try {
    return await runCheckCycle(pool);
  } finally {
    isRunning = false;
  }
}

/**
 * Check if a check cycle is currently running.
 * @returns {boolean}
 */
function getIsRunning() {
  return isRunning;
}

module.exports = { start, stop, triggerManualCheck, getIsRunning };

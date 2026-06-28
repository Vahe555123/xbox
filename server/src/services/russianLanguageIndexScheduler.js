const config = require('../config');
const logger = require('../utils/logger');
const russianLanguageIndexService = require('./russianLanguageIndexService');

const CONTINUATION_DELAY_MS = 15_000;
// When a pass resolves nothing (e.g. Xbox throttled the burst of store fetches),
// back off longer before retrying and give up after a few empty passes so we don't
// hammer the upstream. The next scheduled run will pick it up later.
const STALLED_DELAY_MS = 5 * 60_000;
const MAX_STALLED_PASSES = 3;

let intervalMs = Math.max(1, config.russianIndex.refreshIntervalHours) * 60 * 60 * 1000;
let timer = null;
let continuationTimer = null;
let stalledPasses = 0;

function getState() {
  return {
    ...russianLanguageIndexService.getState(),
    intervalMs,
    intervalHours: intervalMs / (60 * 60 * 1000),
  };
}

function scheduleContinuation(opts, delayMs = CONTINUATION_DELAY_MS) {
  if (continuationTimer) return;
  continuationTimer = setTimeout(() => {
    continuationTimer = null;
    runBuild(opts).catch(() => {});
  }, delayMs);
}

// Run one build pass, then keep chaining passes until the index is complete (the
// first build store-fetches thousands of games and is capped per pass, so it
// finishes across several automatic passes without waiting for the next cycle).
async function runBuild({ trigger = 'scheduled', deep = false } = {}) {
  const result = await russianLanguageIndexService.buildIndex({ trigger, deep }).catch((err) => {
    logger.error('[RussianIndexScheduler] Build failed', { message: err.message });
    return null;
  });

  if (result?.success && !result.complete && result.pending > 0) {
    if (result.newlyResolved > 0) {
      // Made progress — reset the stall counter and continue promptly.
      stalledPasses = 0;
      scheduleContinuation({ trigger: 'continuation' });
    } else if (stalledPasses < MAX_STALLED_PASSES) {
      // Resolved nothing (likely upstream throttling) — back off and retry a few times.
      stalledPasses += 1;
      logger.warn(`[RussianIndexScheduler] Pass resolved 0 games (${result.pending} pending). Backing off ${STALLED_DELAY_MS / 60000}m — stalled pass ${stalledPasses}/${MAX_STALLED_PASSES}`);
      scheduleContinuation({ trigger: 'continuation' }, STALLED_DELAY_MS);
    } else {
      stalledPasses = 0;
      logger.warn(`[RussianIndexScheduler] ${MAX_STALLED_PASSES} passes in a row resolved nothing (${result.pending} pending). Giving up until the next scheduled run.`);
    }
  } else {
    stalledPasses = 0;
  }
  return result;
}

async function runNow({ deep = false } = {}) {
  return runBuild({ trigger: 'manual', deep });
}

function start() {
  // Build shortly after boot if the index is empty or was left unfinished, then
  // refresh on the configured interval.
  setTimeout(async () => {
    await russianLanguageIndexService.loadIndex().catch(() => {});
    if (!russianLanguageIndexService.isReady() || !russianLanguageIndexService.isComplete()) {
      runBuild({ trigger: 'boot' }).catch(() => {});
    }
    timer = setInterval(() => { runBuild({ trigger: 'scheduled' }).catch(() => {}); }, intervalMs);
  }, 60_000);
  logger.info(`[RussianIndexScheduler] Started with ${intervalMs / 3600000}h interval`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (continuationTimer) { clearTimeout(continuationTimer); continuationTimer = null; }
}

module.exports = { getState, runNow, start, stop };

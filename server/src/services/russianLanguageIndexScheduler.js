const config = require('../config');
const logger = require('../utils/logger');
const russianLanguageIndexService = require('./russianLanguageIndexService');

const CONTINUATION_DELAY_MS = 15_000;

let intervalMs = Math.max(1, config.russianIndex.refreshIntervalHours) * 60 * 60 * 1000;
let timer = null;
let continuationTimer = null;

function getState() {
  return {
    ...russianLanguageIndexService.getState(),
    intervalMs,
    intervalHours: intervalMs / (60 * 60 * 1000),
  };
}

function scheduleContinuation(opts) {
  if (continuationTimer) return;
  continuationTimer = setTimeout(() => {
    continuationTimer = null;
    runBuild(opts).catch(() => {});
  }, CONTINUATION_DELAY_MS);
}

// Run one build pass, then keep chaining passes until the index is complete (the
// first build store-fetches thousands of games and is capped per pass, so it
// finishes across several automatic passes without waiting for the next cycle).
async function runBuild({ trigger = 'scheduled', deep = false } = {}) {
  const result = await russianLanguageIndexService.buildIndex({ trigger, deep }).catch((err) => {
    logger.error('[RussianIndexScheduler] Build failed', { message: err.message });
    return null;
  });

  if (result?.success && !result.complete && result.newlyResolved > 0) {
    scheduleContinuation({ trigger: 'continuation' });
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

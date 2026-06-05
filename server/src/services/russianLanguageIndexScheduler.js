const config = require('../config');
const logger = require('../utils/logger');
const russianLanguageIndexService = require('./russianLanguageIndexService');

let intervalMs = Math.max(1, config.russianIndex.refreshIntervalHours) * 60 * 60 * 1000;
let timer = null;

function getState() {
  return {
    ...russianLanguageIndexService.getState(),
    intervalMs,
    intervalHours: intervalMs / (60 * 60 * 1000),
  };
}

async function runNow({ deep = false } = {}) {
  return russianLanguageIndexService.buildIndex({ trigger: 'manual', deep });
}

async function tick() {
  try {
    await russianLanguageIndexService.buildIndex({ trigger: 'scheduled' });
  } catch (err) {
    logger.error('[RussianIndexScheduler] Scheduled build failed', { message: err.message });
  }
}

function start() {
  // Build shortly after boot if the index is empty, then on the configured interval.
  setTimeout(async () => {
    await russianLanguageIndexService.loadIndex().catch(() => {});
    if (!russianLanguageIndexService.isReady()) {
      tick();
    }
    timer = setInterval(tick, intervalMs);
  }, 60_000);
  logger.info(`[RussianIndexScheduler] Started with ${intervalMs / 3600000}h interval`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, runNow, start, stop };

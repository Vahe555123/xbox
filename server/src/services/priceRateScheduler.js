const logger = require('../utils/logger');
const digisellerService = require('./digisellerService');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MODES = ['oplata', 'key_activation'];

let timer = null;
let lastRunAt = null;
let lastRunStatus = null;
let isRunning = false;

function getState() {
  return {
    intervalMs: INTERVAL_MS,
    intervalHours: INTERVAL_MS / (60 * 60 * 1000),
    lastRunAt,
    lastRunStatus,
    isRunning,
    nextRunAt: lastRunAt
      ? new Date(new Date(lastRunAt).getTime() + INTERVAL_MS).toISOString()
      : null,
  };
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  lastRunAt = new Date().toISOString();
  try {
    await Promise.all(
      MODES.map((mode) =>
        digisellerService.refreshPriceRateTable({ mode }).catch((err) => {
          logger.error(`[PriceRateScheduler] Refresh failed for mode=${mode}`, { message: err.message });
        }),
      ),
    );
    lastRunStatus = 'success';
    logger.info('[PriceRateScheduler] Rates refreshed', { modes: MODES });
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[PriceRateScheduler] Tick failed', { message: err.message });
  } finally {
    isRunning = false;
  }
}

async function runNow() {
  if (isRunning) return { alreadyRunning: true };
  await tick();
  return { success: lastRunStatus === 'success', state: getState() };
}

function start() {
  setTimeout(() => {
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  }, 15_000);
  logger.info(`[PriceRateScheduler] Started, interval=1h`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, runNow, start, stop };

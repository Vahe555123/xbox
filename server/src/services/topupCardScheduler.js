const logger = require('../utils/logger');
const topupCardService = require('./topupCardService');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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
    const result = await topupCardService.refreshCards();
    lastRunStatus = 'success';
    logger.info('[TopupCardScheduler] Cards refreshed', {
      parsed: result.parsedCount,
      updated: result.updatedCount,
    });
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[TopupCardScheduler] Refresh failed', { message: err.message });
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
  }, 30_000);
  logger.info('[TopupCardScheduler] Started, interval=1h');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, runNow, start, stop };

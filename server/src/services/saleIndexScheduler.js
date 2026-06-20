const logger = require('../utils/logger');
const saleIndexService = require('./saleIndexService');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer = null;
let lastRunAt = null;
let lastRunStatus = null;
let isRunning = false;

function getState() {
  return {
    intervalMs: INTERVAL_MS,
    intervalHours: 1,
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
    await saleIndexService.refreshSaleProducts();
    lastRunStatus = 'success';
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[SaleIndexScheduler] Tick failed', { message: err.message });
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
  // Delay first run so other schedulers (rates, topup) start first
  setTimeout(() => {
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  }, 60_000);
  logger.info('[SaleIndexScheduler] Started, interval=1h, first run in 60s');
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, runNow, start, stop };

const logger = require('../utils/logger');
const saleIndexService = require('./saleIndexService');

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let timer = null;
let lastRunAt = null;
let lastRunStatus = null;
let isRunning = false;
let cancelRequested = false;

// Live snapshot of the currently running scan (or the last finished one).
let liveProgress = null;
let liveLog = [];

function getState() {
  return {
    intervalMs: INTERVAL_MS,
    intervalHours: 1,
    lastRunAt,
    lastRunStatus,
    isRunning,
    cancelRequested,
    timerActive: Boolean(timer),
    nextRunAt: timer && lastRunAt
      ? new Date(new Date(lastRunAt).getTime() + INTERVAL_MS).toISOString()
      : null,
    progress: liveProgress,
    log: liveLog,
  };
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  cancelRequested = false;
  lastRunAt = new Date().toISOString();
  liveProgress = null;
  liveLog = [];
  try {
    const result = await saleIndexService.refreshSaleProducts({
      onProgress: ({ progress, log }) => {
        liveProgress = progress;
        liveLog = log;
      },
      shouldCancel: () => cancelRequested,
    });
    lastRunStatus = result?.status === 'cancelled' ? 'cancelled' : 'success';
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[SaleIndexScheduler] Tick failed', { message: err.message });
  } finally {
    isRunning = false;
    cancelRequested = false;
  }
}

async function runNow() {
  if (isRunning) return { alreadyRunning: true };
  await tick();
  return { success: lastRunStatus === 'success', state: getState() };
}

// Cancel the scan that is currently running (no-op if idle).
function cancel() {
  if (!isRunning) return { running: false };
  cancelRequested = true;
  logger.info('[SaleIndexScheduler] Cancel requested');
  return { running: true, cancelRequested: true };
}

function start() {
  // Delay first run so other schedulers (rates, topup) start first
  setTimeout(() => {
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  }, 60_000);
  logger.info('[SaleIndexScheduler] Started, interval=1h, first run in 60s');
}

// Stop the automatic hourly timer (does not abort an in-progress scan).
function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, runNow, cancel, start, stop };

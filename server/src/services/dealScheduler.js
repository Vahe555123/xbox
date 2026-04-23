const config = require('../config');
const logger = require('../utils/logger');
const { runDealNotifications } = require('./dealNotifierService');

let intervalMs = (config.admin.dealCheckIntervalHours || 24) * 60 * 60 * 1000;
let timer = null;
let lastRunAt = null;
let lastRunStatus = null;
let isRunning = false;

function getState() {
  return {
    intervalMs,
    intervalHours: intervalMs / (60 * 60 * 1000),
    lastRunAt,
    lastRunStatus,
    isRunning,
    nextRunAt: lastRunAt ? new Date(new Date(lastRunAt).getTime() + intervalMs).toISOString() : null,
  };
}

function setInterval_(newMs) {
  if (newMs < 60_000) newMs = 60_000; // minimum 1 minute
  intervalMs = newMs;
  // Restart the timer with the new interval
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, intervalMs);
  }
  logger.info(`[DealScheduler] Interval updated to ${intervalMs / 3600000}h`);
}

async function runNow() {
  if (isRunning) {
    return { alreadyRunning: true };
  }
  isRunning = true;
  lastRunAt = new Date().toISOString();
  try {
    const report = await runDealNotifications();
    lastRunStatus = report?.status || 'success';
    return { success: report?.status !== 'failed', report };
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[DealScheduler] Manual run failed', { message: err.message });
    throw err;
  } finally {
    isRunning = false;
  }
}

async function tick() {
  if (isRunning) return;
  isRunning = true;
  lastRunAt = new Date().toISOString();
  try {
    const report = await runDealNotifications();
    lastRunStatus = report?.status || 'success';
  } catch (err) {
    lastRunStatus = `error: ${err.message}`;
    logger.error('[DealScheduler] Scheduled run failed', { message: err.message });
  } finally {
    isRunning = false;
  }
}

function start() {
  // Initial run after 30s
  setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
  }, 30_000);
  logger.info(`[DealScheduler] Started with ${intervalMs / 3600000}h interval`);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { getState, setInterval: setInterval_, runNow, start, stop };

const logger = require('../utils/logger');
const collectionsService = require('./collectionsService');

const TICK_MS = 60 * 1000; // check the clock every minute
let timer = null;
let lastFiredDay = null; // 'YYYY-MM-DD' guard so we fire at most once per day

function todayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function tick() {
  let schedule;
  try {
    schedule = await collectionsService.getSchedule();
  } catch (err) {
    logger.warn('[CollectionsScheduler] Failed to read schedule', { message: err.message });
    return;
  }
  if (!schedule.enabled) return;

  const now = new Date();
  const dayKey = todayKey(now);
  if (lastFiredDay === dayKey) return; // already ran today

  if (now.getHours() === schedule.hour && now.getMinutes() === schedule.minute) {
    lastFiredDay = dayKey;
    runBuild({ trigger: 'scheduled' }).catch(() => {});
  }
}

async function runBuild({ trigger = 'scheduled' } = {}) {
  return collectionsService.refreshSnapshots({ trigger }).catch((err) => {
    logger.error('[CollectionsScheduler] Refresh failed', { message: err.message });
    return null;
  });
}

async function runNow() {
  return runBuild({ trigger: 'manual' });
}

function start() {
  // Refresh shortly after boot if snapshots are empty, then check the clock
  // every minute and fire once per day at the configured HH:MM.
  setTimeout(async () => {
    const state = await collectionsService.getRefreshState().catch(() => null);
    if (state && !state.lastRunAt) {
      runBuild({ trigger: 'boot' }).catch(() => {});
    }
    timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  }, 90_000);
  logger.info('[CollectionsScheduler] Started (daily refresh)');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function getState() {
  return collectionsService.getRefreshState();
}

module.exports = { start, stop, runNow, getState };

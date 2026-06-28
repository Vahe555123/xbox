/**
 * Persisted settings for the russian-language index build:
 *  - batchSize   how many store pages to fetch before pausing
 *  - pauseMs     how long to pause between batches (ban avoidance)
 *  - proxyEnabled route store fetches through the proxy pool; when on and no
 *                live proxy is available the build stops instead of using the
 *                server IP directly.
 *
 * Stored as a single JSON row in site_content.
 */
const pool = require('../db/pool');

const KEY = 'language-index-settings';

const DEFAULTS = {
  batchSize: 50,
  pauseMs: 10_000,
  proxyEnabled: false,
};

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    batchSize: clampInt(data.batchSize, 1, 1000, DEFAULTS.batchSize),
    pauseMs: clampInt(data.pauseMs, 0, 600_000, DEFAULTS.pauseMs),
    proxyEnabled: Boolean(data.proxyEnabled),
  };
}

async function getSettings() {
  try {
    const { rows } = await pool.query('SELECT data FROM site_content WHERE key = $1', [KEY]);
    return normalize(rows[0]?.data);
  } catch {
    return { ...DEFAULTS };
  }
}

async function updateSettings(patch = {}) {
  const current = await getSettings();
  const next = normalize({ ...current, ...patch });
  await pool.query(
    `INSERT INTO site_content (key, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [KEY, next],
  );
  return next;
}

module.exports = { getSettings, updateSettings, DEFAULTS };

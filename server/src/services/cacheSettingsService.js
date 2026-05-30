const pool = require('../db/pool');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const CACHE_SETTINGS_KEY = 'cache-settings';
const DEFAULT_CACHE_SETTINGS = Object.freeze({
  ttl: Math.max(1, Number(config.cache.ttl) || 300),
  mainCatalogTtl: Math.max(1, Number(config.cache.mainCatalogTtl) || 900),
});

let currentSettings = { ...DEFAULT_CACHE_SETTINGS };
let initialized = false;

function normalizePositiveInt(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

function normalizeSettings(payload = {}, fallback = DEFAULT_CACHE_SETTINGS) {
  return {
    ttl: normalizePositiveInt(payload.ttl, 'ttl', fallback.ttl),
    mainCatalogTtl: normalizePositiveInt(payload.mainCatalogTtl, 'mainCatalogTtl', fallback.mainCatalogTtl),
  };
}

function applyRuntimeSettings(settings) {
  currentSettings = normalizeSettings(settings, currentSettings);
  config.cache.ttl = currentSettings.ttl;
  config.cache.mainCatalogTtl = currentSettings.mainCatalogTtl;
  initialized = true;
  return { ...currentSettings };
}

async function initCacheSettings() {
  if (initialized) {
    return { ...currentSettings };
  }

  const { rows } = await pool.query(
    'SELECT data FROM site_content WHERE key = $1',
    [CACHE_SETTINGS_KEY],
  );

  if (!rows[0]?.data || typeof rows[0].data !== 'object') {
    return applyRuntimeSettings(DEFAULT_CACHE_SETTINGS);
  }

  try {
    return applyRuntimeSettings(normalizeSettings(rows[0].data, DEFAULT_CACHE_SETTINGS));
  } catch (err) {
    logger.warn('Invalid cache settings in storage, using defaults', { message: err.message });
    return applyRuntimeSettings(DEFAULT_CACHE_SETTINGS);
  }
}

async function getCacheSettings() {
  const settings = await initCacheSettings();
  return {
    ...settings,
    entries: cache.size,
  };
}

async function updateCacheSettings(payload = {}) {
  await initCacheSettings();
  const nextSettings = normalizeSettings(payload, currentSettings);

  const { rows } = await pool.query(
    `INSERT INTO site_content (key, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET
       data = EXCLUDED.data,
       updated_at = NOW()
     RETURNING data`,
    [CACHE_SETTINGS_KEY, nextSettings],
  );

  return {
    ...applyRuntimeSettings(rows[0]?.data || nextSettings),
    entries: cache.size,
  };
}

function clearApplicationCache() {
  const sizeBefore = cache.size;
  cache.clear();

  return {
    cleared: true,
    sizeBefore,
    sizeAfter: cache.size,
  };
}

module.exports = {
  clearApplicationCache,
  getCacheSettings,
  initCacheSettings,
  updateCacheSettings,
};

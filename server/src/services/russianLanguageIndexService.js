const pool = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');
const catalogService = require('./xboxCatalogService');
const { mapProducts } = require('../mappers/productMapper');
const { getStorePageProductData, getCachedLanguageInfo } = require('./xboxStorePageService');

/**
 * Precomputed index of games that support the Russian language.
 *
 * The Xbox display catalog's language list is unreliable (it reports Russian even
 * for games that have no Russian in-game), so the only trustworthy signal is the
 * per-game xbox.com store page — which is far too slow to fetch live. Instead we
 * build the index in the background (a couple of times per day, or on demand from
 * the admin panel) and serve language-filtered browse pages straight from it —
 * fast and with an exact total count.
 *
 * To keep scheduled rebuilds cheap we persist the resolved mode for every scanned
 * game and reuse it; only games we have not classified yet are fetched. A "deep"
 * rebuild (admin button) re-fetches everything to catch language changes.
 *
 * Persisted in `site_content` under `russian-language-index`:
 *   {
 *     builtAt, durationMs, trigger,
 *     modes: { productId: 'full_ru' | 'ru_subtitles' | 'no_ru' }  // all classified games
 *     russian: [productId...]   // games with Russian, catalog order (serving)
 *     fullRu:  [productId...]   // subset with Russian audio, catalog order (serving)
 *     counts: { scanned, russian, fullRu, subtitles, storeFetches }
 *   }
 */
const INDEX_KEY = 'russian-language-index';

const state = {
  index: null,
  russianSet: new Set(),
  fullSet: new Set(),
  loaded: false,
  building: false,
  lastRunAt: null,
  lastDurationMs: null,
  lastTrigger: null,
  lastError: null,
};

function setIndex(index) {
  state.index = index;
  state.russianSet = new Set(index.russian);
  state.fullSet = new Set(index.fullRu);
  state.loaded = true;
}

function emptyIndex() {
  return {
    builtAt: null,
    durationMs: null,
    trigger: null,
    modes: {},
    russian: [],
    fullRu: [],
    counts: { scanned: 0, russian: 0, fullRu: 0, subtitles: 0, storeFetches: 0 },
  };
}

function normalizeId(id) {
  return String(id || '').trim().toUpperCase();
}

async function loadIndex() {
  if (state.loaded && state.index) return state.index;

  try {
    const { rows } = await pool.query('SELECT data FROM site_content WHERE key = $1', [INDEX_KEY]);
    const data = rows[0]?.data;
    if (data && typeof data === 'object' && Array.isArray(data.russian)) {
      setIndex({
        ...emptyIndex(),
        ...data,
        modes: data.modes && typeof data.modes === 'object' ? data.modes : {},
        russian: data.russian.map(normalizeId).filter(Boolean),
        fullRu: (data.fullRu || []).map(normalizeId).filter(Boolean),
      });
    } else {
      setIndex(emptyIndex());
    }
  } catch (err) {
    logger.warn('Failed to load Russian language index', { message: err.message });
    setIndex(emptyIndex());
  }

  return state.index;
}

async function persistIndex(index) {
  await pool.query(
    `INSERT INTO site_content (key, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [INDEX_KEY, index],
  );
  setIndex(index);
}

function getState() {
  const index = state.index || emptyIndex();
  return {
    isBuilding: state.building,
    builtAt: index.builtAt,
    durationMs: index.durationMs,
    lastRunAt: state.lastRunAt,
    lastTrigger: state.lastTrigger,
    lastError: state.lastError,
    refreshIntervalHours: config.russianIndex.refreshIntervalHours,
    counts: index.counts || emptyIndex().counts,
  };
}

function isReady() {
  return Boolean(state.index && state.index.russian && state.index.russian.length > 0);
}

/**
 * Ordered list of product IDs matching the requested language modes.
 * - 'full_ru'      -> games with Russian audio
 * - 'ru_subtitles' -> games with any Russian (subtitles or audio)
 */
function getServingIds(modes) {
  const index = state.index;
  if (!index || !index.russian.length) return [];

  const set = modes instanceof Set ? modes : new Set(modes || []);
  const wantsAnyRussian = set.has('ru_subtitles');
  const wantsFull = set.has('full_ru');

  if (wantsAnyRussian || (wantsFull && wantsAnyRussian)) {
    return index.russian;
  }
  if (wantsFull) {
    const fullSet = new Set(index.fullRu);
    return index.russian.filter((id) => fullSet.has(id));
  }
  return [];
}

function getModeForProduct(productId) {
  const id = normalizeId(productId);
  if (!id) return null;
  if (state.fullSet.has(id)) return 'full_ru';
  if (state.russianSet.has(id)) return 'ru_subtitles';
  return null;
}

async function walkCatalog() {
  const products = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  let encodedCT = '';
  let pages = 0;

  do {
    const raw = await catalogService.browseGames({
      encodedFilters: '',
      encodedCT,
      // Match the main browse request on the first page so we reuse (and don't
      // clobber) the shared `browse:::` cache entry, which carries the filters.
      returnFilters: encodedCT === '',
      channelId: '',
    });

    for (const mapped of mapProducts(raw.products || [])) {
      const id = normalizeId(mapped.id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      products.push({ id, title: mapped.title, storeUrl: mapped.storeUrl });
    }

    pages += 1;
    encodedCT = raw.encodedCT || '';
    if (!encodedCT || seenTokens.has(encodedCT)) break;
    seenTokens.add(encodedCT);
  } while (pages < config.russianIndex.maxBrowsePages);

  logger.info('[RussianIndex] Catalog walk complete', { pages, products: products.length });
  return products;
}

function normalizeMode(mode) {
  if (mode === 'full_ru' || mode === 'ru_subtitles' || mode === 'no_ru') return mode;
  return 'no_ru'; // 'unknown'/missing -> treat as not Russian for the index
}

async function loadOverrideModes() {
  try {
    const { rows } = await pool.query(
      `SELECT product_id, russian_language_mode
       FROM product_overrides
       WHERE russian_language_mode IS NOT NULL AND russian_language_mode <> 'auto'`,
    );
    const map = new Map();
    for (const row of rows) {
      map.set(normalizeId(row.product_id), normalizeMode(row.russian_language_mode));
    }
    return map;
  } catch (err) {
    logger.warn('[RussianIndex] Failed to load override modes', { message: err.message });
    return new Map();
  }
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  const size = Math.max(1, limit);

  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, runner));
}

/**
 * Resolve a Russian-language mode for every walked game.
 * Reuses previously persisted modes (and admin overrides) so only unclassified
 * games trigger a store-page fetch; the per-build fetch count is capped.
 */
async function classifyProducts(walked, { deep }) {
  const prevModes = (state.index && state.index.modes) || {};
  const overrideModes = await loadOverrideModes();
  const resolved = new Map();
  const needFetch = [];

  for (const product of walked) {
    if (overrideModes.has(product.id)) {
      resolved.set(product.id, overrideModes.get(product.id));
      continue;
    }
    const cached = getCachedLanguageInfo(product.id);
    if (cached) {
      resolved.set(product.id, normalizeMode(cached.russianLanguageMode));
      continue;
    }
    if (!deep && prevModes[product.id]) {
      resolved.set(product.id, normalizeMode(prevModes[product.id]));
      continue;
    }
    needFetch.push(product);
  }

  let storeFetches = 0;
  const fetchTargets = needFetch.slice(0, config.russianIndex.maxStoreFetches);
  await runWithConcurrency(fetchTargets, config.russianIndex.storeFetchConcurrency, async (product) => {
    if (!product.storeUrl) return;
    try {
      const data = await getStorePageProductData({
        productId: product.id,
        storeUrl: product.storeUrl,
        languageOnly: true,
      });
      storeFetches += 1;
      resolved.set(product.id, normalizeMode(data?.languageInfo?.russianLanguageMode));
    } catch (err) {
      logger.debug('[RussianIndex] Store fetch failed', { productId: product.id, message: err.message });
    }
  });

  return { resolved, storeFetches, pending: Math.max(0, needFetch.length - fetchTargets.length) };
}

async function buildIndex({ trigger = 'manual', deep = false } = {}) {
  if (state.building) {
    return { alreadyRunning: true, ...getState() };
  }

  state.building = true;
  state.lastRunAt = new Date().toISOString();
  state.lastTrigger = trigger;
  state.lastError = null;
  const startedAt = Date.now();
  logger.info('[RussianIndex] Build started', { trigger, deep });

  try {
    await loadIndex();
    const walked = await walkCatalog();
    const { resolved, storeFetches, pending } = await classifyProducts(walked, { deep });

    const modes = {};
    const russian = [];
    const fullRu = [];
    for (const product of walked) {
      const mode = resolved.get(product.id);
      if (!mode) continue; // unresolved (beyond per-build cap) -> retried next build
      modes[product.id] = mode;
      if (mode === 'full_ru') {
        russian.push(product.id);
        fullRu.push(product.id);
      } else if (mode === 'ru_subtitles') {
        russian.push(product.id);
      }
    }

    const durationMs = Date.now() - startedAt;
    const index = {
      builtAt: new Date().toISOString(),
      durationMs,
      trigger,
      modes,
      russian,
      fullRu,
      counts: {
        scanned: walked.length,
        russian: russian.length,
        fullRu: fullRu.length,
        subtitles: russian.length - fullRu.length,
        storeFetches,
        pending,
      },
    };

    await persistIndex(index);
    logger.info('[RussianIndex] Build finished', { ...index.counts, durationMs });
    return { success: true, ...getState() };
  } catch (err) {
    state.lastError = err.message;
    logger.error('[RussianIndex] Build failed', { message: err.message, stack: err.stack });
    throw err;
  } finally {
    state.building = false;
  }
}

module.exports = {
  loadIndex,
  buildIndex,
  getState,
  isReady,
  getServingIds,
  getModeForProduct,
};

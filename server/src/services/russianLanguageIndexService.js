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
 * build the index in the background and serve language-filtered browse pages
 * straight from it — fast, with an exact total count.
 *
 * The build can take a while (it store-fetches thousands of games), so it:
 *  - reports live progress + a log buffer (shown in the admin panel),
 *  - persists checkpoints periodically, so a restart never loses progress and the
 *    (partial) index is immediately usable,
 *  - reuses previously classified modes, so it resumes where it left off and only
 *    fetches games it has not seen yet. A "deep" rebuild re-fetches everything.
 *
 * Persisted in `site_content` under `russian-language-index`:
 *   {
 *     builtAt, durationMs, trigger, complete,
 *     modes: { productId: 'full_ru' | 'ru_subtitles' | 'no_ru' | 'unknown' },  // all classified games
 *     russian: [productId...],   // games with Russian, catalog order (serving)
 *     fullRu:  [productId...],    // subset with Russian audio, catalog order (serving)
 *     counts: { scanned, russian, fullRu, subtitles, storeFetches, pending }
 *   }
 */
const INDEX_KEY = 'russian-language-index';
const CHECKPOINT_MS = 20_000;
const MAX_LOGS = 50;
// Reuse the walked list from the last run if it's younger than this (skip re-walk).
const WALK_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const state = {
  index: null,
  russianSet: new Set(),
  fullSet: new Set(),
  noRuSet: new Set(),
  unknownSet: new Set(),
  loaded: false,
  building: false,
  lastRunAt: null,
  lastDurationMs: null,
  lastTrigger: null,
  lastError: null,
  progress: emptyProgress(),
  logs: [],
};

function emptyProgress() {
  return {
    phase: 'idle', // idle | walking | classifying | done | error
    scanned: 0,
    total: 0,
    processed: 0,
    fetched: 0,
    russian: 0,
    fullRu: 0,
    startedAt: null,
    updatedAt: null,
  };
}

function resetProgress() {
  state.progress = { ...emptyProgress(), phase: 'starting', startedAt: Date.now(), updatedAt: Date.now() };
}

function log(message) {
  state.logs.push({ ts: new Date().toISOString(), message });
  if (state.logs.length > MAX_LOGS) state.logs.shift();
  logger.info(`[RussianIndex] ${message}`);
}

function setIndex(index) {
  state.index = index;
  state.russianSet = new Set(index.russian);
  state.fullSet = new Set(index.fullRu);
  state.noRuSet = new Set(index.noRu || []);
  state.unknownSet = new Set(index.unknown || []);
  state.loaded = true;
}

function emptyIndex() {
  return {
    builtAt: null,
    durationMs: null,
    trigger: null,
    complete: false,
    modes: {},
    russian: [],
    fullRu: [],
    noRu: [],
    unknown: [],
    counts: { scanned: 0, russian: 0, fullRu: 0, subtitles: 0, noRu: 0, unknown: 0, storeFetches: 0, pending: 0 },
    // walked cache: saved so re-runs can skip re-walking if recent
    walkedAt: null,
    walkedList: null,
  };
}

function normalizeId(id) {
  return String(id || '').trim().toUpperCase();
}

function normalizeMode(mode) {
  if (mode === 'full_ru' || mode === 'ru_subtitles' || mode === 'no_ru' || mode === 'unknown') return mode;
  return 'unknown'; // no language block at all
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
        noRu: (data.noRu || []).map(normalizeId).filter(Boolean),
        unknown: (data.unknown || []).map(normalizeId).filter(Boolean),
        walkedAt: data.walkedAt || null,
        walkedList: Array.isArray(data.walkedList) ? data.walkedList : null,
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

// Auto-load the persisted index so getState() shows correct data right after server restart.
loadIndex().catch((err) => logger.warn('[RussianIndex] Startup auto-load failed', { message: err.message }));

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
    complete: index.complete ?? false,
    lastRunAt: state.lastRunAt,
    lastTrigger: state.lastTrigger,
    lastError: state.lastError,
    refreshIntervalHours: config.russianIndex.refreshIntervalHours,
    counts: index.counts || emptyIndex().counts,
    progress: state.progress,
    logs: state.logs.slice(-30),
    walkedAt: index.walkedAt || null,
    walkedCount: Array.isArray(index.walkedList) ? index.walkedList.length : 0,
  };
}

function isReady() {
  return Boolean(state.index && state.index.russian && state.index.russian.length > 0);
}

function isComplete() {
  return Boolean(state.index && state.index.complete);
}

/**
 * Ordered list of product IDs matching the requested language modes.
 * - 'full_ru'      -> games with Russian audio only
 * - 'ru_subtitles' -> games with any Russian (subtitles or audio)
 * - 'no_ru'        -> games confirmed to have no Russian
 * - 'unknown'      -> games where language block is absent
 */
function getServingIds(modes) {
  const index = state.index;
  if (!index) return [];

  const set = modes instanceof Set ? modes : new Set(modes || []);

  if (set.has('ru_subtitles')) return index.russian || [];
  if (set.has('full_ru')) return (index.russian || []).filter((id) => state.fullSet.has(id));
  if (set.has('no_ru')) return [...(index.noRu || []), ...(index.unknown || [])];
  if (set.has('unknown')) return index.unknown || [];
  return [];
}

/**
 * Returns true if the index has enough data to serve the given language mode
 * directly (without falling back to the slow Xbox API search path).
 */
function isReadyForMode(mode) {
  if (!state.index) return false;
  if (mode === 'ru_subtitles') return state.russianSet.size > 0;
  if (mode === 'full_ru') return state.fullSet.size > 0;
  // For no_ru / unknown: the array must exist (even if empty — that means
  // "index was built with this new code and found zero such games").
  if (mode === 'no_ru') return Array.isArray(state.index.noRu);
  if (mode === 'unknown') return Array.isArray(state.index.unknown);
  return false;
}

/**
 * Returns the classified mode for a product: 'full_ru' | 'ru_subtitles' | 'no_ru',
 * or null if the index has not classified it yet. The full modes map is consulted
 * (so "no_ru" is reported), which is what makes the catalog badges accurate.
 */
function getModeForProduct(productId) {
  const id = normalizeId(productId);
  if (!id) return null;
  const modes = state.index?.modes;
  if (modes && modes[id]) return modes[id];
  if (state.fullSet.has(id)) return 'full_ru';
  if (state.russianSet.has(id)) return 'ru_subtitles';
  // Games in unknownSet but not in modes are walked-but-unresolved — also "язык не указан"
  if (state.unknownSet.has(id)) return 'unknown';
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBrowsePage(encodedCT, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await catalogService.browseGames({
        encodedFilters: '',
        encodedCT,
        // Match the main browse request on the first page so we reuse (and don't
        // clobber) the shared `browse:::` cache entry, which carries the filters.
        returnFilters: encodedCT === '',
        channelId: '',
      });
    } catch (err) {
      lastError = err;
      logger.warn('[RussianIndex] Browse page failed', { attempt, message: err.message });
      if (attempt < attempts) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function walkCatalog(onProgress) {
  const products = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  let encodedCT = '';
  let pages = 0;
  let walkComplete = false;

  do {
    let raw;
    try {
      raw = await fetchBrowsePage(encodedCT);
    } catch (err) {
      // A transient upstream error after retries: stop the walk and proceed with
      // whatever we collected. The build stays "incomplete" so it re-walks later.
      log(`Обход прерван на странице ${pages + 1} (${err.message}) — продолжаю с ${products.length} играми`);
      break;
    }

    const pageMapped = [];
    for (const mapped of mapProducts(raw.products || [])) {
      const id = normalizeId(mapped.id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      products.push({ id, title: mapped.title, storeUrl: mapped.storeUrl });
      pageMapped.push(id);
    }

    pages += 1;

    // Log the first page explicitly so any mapping/API issue is immediately visible.
    if (pages === 1) {
      logger.info('[RussianIndex] First walk page', {
        rawProductCount: (raw.products || []).length,
        mappedCount: pageMapped.length,
        hasCT: Boolean(raw.encodedCT),
      });
      if (pageMapped.length === 0) {
        log(`Страница 1 вернула 0 игр (raw: ${(raw.products || []).length}) — возможна проблема с API или маппером`);
      }
    }

    if (typeof onProgress === 'function') onProgress(products.length);
    encodedCT = raw.encodedCT || '';
    if (!encodedCT || seenTokens.has(encodedCT)) { walkComplete = true; break; }
    seenTokens.add(encodedCT);
  } while (pages < config.russianIndex.maxBrowsePages);

  if (products.length === 0) {
    log('Обход вернул 0 игр — обход каталога не удался, индекс не будет обновлён');
  }

  logger.info('[RussianIndex] Catalog walk complete', { pages, products: products.length, walkComplete });
  return { products, walkComplete };
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

function buildIndexObject({ modes, walked, trigger, durationMs, complete, storeFetches, pending }) {
  const russian = [];
  const fullRu = [];
  const noRu = [];
  const unknown = [];
  for (const product of walked) {
    const mode = modes[product.id];
    if (mode === 'full_ru') {
      russian.push(product.id);
      fullRu.push(product.id);
    } else if (mode === 'ru_subtitles') {
      russian.push(product.id);
    } else if (mode === 'no_ru') {
      noRu.push(product.id);
    } else {
      // mode === 'unknown' (Languages section confirmed absent) OR
      // mode === undefined (not yet classified) — both mean "язык не указан" to the user
      unknown.push(product.id);
    }
  }
  const confirmedUnknown = unknown.filter((id) => modes[id] === 'unknown').length;
  return {
    builtAt: new Date().toISOString(),
    durationMs,
    trigger,
    complete,
    modes,
    russian,
    fullRu,
    noRu,
    unknown,
    counts: {
      scanned: walked.length,
      russian: russian.length,
      fullRu: fullRu.length,
      subtitles: russian.length - fullRu.length,
      noRu: noRu.length,
      unknown: unknown.length,
      confirmedUnknown,
      storeFetches: storeFetches || 0,
      pending: pending || 0,
    },
  };
}

function recomputeProgressCounts(modes, walked) {
  let russian = 0;
  let fullRu = 0;
  for (const product of walked) {
    const mode = modes[product.id];
    if (mode === 'full_ru') { russian += 1; fullRu += 1; } else if (mode === 'ru_subtitles') { russian += 1; }
  }
  state.progress.russian = russian;
  state.progress.fullRu = fullRu;
}

async function buildIndex({ trigger = 'manual', deep = false } = {}) {
  if (state.building) {
    return { alreadyRunning: true, ...getState() };
  }

  state.building = true;
  state.lastRunAt = new Date().toISOString();
  state.lastTrigger = trigger;
  state.lastError = null;
  resetProgress();
  const startedAt = Date.now();
  let checkpointTimer = null;
  log(`Старт сборки${deep ? ' (полная)' : ''} · триггер: ${trigger}`);

  try {
    await loadIndex();
    const prevModes = (!deep && state.index?.modes) ? state.index.modes : {};

    // Phase 1 — walk the whole catalog (or reuse a recent cached walk).
    let walked;
    let walkComplete;

    const cachedWalk = state.index?.walkedList;
    const cachedWalkAt = state.index?.walkedAt ? new Date(state.index.walkedAt).getTime() : 0;
    const walkCacheAge = Date.now() - cachedWalkAt;
    const canReuseWalk = !deep && Array.isArray(cachedWalk) && cachedWalk.length > 0 && walkCacheAge < WALK_CACHE_TTL_MS;

    if (canReuseWalk) {
      walked = cachedWalk;
      walkComplete = true;
      state.progress.phase = 'walking';
      state.progress.scanned = walked.length;
      state.progress.total = walked.length;
      state.progress.updatedAt = Date.now();
      const ageMin = Math.round(walkCacheAge / 60000);
      log(`Обход пропущен — используем кэш (${walked.length} игр, ${ageMin} мин назад)`);
    } else {
      state.progress.phase = 'walking';
      log('Обход каталога Xbox...');
      const result = await walkCatalog((scanned) => {
        state.progress.scanned = scanned;
        state.progress.updatedAt = Date.now();
      });
      walked = result.products;
      walkComplete = result.walkComplete;
      state.progress.total = walked.length;
      log(`Каталог собран: ${walked.length} игр${walkComplete ? '' : ' (частично)'}`);
    }

    if (walked.length === 0) {
      // Nothing to classify — skip to done so we don't save an empty index
      // (prevModes already in DB are preserved from before this run).
      log('Нет игр для классификации — пропускаем сохранение пустого индекса');
      state.progress.phase = 'done';
      state.progress.updatedAt = Date.now();
      state.lastDurationMs = Date.now() - startedAt;
      return { success: false, complete: false, newlyResolved: 0, pending: 0, ...getState() };
    }

    // Save a checkpoint immediately after the walk so builtAt is set and
    // the scanned count is visible in the admin even if the server restarts
    // during the long classification phase.
    {
      const walkSnapshot = buildIndexObject({
        modes: Object.fromEntries(Object.entries(prevModes).map(([id, mode]) => [id, normalizeMode(mode)])),
        walked, trigger, durationMs: Date.now() - startedAt,
        complete: false, storeFetches: 0, pending: walked.length,
      });
      walkSnapshot.walkedAt = new Date().toISOString();
      walkSnapshot.walkedList = walked;
      await persistIndex(walkSnapshot);
      log(`Чекпоинт после обхода: ${walked.length} просканировано, начинаем классификацию`);
    }

    // Phase 2 — classify each game (reuse known modes; fetch only the unknown).
    state.progress.phase = 'classifying';
    const overrideModes = await loadOverrideModes();
    const modes = {};
    // Carry over previously classified games (even ones no longer in the catalog).
    for (const [id, mode] of Object.entries(prevModes)) modes[id] = normalizeMode(mode);
    for (const [id, mode] of overrideModes) modes[id] = mode;

    const needFetch = [];
    let reused = 0;
    for (const product of walked) {
      if (overrideModes.has(product.id)) { reused += 1; continue; }
      const cached = getCachedLanguageInfo(product.id);
      if (cached) { modes[product.id] = normalizeMode(cached.russianLanguageMode); reused += 1; continue; }
      // Always re-fetch 'unknown' games — they had no language data when last checked
      // but may have been updated since (e.g. a pre-release game that just launched).
      if (!deep && prevModes[product.id] && prevModes[product.id] !== 'unknown') { reused += 1; continue; }
      needFetch.push(product);
    }

    state.progress.processed = walked.length - needFetch.length;
    recomputeProgressCounts(modes, walked);
    log(`Переиспользовано: ${reused}, к загрузке: ${needFetch.length}`);

    const fetchTargets = needFetch.slice(0, config.russianIndex.maxStoreFetches);
    const cappedOut = needFetch.length - fetchTargets.length;
    let storeFetches = 0;
    let newlyResolved = 0;

    // Persist checkpoints so progress survives a restart and the index is usable
    // while still building.
    checkpointTimer = setInterval(() => {
      const snapshot = buildIndexObject({
        modes, walked, trigger, durationMs: Date.now() - startedAt, complete: false, storeFetches, pending: cappedOut,
      });
      snapshot.walkedAt = state.index?.walkedAt || new Date().toISOString();
      snapshot.walkedList = walked;
      persistIndex(snapshot).catch((e) => logger.warn('[RussianIndex] checkpoint failed', { message: e.message }));
      log(`Чекпоинт: ${state.progress.processed}/${walked.length} обработано · русских ${state.progress.russian}`);
    }, CHECKPOINT_MS);

    await runWithConcurrency(fetchTargets, config.russianIndex.storeFetchConcurrency, async (product) => {
      if (product.storeUrl) {
        try {
          const data = await getStorePageProductData({
            productId: product.id,
            storeUrl: product.storeUrl,
            languageOnly: true,
          });
          storeFetches += 1;
          // languageInfo is null when the page couldn't be parsed or the product wasn't
          // found in it — treat as unresolved so the next build retries it, rather than
          // incorrectly classifying it as 'unknown' (Languages section absent).
          if (data?.languageInfo != null) {
            const mode = normalizeMode(data.languageInfo.russianLanguageMode);
            modes[product.id] = mode;
            newlyResolved += 1;
            if (mode === 'full_ru') { state.progress.russian += 1; state.progress.fullRu += 1; } else if (mode === 'ru_subtitles') { state.progress.russian += 1; }
          }
        } catch (err) {
          // Leave unresolved -> retried on a later build.
          logger.debug('[RussianIndex] Store fetch failed', { productId: product.id, message: err.message });
        }
      }
      state.progress.processed += 1;
      state.progress.fetched = storeFetches;
      state.progress.updatedAt = Date.now();
    });

    clearInterval(checkpointTimer);
    checkpointTimer = null;

    const pending = cappedOut + (fetchTargets.length - newlyResolved);
    const complete = walkComplete && pending === 0;
    const durationMs = Date.now() - startedAt;
    const index = buildIndexObject({ modes, walked, trigger, durationMs, complete, storeFetches, pending });
    index.walkedAt = state.index?.walkedAt || new Date().toISOString();
    index.walkedList = walked;
    await persistIndex(index);

    state.progress.phase = 'done';
    state.progress.updatedAt = Date.now();
    state.lastDurationMs = durationMs;
    log(
      `Готово за ${Math.round(durationMs / 1000)}с · русских ${index.counts.russian} `
      + `(полностью ${index.counts.fullRu}, субтитры ${index.counts.subtitles}), загрузок ${storeFetches}`
      + `${complete ? '' : ` · осталось ${pending}, продолжу`}`,
    );
    return { success: true, complete, newlyResolved, pending, ...getState() };
  } catch (err) {
    state.lastError = err.message;
    state.progress.phase = 'error';
    log(`Ошибка: ${err.message}`);
    logger.error('[RussianIndex] Build failed', { message: err.message, stack: err.stack });
    throw err;
  } finally {
    if (checkpointTimer) clearInterval(checkpointTimer);
    state.building = false;
  }
}

module.exports = {
  loadIndex,
  buildIndex,
  getState,
  isReady,
  isComplete,
  isReadyForMode,
  getServingIds,
  getModeForProduct,
};

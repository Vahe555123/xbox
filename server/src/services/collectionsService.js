const pool = require('../db/pool');
const logger = require('../utils/logger');
const { getProductsByIds } = require('./displayCatalogService');
const { mapRelatedProducts } = require('../mappers/relatedProductMapper');
const { applyProductOverrides } = require('./productOverrideService');

const REFRESH_META_KEY = 'collections-refresh';
const DEFAULT_SCHEDULE = { hour: 4, minute: 0, enabled: true };
const SNAPSHOT_BATCH_SIZE = 20;

const refreshState = {
  running: false,
  lastRunAt: null,
  lastDurationMs: null,
  lastError: null,
  lastTrigger: null,
  counts: { products: 0, snapshots: 0, removed: 0 },
};

function normalizeProductId(productId) {
  return String(productId || '').trim().toUpperCase();
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

async function generateUniqueSlug(title, { excludeId = null } = {}) {
  const base = slugify(title) || `collection-${Date.now()}`;
  let slug = base;
  let counter = 2;
  // Append -2, -3, ... until the slug is free.
  // eslint-disable-next-line no-await-in-loop
  while (await slugExists(slug, excludeId)) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
}

async function slugExists(slug, excludeId = null) {
  const { rows } = await pool.query(
    `SELECT 1 FROM collections WHERE slug = $1 AND ($2::bigint IS NULL OR id <> $2) LIMIT 1`,
    [slug, excludeId],
  );
  return rows.length > 0;
}

function rowToCollection(row, productCount = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    sortOrder: Number(row.sort_order),
    enabled: row.enabled,
    productCount: productCount == null ? undefined : Number(productCount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCollections({ includeDisabled = true } = {}) {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(cp.product_id)::int AS product_count
     FROM collections c
     LEFT JOIN collection_products cp ON cp.collection_id = c.id
     ${includeDisabled ? '' : 'WHERE c.enabled = TRUE'}
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.id ASC`,
  );
  return rows.map((row) => rowToCollection(row, row.product_count));
}

async function getEnabledCollectionsForFilter() {
  const { rows } = await pool.query(
    `SELECT c.slug, c.title, COUNT(cp.product_id)::int AS product_count
     FROM collections c
     LEFT JOIN collection_products cp ON cp.collection_id = c.id
     WHERE c.enabled = TRUE
     GROUP BY c.id
     HAVING COUNT(cp.product_id) > 0
     ORDER BY c.sort_order ASC, c.id ASC`,
  );
  return rows.map((row) => ({ slug: row.slug, title: row.title, count: Number(row.product_count) }));
}

async function getCollection(id) {
  const { rows } = await pool.query('SELECT * FROM collections WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const collection = rowToCollection(rows[0]);
  const { rows: productRows } = await pool.query(
    `SELECT product_id, sort_order FROM collection_products
     WHERE collection_id = $1 ORDER BY sort_order ASC, product_id ASC`,
    [id],
  );
  collection.productIds = productRows.map((r) => r.product_id);
  return collection;
}

async function createCollection({ title, slug, enabled = true, sortOrder = 0 } = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('Title is required');
  const finalSlug = slug ? await generateUniqueSlug(slug) : await generateUniqueSlug(cleanTitle);
  const { rows } = await pool.query(
    `INSERT INTO collections (slug, title, enabled, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [finalSlug, cleanTitle, Boolean(enabled), Number(sortOrder) || 0],
  );
  return rowToCollection(rows[0], 0);
}

async function updateCollection(id, { title, slug, enabled, sortOrder } = {}) {
  const sets = [];
  const params = [];
  let i = 1;

  if (title !== undefined) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('Title is required');
    sets.push(`title = $${i}`); params.push(cleanTitle); i += 1;
  }
  if (slug !== undefined) {
    const finalSlug = await generateUniqueSlug(slug || title || '', { excludeId: id });
    sets.push(`slug = $${i}`); params.push(finalSlug); i += 1;
  }
  if (enabled !== undefined) { sets.push(`enabled = $${i}`); params.push(Boolean(enabled)); i += 1; }
  if (sortOrder !== undefined) { sets.push(`sort_order = $${i}`); params.push(Number(sortOrder) || 0); i += 1; }

  if (!sets.length) return getCollection(id);

  sets.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE collections SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return rows[0] ? rowToCollection(rows[0]) : null;
}

async function deleteCollection(id) {
  const { rowCount } = await pool.query('DELETE FROM collections WHERE id = $1', [id]);
  return rowCount > 0;
}

async function setCollectionProducts(id, productIds = []) {
  const ids = [...new Set((productIds || []).map(normalizeProductId).filter(Boolean))];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM collection_products WHERE collection_id = $1', [id]);
    for (let index = 0; index < ids.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO collection_products (collection_id, product_id, sort_order)
         VALUES ($1, $2, $3)`,
        [id, ids[index], index],
      );
    }
    await client.query('UPDATE collections SET updated_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return ids;
}

// Ordered product IDs of an enabled collection, by slug (serving path).
async function getCollectionProductIds(slug) {
  const { rows } = await pool.query(
    `SELECT cp.product_id
     FROM collections c
     JOIN collection_products cp ON cp.collection_id = c.id
     WHERE c.slug = $1 AND c.enabled = TRUE
     ORDER BY cp.sort_order ASC, cp.product_id ASC`,
    [slug],
  );
  return rows.map((r) => r.product_id);
}

// Read stored snapshot cards for the given product IDs. Returns a Map keyed by
// upper-cased product id.
async function getSnapshotProducts(ids) {
  const normalized = [...new Set((ids || []).map(normalizeProductId).filter(Boolean))];
  if (!normalized.length) return new Map();
  const { rows } = await pool.query(
    `SELECT product_id, data FROM collection_product_snapshots WHERE product_id = ANY($1::text[])`,
    [normalized],
  );
  const map = new Map();
  for (const row of rows) map.set(normalizeProductId(row.product_id), row.data);
  return map;
}

// Fetch + map + apply overrides for a batch of product IDs (used by the
// snapshot refresh and as a fallback for missing snapshots).
async function buildCardsForIds(ids) {
  const slice = [...new Set((ids || []).map(normalizeProductId).filter(Boolean))];
  if (!slice.length) return [];
  const cards = [];
  for (let i = 0; i < slice.length; i += SNAPSHOT_BATCH_SIZE) {
    const chunk = slice.slice(i, i + SNAPSHOT_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const raw = await getProductsByIds(chunk, { allowPartial: true, context: 'collections-refresh' })
      .catch((err) => {
        logger.warn('[Collections] Catalog fetch failed', { count: chunk.length, message: err.message });
        return [];
      });
    const mapped = mapRelatedProducts(raw, {});
    // eslint-disable-next-line no-await-in-loop
    await applyProductOverrides(mapped).catch(() => {});
    cards.push(...mapped);
  }
  return cards;
}

async function refreshSnapshots({ trigger = 'manual' } = {}) {
  if (refreshState.running) return { started: false, alreadyRunning: true };
  refreshState.running = true;
  refreshState.lastError = null;
  const startedAt = Date.now();
  try {
    const { rows } = await pool.query('SELECT DISTINCT product_id FROM collection_products');
    const ids = rows.map((r) => normalizeProductId(r.product_id)).filter(Boolean);

    const cards = await buildCardsForIds(ids);
    const cardById = new Map(cards.map((card) => [normalizeProductId(card.id), card]));

    let snapshots = 0;
    for (const id of ids) {
      const card = cardById.get(id);
      if (!card) continue;
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO collection_product_snapshots (product_id, data, refreshed_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (product_id)
         DO UPDATE SET data = EXCLUDED.data, refreshed_at = NOW()`,
        [id, JSON.stringify(card)],
      );
      snapshots += 1;
    }

    // Remove orphaned snapshots (games no longer in any collection).
    const removed = await pool.query(
      `DELETE FROM collection_product_snapshots
       WHERE product_id NOT IN (SELECT DISTINCT product_id FROM collection_products)`,
    );

    refreshState.counts = { products: ids.length, snapshots, removed: removed.rowCount };
    refreshState.lastRunAt = new Date().toISOString();
    refreshState.lastDurationMs = Date.now() - startedAt;
    refreshState.lastTrigger = trigger;

    await saveRefreshMeta();
    logger.info('[Collections] Snapshot refresh complete', refreshState.counts);
    return { started: true, ...refreshState.counts };
  } catch (err) {
    refreshState.lastError = err.message;
    logger.error('[Collections] Snapshot refresh failed', { message: err.message });
    throw err;
  } finally {
    refreshState.running = false;
  }
}

// ---- Schedule + meta persistence (site_content key 'collections-refresh') ----

async function readMeta() {
  const { rows } = await pool.query('SELECT data FROM site_content WHERE key = $1', [REFRESH_META_KEY]);
  return rows[0]?.data || {};
}

async function writeMeta(data) {
  await pool.query(
    `INSERT INTO site_content (key, data)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [REFRESH_META_KEY, JSON.stringify(data)],
  );
}

async function saveRefreshMeta() {
  const meta = await readMeta();
  meta.lastRunAt = refreshState.lastRunAt;
  meta.lastDurationMs = refreshState.lastDurationMs;
  meta.lastTrigger = refreshState.lastTrigger;
  meta.counts = refreshState.counts;
  await writeMeta(meta);
}

async function getSchedule() {
  const meta = await readMeta();
  return {
    hour: Number.isFinite(meta.hour) ? meta.hour : DEFAULT_SCHEDULE.hour,
    minute: Number.isFinite(meta.minute) ? meta.minute : DEFAULT_SCHEDULE.minute,
    enabled: meta.enabled === undefined ? DEFAULT_SCHEDULE.enabled : Boolean(meta.enabled),
  };
}

async function setSchedule({ hour, minute, enabled } = {}) {
  const meta = await readMeta();
  if (hour !== undefined) {
    const h = Number(hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('hour must be 0-23');
    meta.hour = h;
  }
  if (minute !== undefined) {
    const m = Number(minute);
    if (!Number.isInteger(m) || m < 0 || m > 59) throw new Error('minute must be 0-59');
    meta.minute = m;
  }
  if (enabled !== undefined) meta.enabled = Boolean(enabled);
  await writeMeta(meta);
  return getSchedule();
}

async function getRefreshState() {
  const schedule = await getSchedule();
  const meta = await readMeta();
  return {
    running: refreshState.running,
    schedule,
    lastRunAt: refreshState.lastRunAt || meta.lastRunAt || null,
    lastDurationMs: refreshState.lastDurationMs ?? meta.lastDurationMs ?? null,
    lastTrigger: refreshState.lastTrigger || meta.lastTrigger || null,
    lastError: refreshState.lastError,
    counts: refreshState.counts.products ? refreshState.counts : (meta.counts || refreshState.counts),
  };
}

module.exports = {
  listCollections,
  getEnabledCollectionsForFilter,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  setCollectionProducts,
  getCollectionProductIds,
  getSnapshotProducts,
  buildCardsForIds,
  refreshSnapshots,
  getSchedule,
  setSchedule,
  getRefreshState,
};

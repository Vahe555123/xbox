const pool = require('../db/pool');

const LANGUAGE_MODES = new Set(['full_ru', 'ru_subtitles', 'no_ru', 'unknown']);

function normalizeProductId(productId) {
  return String(productId || '').trim().toUpperCase();
}

function normalizeLanguageMode(mode) {
  const value = String(mode || '').trim();
  if (!value || value === 'auto') return null;
  if (!LANGUAGE_MODES.has(value)) {
    throw new Error('Invalid russianLanguageMode');
  }
  return value;
}

function rowToOverride(row) {
  if (!row) return null;
  const data = row.data || {};
  return {
    productId: row.product_id,
    title: row.title || '',
    russianLanguageMode: row.russian_language_mode || 'auto',
    languageNote: row.language_note || '',
    specialOfferUrl: row.special_offer_url || null,
    customDescription: data.customDescription || '',
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applyLanguageMode(product, mode) {
  if (!product || !mode || mode === 'auto') return product;

  const hasRussian = mode === 'full_ru' || mode === 'ru_subtitles';
  product.russianLanguageMode = mode;
  product.hasRussianLanguage = hasRussian;
  product.languageSource = 'manual-override';
  product.languageOverride = true;

  if (hasRussian) {
    const supported = new Set(product.supportedLanguages || []);
    supported.add('ru-ru');
    product.supportedLanguages = [...supported].sort();
  } else if (mode === 'unknown') {
    product.supportedLanguages = [];
    product.packageLanguages = [];
  }

  return product;
}

function applyOverrideToProduct(product, override) {
  if (!product || !override) return product;

  if (override.title && !product.title) {
    product.title = override.title;
  }
  if (override.languageNote) {
    product.languageNote = override.languageNote;
  }
  if (override.specialOfferUrl) {
    product.specialOfferUrl = override.specialOfferUrl;
  }
  if (override.customDescription) {
    product.fullDescription = override.customDescription;
    product.descriptionSource = 'admin-override';
    product.descriptionOverride = true;
  }

  applyLanguageMode(product, override.russianLanguageMode);
  product.adminOverride = {
    productId: override.productId,
    russianLanguageMode: override.russianLanguageMode || 'auto',
    languageNote: override.languageNote || '',
    specialOfferUrl: override.specialOfferUrl || null,
    customDescription: override.customDescription || '',
    updatedAt: override.updatedAt,
  };

  return product;
}

async function getOverridesByIds(productIds) {
  const ids = [...new Set((productIds || []).map(normalizeProductId).filter(Boolean))];
  if (!ids.length) return new Map();

  const { rows } = await pool.query(
    `SELECT * FROM product_overrides WHERE product_id = ANY($1)`,
    [ids],
  );

  return new Map(rows.map((row) => [row.product_id, rowToOverride(row)]));
}

async function applyProductOverrides(products) {
  const list = Array.isArray(products) ? products : [products].filter(Boolean);
  const overrides = await getOverridesByIds(list.map((product) => product.id));
  for (const product of list) {
    const override = overrides.get(normalizeProductId(product.id));
    if (override) applyOverrideToProduct(product, override);
  }
  return products;
}

async function getProductOverride(productId) {
  const id = normalizeProductId(productId);
  const { rows } = await pool.query('SELECT * FROM product_overrides WHERE product_id = $1', [id]);
  return rowToOverride(rows[0]);
}

async function listProductOverrides({ search = '', page = 1, limit = 50 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const offset = (safePage - 1) * safeLimit;
  const params = [safeLimit, offset];
  let where = '';

  if (search) {
    params.push(`%${String(search).trim()}%`);
    where = `WHERE product_id ILIKE $3 OR title ILIKE $3`;
  }

  const countWhere = search ? `WHERE product_id ILIKE $1 OR title ILIKE $1` : '';
  const countParams = search ? [params[2]] : [];

  const [items, count] = await Promise.all([
    pool.query(
      `SELECT * FROM product_overrides
       ${where}
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM product_overrides ${countWhere}`,
      countParams,
    ),
  ]);

  return {
    overrides: items.rows.map(rowToOverride),
    total: count.rows[0]?.total || 0,
    page: safePage,
    limit: safeLimit,
  };
}

async function upsertProductOverride(productId, payload = {}) {
  const id = normalizeProductId(productId);
  if (!id) throw new Error('Product ID is required');

  const mode = normalizeLanguageMode(payload.russianLanguageMode);
  const title = String(payload.title || '').trim() || null;
  const languageNote = String(payload.languageNote || '').trim() || null;
  const specialOfferUrl = String(payload.specialOfferUrl || '').trim() || null;
  const payloadData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const customDescription = String(payload.customDescription || '').trim();
  const data = {
    ...payloadData,
    ...(customDescription ? { customDescription } : {}),
  };

  const { rows } = await pool.query(
    `INSERT INTO product_overrides (product_id, title, russian_language_mode, language_note, special_offer_url, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (product_id)
     DO UPDATE SET
       title = EXCLUDED.title,
       russian_language_mode = EXCLUDED.russian_language_mode,
       language_note = EXCLUDED.language_note,
       special_offer_url = EXCLUDED.special_offer_url,
       data = EXCLUDED.data,
       updated_at = NOW()
     RETURNING *`,
    [id, title, mode, languageNote, specialOfferUrl, data],
  );

  return rowToOverride(rows[0]);
}

async function deleteProductOverride(productId) {
  const id = normalizeProductId(productId);
  await pool.query('DELETE FROM product_overrides WHERE product_id = $1', [id]);
  return { productId: id };
}

module.exports = {
  applyProductOverrides,
  deleteProductOverride,
  getProductOverride,
  listProductOverrides,
  upsertProductOverride,
};

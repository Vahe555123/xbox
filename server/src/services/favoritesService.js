const pool = require('../db/pool');
const logger = require('../utils/logger');
const { getProductById } = require('./displayCatalogService');
const { mapProductDetail } = require('../mappers/productDetailMapper');

function normalizeProductId(input) {
  const id = typeof input === 'string'
    ? input
    : input?.productId || input?.id || input?.product?.id || input?.product?.productId;
  const normalized = String(id || '').trim().toUpperCase();
  return normalized || null;
}

function favoriteItem(productId) {
  return {
    id: productId,
    productId,
    detailPath: `/game/${productId}`,
  };
}

async function listFavorites(userId) {
  const { rows } = await pool.query(
    `SELECT product_id
     FROM favorites
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((row) => favoriteItem(row.product_id));
}

async function enrichFavoriteReleaseStatus(userId, productId) {
  try {
    const raw = await getProductById(productId);
    const product = mapProductDetail(raw);
    const status = product?.releaseInfo?.status;
    if (status !== 'unreleased' && status !== 'comingSoon') return;
    await pool.query(
      `UPDATE favorites
       SET snapshot = jsonb_set(snapshot, '{releaseStatus}', $3::jsonb),
           updated_at = NOW()
       WHERE user_id = $1 AND product_id = $2
         AND snapshot->>'releaseStatus' IS NULL`,
      [userId, productId, JSON.stringify(status)],
    );
  } catch (err) {
    logger.debug('[Favorites] enrichReleaseStatus failed', { userId, productId, message: err.message });
  }
}

async function upsertFavorite(userId, input, snapshot = {}) {
  const productId = normalizeProductId(input);
  if (!productId) {
    throw new Error('Invalid favorite product');
  }

  await pool.query(
    `INSERT INTO favorites (user_id, product_id, snapshot)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET updated_at = NOW()`,
    [userId, productId, JSON.stringify(snapshot)],
  );

  // If the client didn't send releaseStatus, auto-detect it in the background
  // so the release notification system can track this product.
  if (!snapshot.releaseStatus) {
    enrichFavoriteReleaseStatus(userId, productId).catch(() => {});
  }

  return favoriteItem(productId);
}

async function removeFavorite(userId, productId) {
  await pool.query(
    'DELETE FROM favorites WHERE user_id = $1 AND product_id = $2',
    [userId, String(productId || '').trim().toUpperCase()],
  );
}

async function replaceFavorites(userId, items) {
  const productIds = (Array.isArray(items) ? items : [])
    .map(normalizeProductId)
    .filter(Boolean)
    .filter((productId, index, values) => values.indexOf(productId) === index);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const productId of productIds) {
      await client.query(
        `INSERT INTO favorites (user_id, product_id, snapshot)
         VALUES ($1, $2, '{}'::jsonb)
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET updated_at = NOW()`,
        [userId, productId],
      );
    }
    await client.query('COMMIT');
    return listFavorites(userId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  listFavorites,
  upsertFavorite,
  removeFavorite,
  replaceFavorites,
  enrichFavoriteReleaseStatus,
};

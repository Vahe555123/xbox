const pool = require('../db/pool');

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

async function upsertFavorite(userId, input) {
  const productId = normalizeProductId(input);
  if (!productId) {
    throw new Error('Invalid favorite product');
  }

  await pool.query(
    `INSERT INTO favorites (user_id, product_id, snapshot)
     VALUES ($1, $2, '{}'::jsonb)
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET snapshot = '{}'::jsonb, updated_at = NOW()`,
    [userId, productId],
  );

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
         DO UPDATE SET snapshot = '{}'::jsonb, updated_at = NOW()`,
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
};

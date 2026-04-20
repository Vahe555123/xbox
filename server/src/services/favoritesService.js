const pool = require('../db/pool');

function normalizeSnapshot(product) {
  if (!product?.id) return null;
  return {
    id: product.id,
    title: product.title || 'Unknown',
    image: product.image || null,
    detailPath: product.detailPath || `/game/${product.id}`,
    platforms: product.platforms || [],
    genre: product.genre || [],
    price: product.price || null,
    priceRub: product.priceRub || null,
    paymentPrices: product.paymentPrices || null,
    topupCombo: product.topupCombo || null,
    publisher: product.publisher || null,
    rating: product.rating || null,
    subscriptions: product.subscriptions || null,
    subscriptionLabels: product.subscriptionLabels || [],
    supportedLanguages: product.supportedLanguages || [],
    hasRussianLanguage: Boolean(product.hasRussianLanguage),
    gamePassSavingsPercent: product.gamePassSavingsPercent || null,
  };
}

async function listFavorites(userId) {
  const { rows } = await pool.query(
    `SELECT snapshot
     FROM favorites
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((row) => row.snapshot);
}

async function upsertFavorite(userId, product) {
  const snapshot = normalizeSnapshot(product);
  if (!snapshot) {
    throw new Error('Invalid favorite product');
  }

  await pool.query(
    `INSERT INTO favorites (user_id, product_id, snapshot)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id)
     DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
    [userId, snapshot.id, snapshot],
  );

  return snapshot;
}

async function removeFavorite(userId, productId) {
  await pool.query(
    'DELETE FROM favorites WHERE user_id = $1 AND product_id = $2',
    [userId, productId],
  );
}

async function replaceFavorites(userId, products) {
  const snapshots = (Array.isArray(products) ? products : [])
    .map(normalizeSnapshot)
    .filter(Boolean);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const snapshot of snapshots) {
      await client.query(
        `INSERT INTO favorites (user_id, product_id, snapshot)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = NOW()`,
        [userId, snapshot.id, snapshot],
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

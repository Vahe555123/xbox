const pool = require('../db/pool');
const config = require('../config');

function buildPayUrl(digisellerId) {
  const sellerId = config.digiseller.sellerId;
  if (!digisellerId || !sellerId) return null;
  const base = config.digiseller.payBaseUrl;
  return `${base}?id_d=${encodeURIComponent(digisellerId)}&ai=${encodeURIComponent(sellerId)}&_ow=0`;
}

async function getMapping(productId) {
  const { rows } = await pool.query(
    `SELECT product_id, digiseller_id, note, created_at, updated_at
     FROM digiseller_products
     WHERE product_id = $1`,
    [productId],
  );
  return rows[0] || null;
}

async function listMappings({ page = 1, limit = 50, search = '' } = {}) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const offset = (Math.max(1, page) - 1) * safeLimit;

  const params = [safeLimit, offset];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE product_id ILIKE $3 OR CAST(digiseller_id AS TEXT) ILIKE $3 OR note ILIKE $3`;
  }

  const { rows } = await pool.query(
    `SELECT product_id, digiseller_id, note, created_at, updated_at
     FROM digiseller_products
     ${where}
     ORDER BY updated_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const countParams = search ? [`%${search}%`] : [];
  const countQuery = search
    ? `SELECT COUNT(*)::int AS total FROM digiseller_products
       WHERE product_id ILIKE $1 OR CAST(digiseller_id AS TEXT) ILIKE $1 OR note ILIKE $1`
    : `SELECT COUNT(*)::int AS total FROM digiseller_products`;
  const { rows: countRows } = await pool.query(countQuery, countParams);

  return { items: rows, total: countRows[0].total, page, limit: safeLimit };
}

async function upsertMapping({ productId, digisellerId, note }) {
  const { rows } = await pool.query(
    `INSERT INTO digiseller_products (product_id, digiseller_id, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id)
     DO UPDATE SET digiseller_id = EXCLUDED.digiseller_id,
                   note = EXCLUDED.note,
                   updated_at = NOW()
     RETURNING product_id, digiseller_id, note, created_at, updated_at`,
    [productId, digisellerId, note || null],
  );
  return rows[0];
}

async function deleteMapping(productId) {
  const { rowCount } = await pool.query(
    `DELETE FROM digiseller_products WHERE product_id = $1`,
    [productId],
  );
  return rowCount > 0;
}

module.exports = {
  buildPayUrl,
  getMapping,
  listMappings,
  upsertMapping,
  deleteMapping,
};

const pool = require('../db/pool');
const logger = require('../utils/logger');
const { getProductsByIds } = require('./displayCatalogService');
const { mapProductDetail } = require('../mappers/productDetailMapper');

const BATCH_SIZE = 50;

const state = {
  isRunning: false,
  lastRunAt: null,
  lastResult: null,
};

function getState() {
  return { ...state };
}

async function runBackfill() {
  if (state.isRunning) return { alreadyRunning: true };

  state.isRunning = true;
  state.lastRunAt = new Date().toISOString();
  state.lastResult = null;

  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT product_id FROM favorites WHERE snapshot->>'releaseStatus' IS NULL`,
    );
    const productIds = rows.map((r) => r.product_id);
    logger.info(`[ReleaseBackfill] Starting backfill for ${productIds.length} products`);

    let processed = 0;
    let updated = 0;

    for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
      const batch = productIds.slice(i, i + BATCH_SIZE);
      let rawProducts = [];
      try {
        rawProducts = await getProductsByIds(batch, { allowPartial: true, context: 'release-backfill' });
      } catch (err) {
        logger.warn('[ReleaseBackfill] Batch fetch failed', { offset: i, message: err.message });
      }

      for (const raw of rawProducts) {
        try {
          const product = mapProductDetail(raw);
          const status = product?.releaseInfo?.status;
          if (status !== 'unreleased' && status !== 'comingSoon') continue;
          const productId = String(product.id || '').toUpperCase();
          if (!productId) continue;

          const result = await pool.query(
            `UPDATE favorites
             SET snapshot = jsonb_set(snapshot, '{releaseStatus}', $2::jsonb),
                 updated_at = NOW()
             WHERE product_id = $1
               AND snapshot->>'releaseStatus' IS NULL`,
            [productId, JSON.stringify(status)],
          );
          if (result.rowCount > 0) updated += result.rowCount;
        } catch (err) {
          logger.debug('[ReleaseBackfill] Row update failed', { message: err.message });
        }
      }
      processed += batch.length;
    }

    const result = { processed, updated, skipped: processed - updated };
    state.lastResult = result;
    logger.info('[ReleaseBackfill] Done', result);
    return result;
  } finally {
    state.isRunning = false;
  }
}

module.exports = { getState, runBackfill };

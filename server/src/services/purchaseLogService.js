const pool = require('../db/pool');
const logger = require('../utils/logger');

async function logPurchase({ productId, productTitle, paymentMode, priceUsd, priceRub, userId }) {
  try {
    await pool.query(
      `INSERT INTO purchases (product_id, product_title, payment_mode, price_usd, price_rub, user_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'initiated')`,
      [
        String(productId || '').toUpperCase(),
        String(productTitle || ''),
        String(paymentMode || 'oplata'),
        priceUsd != null ? Number(priceUsd) : null,
        priceRub != null ? Number(priceRub) : null,
        userId || null,
      ],
    );
  } catch (err) {
    logger.warn('Failed to log purchase', { productId, message: err.message });
  }
}

module.exports = { logPurchase };

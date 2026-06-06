const { fetchGamePassData } = require('../services/gamePassService');
const config = require('../config');
const logger = require('../utils/logger');

async function getGamePass(req, res, next) {
  try {
    const productId = config.gamePass?.productId || 4687274;
    const product = await fetchGamePassData(productId);

    res.json({
      success: true,
      product,
      productId,
      payUrl: `https://www.oplata.info/asp2/pay.asp?id_d=${productId}`,
    });
  } catch (err) {
    logger.error('[GamePass] Controller error', { message: err.message });
    next(err);
  }
}

module.exports = { getGamePass };

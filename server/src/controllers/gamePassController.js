const { fetchGamePassData, createGamePassOrder } = require('../services/gamePassService');
const config = require('../config');
const logger = require('../utils/logger');

async function getGamePass(req, res, next) {
  try {
    const productId = config.gamePass?.productId || 4687274;
    const product = await fetchGamePassData(productId);
    res.json({ success: true, product, productId });
  } catch (err) {
    logger.error('[GamePass] Controller error', { message: err.message });
    next(err);
  }
}

async function postGamePassOrder(req, res, next) {
  try {
    const productId = config.gamePass?.productId || 4687274;
    const selections = req.body?.selections || {};
    const result = await createGamePassOrder(selections, productId);
    res.json({ success: true, payUrl: result.payUrl });
  } catch (err) {
    logger.error('[GamePass] Order error', { message: err.message });
    next(err);
  }
}

module.exports = { getGamePass, postGamePassOrder };

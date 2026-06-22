const { fetchUbisoftData, createUbisoftOrder } = require('../services/ubisoftService');
const config = require('../config');
const logger = require('../utils/logger');

async function getUbisoft(req, res, next) {
  try {
    const productId = config.ubisoftPlus?.productId || 3711939;
    const product = await fetchUbisoftData(productId);
    res.json({ success: true, product, productId });
  } catch (err) {
    logger.error('[Ubisoft+] Controller error', { message: err.message });
    next(err);
  }
}

async function postUbisoftOrder(req, res, next) {
  try {
    const productId = config.ubisoftPlus?.productId || 3711939;
    const selections = req.body?.selections || {};
    const result = await createUbisoftOrder(selections, productId);
    res.json({ success: true, payUrl: result.payUrl });
  } catch (err) {
    logger.error('[Ubisoft+] Order error', { message: err.message });
    next(err);
  }
}

module.exports = { getUbisoft, postUbisoftOrder };

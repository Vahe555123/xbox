const { Router } = require('express');
const {
  searchXbox,
  getProductDetail,
  getProductLocalizedDescription,
  createProductPurchase,
  createCartPurchase,
  getRelatedProducts,
  getPriceFilterRates,
  getCollections,
} = require('../controllers/xboxController');
const { validateSearch } = require('../validators/searchValidator');
const { validateProductId } = require('../validators/productIdValidator');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const saleIndexService = require('../services/saleIndexService');

const router = Router();

router.get('/search', validateSearch, searchXbox);
router.get('/collections', getCollections);
router.get('/price-rate', getPriceFilterRates);
router.get('/products/batch', getRelatedProducts);
router.post('/product/:productId/purchase', optionalAuth, validateProductId, createProductPurchase);
router.post('/cart/purchase', optionalAuth, createCartPurchase);
router.get('/product/:productId/description', validateProductId, getProductLocalizedDescription);
router.get('/product/:productId', validateProductId, getProductDetail);

// Sale end dates for the "Скидки до:" filter dropdown
router.get('/sale-end-dates', async (_req, res, next) => {
  try {
    const dates = await saleIndexService.listSaleEndDates();
    res.json({ dates });
  } catch (err) {
    next(err);
  }
});

// Subscribe to deal-end reminder for a specific date
router.post('/sale-end-reminder', requireAuth, async (req, res, next) => {
  try {
    const { date } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    await saleIndexService.subscribeSaleEndReminder(req.user.id, date);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

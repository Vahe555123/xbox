const { Router } = require('express');
const {
  searchXbox,
  getProductDetail,
  getProductLocalizedDescription,
  createProductPurchase,
  createCartPurchase,
  getRelatedProducts,
  getPriceFilterRates,
} = require('../controllers/xboxController');
const { validateSearch } = require('../validators/searchValidator');
const { validateProductId } = require('../validators/productIdValidator');
const { optionalAuth } = require('../middleware/auth');

const router = Router();

router.get('/search', validateSearch, searchXbox);
router.get('/price-rate', getPriceFilterRates);
router.get('/products/batch', getRelatedProducts);
router.post('/product/:productId/purchase', optionalAuth, validateProductId, createProductPurchase);
router.post('/cart/purchase', optionalAuth, createCartPurchase);
router.get('/product/:productId/description', validateProductId, getProductLocalizedDescription);
router.get('/product/:productId', validateProductId, getProductDetail);

module.exports = router;

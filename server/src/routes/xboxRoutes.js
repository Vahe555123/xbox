const { Router } = require('express');
const { searchXbox, getProductDetail, getRelatedProducts } = require('../controllers/xboxController');
const { validateSearch } = require('../validators/searchValidator');
const { validateProductId } = require('../validators/productIdValidator');

const router = Router();

router.get('/search', validateSearch, searchXbox);
router.get('/products/batch', getRelatedProducts);
router.get('/product/:productId', validateProductId, getProductDetail);

module.exports = router;

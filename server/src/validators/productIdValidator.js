const { AppError } = require('../utils/errorFormatter');

const PRODUCT_ID_RE = /^[0-9A-Za-z]{10,20}$/;

function validateProductId(req, _res, next) {
  const { productId } = req.params;
  if (!productId || !PRODUCT_ID_RE.test(productId)) {
    return next(new AppError('Invalid product id', 400));
  }
  next();
}

module.exports = { validateProductId };

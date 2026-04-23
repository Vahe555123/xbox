const { AppError } = require('../utils/errorFormatter');
const {
  listFavorites,
  upsertFavorite,
  removeFavorite,
  replaceFavorites,
} = require('../services/favoritesService');

async function getFavorites(req, res, next) {
  try {
    const items = await listFavorites(req.user.id);
    res.json({ success: true, items, count: items.length });
  } catch (err) {
    next(err);
  }
}

async function addFavorite(req, res, next) {
  try {
    const product = req.body?.productId || req.body?.id || req.body?.product || req.body;
    const productId = typeof product === 'string' ? product : product?.id || product?.productId;
    if (!productId) {
      throw new AppError('Favorite product is required', 400);
    }

    const item = await upsertFavorite(req.user.id, product);
    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
}

async function deleteFavorite(req, res, next) {
  try {
    await removeFavorite(req.user.id, req.params.productId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function syncFavorites(req, res, next) {
  try {
    const items = await replaceFavorites(req.user.id, req.body?.items || []);
    res.json({ success: true, items, count: items.length });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getFavorites,
  addFavorite,
  deleteFavorite,
  syncFavorites,
};

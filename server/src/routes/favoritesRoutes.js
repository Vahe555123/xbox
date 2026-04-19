const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getFavorites,
  addFavorite,
  deleteFavorite,
  syncFavorites,
} = require('../controllers/favoritesController');

const router = Router();

router.use(requireAuth);
router.get('/', getFavorites);
router.post('/', addFavorite);
router.put('/sync', syncFavorites);
router.delete('/:productId', deleteFavorite);

module.exports = router;

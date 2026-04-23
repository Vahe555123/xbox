const { Router } = require('express');
const xboxRoutes = require('./xboxRoutes');
const authRoutes = require('./authRoutes');
const favoritesRoutes = require('./favoritesRoutes');
const adminRoutes = require('./adminRoutes');
const telegramRoutes = require('./telegramRoutes');
const { getHealth } = require('../controllers/xboxController');

const router = Router();

router.get('/health', getHealth);
router.use('/xbox', xboxRoutes);
router.use('/auth', authRoutes);
router.use('/favorites', favoritesRoutes);
router.use('/admin', adminRoutes);
router.use('/telegram', telegramRoutes);

module.exports = router;

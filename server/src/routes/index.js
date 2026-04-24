const { Router } = require('express');
const xboxRoutes = require('./xboxRoutes');
const authRoutes = require('./authRoutes');
const favoritesRoutes = require('./favoritesRoutes');
const adminRoutes = require('./adminRoutes');
const supportRoutes = require('./supportRoutes');
const { getHealth } = require('../controllers/xboxController');

const router = Router();

router.get('/health', getHealth);
router.use('/xbox', xboxRoutes);
router.use('/auth', authRoutes);
router.use('/favorites', favoritesRoutes);
router.use('/admin', adminRoutes);
router.use('/support-links', supportRoutes);

module.exports = router;

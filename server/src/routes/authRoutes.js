const { Router } = require('express');
const {
  register,
  verify,
  login,
  providers,
  oauthStart,
  oauthCallback,
  oauthSession,
  telegram,
  me,
  updatePassword,
  savePurchaseSettings,
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.get('/providers', providers);
router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, updatePassword);
router.put('/purchase-settings', requireAuth, savePurchaseSettings);
router.post('/register', register);
router.post('/verify', verify);
router.post('/login', login);
router.get('/oauth/session/:sessionId', oauthSession);
router.get('/oauth/:provider', oauthStart);
router.get('/oauth/:provider/callback', oauthCallback);
router.post('/telegram', telegram);

module.exports = router;

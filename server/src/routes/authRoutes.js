const { Router } = require('express');
const {
  register,
  verify,
  login,
  providers,
  oauthStart,
  oauthLinkStart,
  oauthCallback,
  oauthSession,
  telegram,
  telegramLink,
  unlinkProviderHandler,
  me,
  updatePassword,
  savePurchaseSettings,
  requestEmailLink,
  confirmEmailLink,
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
router.get('/oauth/:provider/link', requireAuth, oauthLinkStart);
router.get('/oauth/:provider', oauthStart);
router.get('/oauth/:provider/callback', oauthCallback);
router.post('/telegram', telegram);
router.post('/telegram/link', requireAuth, telegramLink);
router.delete('/providers/:provider', requireAuth, unlinkProviderHandler);
router.post('/email/link/request', requireAuth, requestEmailLink);
router.post('/email/link/confirm', requireAuth, confirmEmailLink);

module.exports = router;

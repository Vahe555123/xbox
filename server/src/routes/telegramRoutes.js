const { Router } = require('express');
const config = require('../config');
const { handleWebhookUpdate } = require('../services/telegramBotService');

const router = Router();

router.post('/webhook/:secret?', async (req, res) => {
  if (config.auth.telegram.webhookSecret) {
    const receivedSecret = req.params.secret || req.get('x-telegram-bot-api-secret-token') || '';
    if (receivedSecret !== config.auth.telegram.webhookSecret) {
      return res.status(403).json({ success: false, error: 'Invalid Telegram webhook secret' });
    }
  }

  res.json({ ok: true });
  await handleWebhookUpdate(req.body);
});

module.exports = router;

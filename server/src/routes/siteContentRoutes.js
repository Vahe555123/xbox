const { Router } = require('express');
const { getHelpContent } = require('../services/helpContentService');

const router = Router();

router.get('/help', async (_req, res, next) => {
  try {
    const content = await getHelpContent();
    res.json(content);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

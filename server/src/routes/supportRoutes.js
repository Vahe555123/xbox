const { Router } = require('express');
const { getSupportLinks } = require('../services/supportLinksService');

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const links = await getSupportLinks();
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

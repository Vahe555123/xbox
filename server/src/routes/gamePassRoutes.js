const { Router } = require('express');
const { getGamePass } = require('../controllers/gamePassController');

const router = Router();
router.get('/', getGamePass);

module.exports = router;

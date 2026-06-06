const { Router } = require('express');
const { getGamePass, postGamePassOrder } = require('../controllers/gamePassController');

const router = Router();
router.get('/', getGamePass);
router.post('/order', postGamePassOrder);

module.exports = router;

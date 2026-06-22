const { Router } = require('express');
const { getUbisoft, postUbisoftOrder } = require('../controllers/ubisoftController');

const router = Router();
router.get('/', getUbisoft);
router.post('/order', postUbisoftOrder);

module.exports = router;

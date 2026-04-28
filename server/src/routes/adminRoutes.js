const { Router } = require('express');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const pool = require('../db/pool');
const config = require('../config');
const dealScheduler = require('../services/dealScheduler');
const digisellerService = require('../services/digisellerService');
const topupCardService = require('../services/topupCardService');
const { search } = require('../services/searchService');
const { getProductById } = require('../services/displayCatalogService');
const { mapProductDetail } = require('../mappers/productDetailMapper');
const {
  applyProductOverrides,
  deleteProductOverride,
  getProductOverride,
  listProductOverrides,
  upsertProductOverride,
} = require('../services/productOverrideService');
const { getSupportLinks, updateSupportLinks } = require('../services/supportLinksService');
const logger = require('../utils/logger');

const router = Router();
const ADMIN_PRODUCT_LANGUAGE_MODES = new Set(['unknown', 'no_ru', 'full_ru', 'ru_subtitles']);

// Check if current user is admin (used by client to show/hide admin button)
router.get('/check', requireAuth, async (req, res) => {
  const user = req.user;
  const adminEmails = config.admin.emails;
  const adminTgIds = config.admin.telegramIds;

  let isAdmin = user.email && adminEmails.includes(user.email.toLowerCase());

  if (!isAdmin && adminTgIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT provider_user_id FROM oauth_accounts
       WHERE user_id = $1 AND provider = 'telegram'`,
      [user.id],
    );
    isAdmin = rows.some((r) => adminTgIds.includes(r.provider_user_id));
  }

  res.json({ isAdmin: Boolean(isAdmin) });
});

// Dashboard stats
router.get('/stats', requireAdmin, async (_req, res, next) => {
  try {
    const [users, favorites, notifications, recentUsers] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT COUNT(*)::int AS count FROM favorites'),
      pool.query('SELECT COUNT(*)::int AS count FROM deal_notifications'),
      pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`),
    ]);

    const providerStats = await pool.query(`
      SELECT last_provider, COUNT(*)::int AS count
      FROM users
      GROUP BY last_provider
      ORDER BY count DESC
    `);

    const topFavorited = await pool.query(`
      SELECT product_id, product_id AS title, COUNT(*)::int AS count
      FROM favorites
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT 10
    `);

    const scheduler = dealScheduler.getState();

    res.json({
      stats: {
        totalUsers: users.rows[0].count,
        totalFavorites: favorites.rows[0].count,
        totalNotifications: notifications.rows[0].count,
        newUsersLast7Days: recentUsers.rows[0].count,
      },
      providerStats: providerStats.rows,
      topFavorited: topFavorited.rows,
      scheduler,
    });
  } catch (err) {
    next(err);
  }
});

// Users list with favorites count
router.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = '';
    const params = [limit, offset];

    if (search) {
      whereClause = `WHERE u.email ILIKE $3 OR u.name ILIKE $3`;
      params.push(`%${search}%`);
    }

    const { rows } = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.name,
        u.last_provider,
        u.verified,
        u.created_at,
        u.updated_at,
        COUNT(f.product_id)::int AS favorites_count
      FROM users u
      LEFT JOIN favorites f ON f.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams = search ? [`%${search}%`] : [];
    const countQuery = search
      ? `SELECT COUNT(*)::int AS total FROM users u WHERE u.email ILIKE $1 OR u.name ILIKE $1`
      : 'SELECT COUNT(*)::int AS total FROM users';
    const { rows: countRows } = await pool.query(countQuery, countParams);

    res.json({
      users: rows,
      total: countRows[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// User detail with favorites
router.get('/users/:userId', requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;

    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [favorites, oauth, notifications] = await Promise.all([
      pool.query(`
        SELECT
          product_id,
          jsonb_build_object('id', product_id, 'detailPath', '/game/' || product_id) AS snapshot,
          created_at
        FROM favorites
        WHERE user_id = $1
        ORDER BY updated_at DESC
      `, [userId]),
      pool.query('SELECT provider, provider_user_id, linked_at FROM oauth_accounts WHERE user_id = $1', [userId]),
      pool.query(`
        SELECT product_id, deal_key, notified_at
        FROM deal_notifications
        WHERE user_id = $1
        ORDER BY notified_at DESC
        LIMIT 50
      `, [userId]),
    ]);

    const user = userRows[0];
    delete user.password_hash;
    delete user.xbox_account_password_encrypted;

    res.json({
      user,
      favorites: favorites.rows,
      oauthAccounts: oauth.rows,
      notifications: notifications.rows,
    });
  } catch (err) {
    next(err);
  }
});

// Deal notifications history
router.get('/notifications', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(`
      SELECT
        dn.user_id,
        u.email,
        u.name,
        u.last_provider,
        dn.product_id,
        dn.deal_key,
        dn.notified_at
      FROM deal_notifications dn
      JOIN users u ON u.id = dn.user_id
      ORDER BY dn.notified_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS total FROM deal_notifications');

    res.json({
      notifications: rows,
      total: countRows[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

// Product search for manual overrides
router.get('/products/search', requireAdmin, async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    const requestedLanguageMode = String(req.query.languageMode || '').trim();
    const languageMode = ADMIN_PRODUCT_LANGUAGE_MODES.has(requestedLanguageMode)
      ? requestedLanguageMode
      : '';

    const productIdLike = query && /^[A-Z0-9]{8,16}$/i.test(query);
    if (productIdLike) {
      try {
        const raw = await getProductById(query.toUpperCase());
        const product = mapProductDetail(raw);
        await applyProductOverrides(product);
        if (languageMode && product.russianLanguageMode !== languageMode) {
          return res.json({ products: [] });
        }
        return res.json({ products: [product] });
      } catch (err) {
        if (err.response?.status !== 404 && err.statusCode !== 404) throw err;
      }
    }

    const productsById = new Map();
    let encodedCT = '';
    let attempts = 0;
    const maxPages = languageMode ? 6 : 1;

    do {
      const result = await search({
        query,
        page: 1,
        sort: '',
        filters: {},
        languageMode,
        encodedCT,
        channelId: '',
      });

      for (const product of result.products || []) {
        if (product?.id && !productsById.has(product.id)) {
          productsById.set(product.id, product);
        }
      }

      encodedCT = result.encodedCT || '';
      attempts += 1;
    } while (languageMode && productsById.size < 25 && encodedCT && attempts < maxPages);

    res.json({ products: [...productsById.values()] });
  } catch (err) {
    next(err);
  }
});

router.get('/product-overrides', requireAdmin, async (req, res, next) => {
  try {
    const result = await listProductOverrides({
      search: req.query.search || '',
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/product-overrides/:productId', requireAdmin, async (req, res, next) => {
  try {
    const override = await getProductOverride(req.params.productId);
    res.json({ override });
  } catch (err) {
    next(err);
  }
});

router.put('/product-overrides/:productId', requireAdmin, async (req, res, next) => {
  try {
    const override = await upsertProductOverride(req.params.productId, req.body || {});
    res.json({ success: true, override });
  } catch (err) {
    if (err.message === 'Invalid russianLanguageMode' || err.message === 'Product ID is required') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.delete('/product-overrides/:productId', requireAdmin, async (req, res, next) => {
  try {
    const result = await deleteProductOverride(req.params.productId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.get('/support-links', requireAdmin, async (_req, res, next) => {
  try {
    const links = await getSupportLinks();
    res.json({ links });
  } catch (err) {
    next(err);
  }
});

router.put('/support-links', requireAdmin, async (req, res, next) => {
  try {
    const links = await updateSupportLinks(req.body || {});
    res.json({ success: true, links });
  } catch (err) {
    next(err);
  }
});

// Scheduler settings
router.get('/scheduler', requireAdmin, (_req, res) => {
  res.json(dealScheduler.getState());
});

router.put('/scheduler', requireAdmin, (req, res) => {
  const { intervalHours } = req.body;
  if (typeof intervalHours !== 'number' || intervalHours < 0.01) {
    return res.status(400).json({ error: 'intervalHours must be a positive number' });
  }
  dealScheduler.setInterval(intervalHours * 60 * 60 * 1000);
  res.json(dealScheduler.getState());
});

// Manual deal check trigger
router.post('/deal-check', requireAdmin, async (_req, res) => {
  try {
    const result = await dealScheduler.runNow();
    if (result.alreadyRunning) {
      return res.json({ success: false, message: 'Deal check is already running' });
    }
    res.json({
      success: result.success,
      message: result.success ? 'Deal check completed' : 'Deal check finished with errors',
      report: result.report,
    });
  } catch (err) {
    logger.error('Manual deal check failed', { message: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Digiseller rates ====================

router.get('/digiseller/rates', requireAdmin, async (req, res, next) => {
  try {
    const state = await digisellerService.getPriceRateState({
      mode: req.query.mode || 'oplata',
    });
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.post('/digiseller/rates/refresh', requireAdmin, async (req, res, next) => {
  try {
    const result = await digisellerService.refreshPriceRateTable({
      mode: req.body?.mode || req.query.mode || 'oplata',
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// ==================== Xbox topup cards ====================

router.get('/topup-cards', requireAdmin, async (_req, res, next) => {
  try {
    const state = await topupCardService.getTopupState();
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.post('/topup-cards/refresh', requireAdmin, async (_req, res, next) => {
  try {
    const result = await topupCardService.refreshCards();
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Topup cards refresh failed', { message: err.message });
    res.status(502).json({ success: false, error: err.message });
  }
});

router.put('/topup-cards/:usdValue', requireAdmin, async (req, res, next) => {
  try {
    const usd = parseInt(req.params.usdValue, 10);
    if (!Number.isFinite(usd)) {
      return res.status(400).json({ error: 'Invalid usdValue' });
    }
    const { optionId, priceRub, inStock, enabled, label } = req.body || {};
    const card = await topupCardService.updateCard(usd, {
      optionId,
      priceRub,
      inStock,
      enabled,
      label,
    });
    if (!card) return res.status(404).json({ error: 'Card not found' });
    res.json({ success: true, card });
  } catch (err) {
    next(err);
  }
});

router.get('/topup-cards/preview', requireAdmin, async (req, res, next) => {
  try {
    const priceUsd = Number(req.query.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
      return res.status(400).json({ error: 'priceUsd must be a positive number' });
    }
    const combo = await topupCardService.computeCombo(priceUsd);
    res.json(combo);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

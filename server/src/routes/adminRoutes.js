const { Router } = require('express');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const pool = require('../db/pool');
const { runBroadcast } = require('../services/broadcastService');
const dealScheduler = require('../services/dealScheduler');
const russianLanguageIndexScheduler = require('../services/russianLanguageIndexScheduler');
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
const {
  enrichUserWithAdminAccess,
  enrichUsersWithAdminAccess,
  isUserAdmin,
  setUserAdminAccess,
} = require('../services/adminAccessService');
const {
  clearApplicationCache,
  getCacheSettings,
  updateCacheSettings,
} = require('../services/cacheSettingsService');
const { getHelpContent, updateHelpContent } = require('../services/helpContentService');
const { getSupportLinks, updateSupportLinks } = require('../services/supportLinksService');
const collectionsService = require('../services/collectionsService');
const collectionsScheduler = require('../services/collectionsScheduler');
const saleIndexService = require('../services/saleIndexService');
const saleIndexScheduler = require('../services/saleIndexScheduler');
const { runSaleEndingBroadcast, runManualSpecialOfferNotification, getFavoritesCountForProduct } = require('../services/dealNotifierService');
const logger = require('../utils/logger');

const router = Router();
const ADMIN_PRODUCT_LANGUAGE_MODES = new Set(['unknown', 'no_ru', 'full_ru', 'ru_subtitles']);

// Check if current user is admin (used by client to show/hide admin button)
router.get('/check', requireAuth, async (req, res) => {
  res.json({ isAdmin: await isUserAdmin(req.user) });
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
      SELECT
        f.product_id,
        COALESCE(
          (SELECT po.title FROM product_overrides po WHERE po.product_id = f.product_id AND po.title IS NOT NULL LIMIT 1),
          (SELECT cps.data->>'title' FROM collection_product_snapshots cps WHERE cps.product_id = f.product_id AND cps.data->>'title' IS NOT NULL LIMIT 1),
          (SELECT sp.title FROM sale_products sp WHERE sp.product_id = f.product_id AND sp.title IS NOT NULL LIMIT 1),
          (SELECT fs.snapshot->>'title' FROM favorites fs WHERE fs.product_id = f.product_id AND fs.snapshot->>'title' IS NOT NULL LIMIT 1),
          (SELECT p.product_title FROM purchases p WHERE p.product_id = f.product_id AND p.product_title IS NOT NULL LIMIT 1)
        ) AS title,
        COUNT(*)::int AS count
      FROM favorites f
      GROUP BY f.product_id
      ORDER BY count DESC
      LIMIT 20
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

// Top favorited games with pagination
router.get('/top-favorites', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const [{ rows }, { rows: [{ total }] }] = await Promise.all([
      pool.query(`
        SELECT
          f.product_id,
          COALESCE(
            (SELECT po.title FROM product_overrides po WHERE po.product_id = f.product_id AND po.title IS NOT NULL LIMIT 1),
            (SELECT cps.data->>'title' FROM collection_product_snapshots cps WHERE cps.product_id = f.product_id AND cps.data->>'title' IS NOT NULL LIMIT 1),
            (SELECT sp.title FROM sale_products sp WHERE sp.product_id = f.product_id AND sp.title IS NOT NULL LIMIT 1),
            (SELECT fs.snapshot->>'title' FROM favorites fs WHERE fs.product_id = f.product_id AND fs.snapshot->>'title' IS NOT NULL LIMIT 1),
            (SELECT p.product_title FROM purchases p WHERE p.product_id = f.product_id AND p.product_title IS NOT NULL LIMIT 1)
          ) AS title,
          COUNT(*)::int AS count
        FROM favorites f
        GROUP BY f.product_id
        ORDER BY count DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]),
      pool.query(`SELECT COUNT(DISTINCT product_id)::int AS total FROM favorites`),
    ]);

    res.json({ items: rows, total, page, limit });
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
        u.is_admin,
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
    const usersWithAccess = await enrichUsersWithAdminAccess(rows);

    res.json({
      users: usersWithAccess,
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

    const user = await enrichUserWithAdminAccess(userRows[0]);
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

router.put('/users/:userId/admin', requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { isAdmin } = req.body || {};

    if (typeof isAdmin !== 'boolean') {
      return res.status(400).json({ error: 'isAdmin must be a boolean' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUser = await enrichUserWithAdminAccess(rows[0]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!isAdmin && req.user.id === userId) {
      return res.status(400).json({ error: 'You cannot revoke your own admin access from the admin panel' });
    }
    if (!isAdmin && targetUser.isConfigAdmin) {
      return res.status(400).json({ error: 'This admin access is controlled via .env' });
    }

    const updatedUser = await setUserAdminAccess(userId, isAdmin);
    const enrichedUser = await enrichUserWithAdminAccess(updatedUser);

    res.json({
      success: true,
      user: enrichedUser,
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
    } while (encodedCT && attempts < 5);

    const allProducts = [...productsById.values()];
    res.json({ products: allProducts, total: allProducts.length });
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
    // Snapshot old special_offer_url before saving so we can detect a newly-set offer.
    const existing = await getProductOverride(req.params.productId).catch(() => null);
    const oldSpecialOfferUrl = existing?.specialOfferUrl || null;

    const override = await upsertProductOverride(req.params.productId, req.body || {});
    res.json({ success: true, override });

    // If a new special offer URL was set (or changed), automatically notify users
    // who have this game in their favorites — runs in background after response is sent.
    const newSpecialOfferUrl = override?.specialOfferUrl || null;
    if (newSpecialOfferUrl && newSpecialOfferUrl !== oldSpecialOfferUrl) {
      logger.info('[Admin] New special offer detected, triggering auto-notification', {
        productId: override.productId,
        url: newSpecialOfferUrl,
      });
      runManualSpecialOfferNotification(override.productId).catch((err) => {
        logger.error('[Admin] Auto special-offer notification failed', {
          productId: override.productId,
          message: err.message,
        });
      });
    }
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
    const links = await getSupportLinks({ includePrivate: true });
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

router.get('/help-content', requireAdmin, async (_req, res, next) => {
  try {
    const content = await getHelpContent();
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

router.put('/help-content', requireAdmin, async (req, res, next) => {
  try {
    const content = await updateHelpContent(req.body || {});
    res.json({ success: true, content });
  } catch (err) {
    next(err);
  }
});

router.get('/cache', requireAdmin, async (_req, res, next) => {
  try {
    const settings = await getCacheSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put('/cache', requireAdmin, async (req, res, next) => {
  try {
    const settings = await updateCacheSettings(req.body || {});
    res.json({ success: true, settings });
  } catch (err) {
    if (err.message === 'ttl must be a positive integer' || err.message === 'mainCatalogTtl must be a positive integer') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post('/cache/clear', requireAdmin, (_req, res) => {
  const result = clearApplicationCache();
  res.json({ success: true, ...result });
});

// Russian-language index (powers the "Язык" filter)
router.get('/russian-index', requireAdmin, (_req, res) => {
  res.json(russianLanguageIndexScheduler.getState());
});

router.post('/russian-index/refresh', requireAdmin, (req, res) => {
  const deep = Boolean(req.body?.deep);
  const state = russianLanguageIndexScheduler.getState();

  if (state.isBuilding) {
    return res.json({ started: false, alreadyRunning: true, state });
  }

  // The build can take a while (it scans the whole catalog), so run it in the
  // background and let the admin poll the status endpoint.
  russianLanguageIndexScheduler.runNow({ deep }).catch((err) => {
    logger.error('Russian index manual build failed', { message: err.message });
  });

  res.json({ started: true, state: russianLanguageIndexScheduler.getState() });
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

// ==================== Purchases ====================
router.get('/purchases', requireAdmin, async (req, res, next) => {
  try {
    const sort = req.query.sort === 'recent' ? 'recent' : 'count';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    let rows, total;

    if (sort === 'recent') {
      const result = await pool.query(
        `SELECT p.id, p.product_id, p.product_title, p.payment_mode, p.price_usd, p.price_rub,
                p.user_id, p.status, p.created_at,
                u.email AS user_email, u.name AS user_name
         FROM purchases p
         LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM purchases');
      rows = result.rows;
      total = countResult.rows[0].count;
    } else {
      const result = await pool.query(
        `SELECT product_id, product_title,
                COUNT(*)::int AS total_count,
                MAX(created_at) AS last_purchased_at
         FROM purchases
         GROUP BY product_id, product_title
         ORDER BY total_count DESC, last_purchased_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS count FROM (SELECT DISTINCT product_id FROM purchases) t',
      );
      rows = result.rows;
      total = countResult.rows[0].count;
    }

    res.json({ purchases: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
});

// ==================== Collections (Подборки) ====================

router.get('/collections', requireAdmin, async (_req, res, next) => {
  try {
    const collections = await collectionsService.listCollections({ includeDisabled: true });
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

// Snapshot refresh state + schedule. Defined before /:id to avoid route clash.
router.get('/collections/refresh', requireAdmin, async (_req, res, next) => {
  try {
    const state = await collectionsScheduler.getState();
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.post('/collections/refresh', requireAdmin, async (_req, res) => {
  const current = await collectionsService.getRefreshState().catch(() => null);
  if (current?.running) {
    return res.json({ started: false, alreadyRunning: true });
  }
  // Run in the background; the admin polls /collections/refresh for status.
  collectionsScheduler.runNow().catch((err) => {
    logger.error('Manual collections refresh failed', { message: err.message });
  });
  res.json({ started: true });
});

router.put('/collections/schedule', requireAdmin, async (req, res, next) => {
  try {
    const schedule = await collectionsService.setSchedule(req.body || {});
    res.json({ success: true, schedule });
  } catch (err) {
    if (/must be/.test(err.message)) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.post('/collections', requireAdmin, async (req, res, next) => {
  try {
    const collection = await collectionsService.createCollection(req.body || {});
    res.json({ success: true, collection });
  } catch (err) {
    if (err.message === 'Title is required') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.get('/collections/:id', requireAdmin, async (req, res, next) => {
  try {
    const collection = await collectionsService.getCollection(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    res.json({ collection });
  } catch (err) {
    next(err);
  }
});

router.put('/collections/:id', requireAdmin, async (req, res, next) => {
  try {
    const collection = await collectionsService.updateCollection(req.params.id, req.body || {});
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    res.json({ success: true, collection });
  } catch (err) {
    if (err.message === 'Title is required') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  }
});

router.delete('/collections/:id', requireAdmin, async (req, res, next) => {
  try {
    const ok = await collectionsService.deleteCollection(req.params.id);
    res.json({ success: ok });
  } catch (err) {
    next(err);
  }
});

router.put('/collections/:id/products', requireAdmin, async (req, res, next) => {
  try {
    const productIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const ids = await collectionsService.setCollectionProducts(req.params.id, productIds);
    res.json({ success: true, productIds: ids });
  } catch (err) {
    next(err);
  }
});

// ==================== Sale Index (игры со скидками) ====================

router.get('/sale-index', requireAdmin, async (_req, res, next) => {
  try {
    const state = await saleIndexService.getState();
    res.json({ ...state, scheduler: saleIndexScheduler.getState() });
  } catch (err) {
    next(err);
  }
});

router.post('/sale-index/refresh', requireAdmin, async (_req, res) => {
  const schedulerState = saleIndexScheduler.getState();
  if (schedulerState.isRunning) {
    return res.json({ started: false, alreadyRunning: true });
  }
  saleIndexScheduler.runNow().catch((err) => {
    logger.error('Manual sale index refresh failed', { message: err.message });
  });
  res.json({ started: true });
});

router.post('/sale-index/stop', requireAdmin, (_req, res) => {
  saleIndexScheduler.stop();
  res.json({ stopped: true, state: saleIndexScheduler.getState() });
});

router.post('/sale-index/cancel', requireAdmin, (_req, res) => {
  const result = saleIndexScheduler.cancel();
  res.json({ ...result, state: saleIndexScheduler.getState() });
});

router.get('/sale-index/runs', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { rows } = await pool.query(
      `SELECT id, status, products_found, products_updated, pages_scanned,
              products_deleted, total_items, log, error, started_at, finished_at
       FROM sale_index_runs
       ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    res.json({ runs: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/sale-index/products', requireAdmin, async (req, res, next) => {
  try {
    const date = req.query.date || null;
    if (date) {
      const products = await saleIndexService.getProductsByEndDay(date);
      return res.json({ products });
    }
    const { rows } = await pool.query(
      `SELECT product_id, title, discount_percent, deal_end_day, last_seen_at
       FROM sale_products
       ORDER BY discount_percent DESC NULLS LAST, last_seen_at DESC
       LIMIT 100`,
    );
    res.json({ products: rows });
  } catch (err) {
    next(err);
  }
});

// List deal-end dates with product counts (for the broadcast date picker).
router.get('/sale-index/end-dates', requireAdmin, async (_req, res, next) => {
  try {
    const dates = await saleIndexService.listSaleEndDates();
    res.json({ dates });
  } catch (err) {
    next(err);
  }
});

// Manually broadcast a "discount ending" reminder for a given end date to every
// user who has one of those games in their favorites.
let saleEndingBroadcastRunning = false;
router.post('/sale-index/send-reminders', requireAdmin, async (req, res, next) => {
  const date = String(req.body?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Некорректная дата (ожидается YYYY-MM-DD)' });
  }
  if (saleEndingBroadcastRunning) {
    return res.status(409).json({ error: 'Рассылка уже выполняется' });
  }
  saleEndingBroadcastRunning = true;
  try {
    const report = await runSaleEndingBroadcast(date);
    res.json({ report });
  } catch (err) {
    next(err);
  } finally {
    saleEndingBroadcastRunning = false;
  }
});

// ----- Special-offer manual notification -----
let specialOfferNotifyRunning = false;

// Returns all games that have special_offer_url set, with title/image and favorites count
router.get('/special-offer-notify/games', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        po.product_id                                                  AS id,
        COALESCE(po.title, cps.data->>'title', sp.title, po.product_id) AS title,
        COALESCE(cps.data->>'image', sp.image)                         AS image,
        po.special_offer_url,
        COUNT(f.user_id)::int                                          AS favorites_count
      FROM product_overrides po
      LEFT JOIN collection_product_snapshots cps ON cps.product_id = po.product_id
      LEFT JOIN sale_products sp ON sp.product_id = po.product_id
      LEFT JOIN favorites f ON f.product_id = po.product_id
      WHERE po.special_offer_url IS NOT NULL AND po.special_offer_url <> ''
      GROUP BY po.product_id, po.title, cps.data, sp.title, sp.image, po.special_offer_url
      ORDER BY COUNT(f.user_id) DESC, po.updated_at DESC
    `);
    res.json({ games: rows });
  } catch (err) {
    next(err);
  }
});

// Returns how many users have this game in their favorites (preview before sending)
router.get('/special-offer-notify/count', requireAdmin, async (req, res, next) => {
  const productId = String(req.query.productId || '').trim().toUpperCase();
  if (!productId) return res.status(400).json({ error: 'productId обязателен' });
  try {
    const count = await getFavoritesCountForProduct(productId);
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// Sends special-offer notifications to all users who have this game in favorites
router.post('/special-offer-notify', requireAdmin, async (req, res, next) => {
  if (specialOfferNotifyRunning) {
    return res.status(409).json({ error: 'Рассылка уже выполняется' });
  }
  const productId = String(req.body?.productId || '').trim().toUpperCase();
  if (!productId) return res.status(400).json({ error: 'productId обязателен' });

  specialOfferNotifyRunning = true;
  try {
    const report = await runManualSpecialOfferNotification(productId);
    res.json({ report });
  } catch (err) {
    next(err);
  } finally {
    specialOfferNotifyRunning = false;
  }
});

// ----- Broadcast -----
let broadcastRunning = false;
router.post('/broadcast', requireAdmin, async (req, res, next) => {
  if (broadcastRunning) {
    return res.status(409).json({ error: 'Рассылка уже выполняется' });
  }
  const { text, photoUrl, buttons, channels, emailSubject } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Текст сообщения не может быть пустым' });
  }
  const ch = channels || {};
  if (!ch.telegram && !ch.vk && !ch.email) {
    return res.status(400).json({ error: 'Выберите хотя бы один канал' });
  }
  broadcastRunning = true;
  try {
    const report = await runBroadcast({
      text: String(text).trim(),
      photoUrl: photoUrl ? String(photoUrl).trim() : null,
      buttons: Array.isArray(buttons) ? buttons.filter((b) => b.text && b.url) : [],
      channels: { telegram: Boolean(ch.telegram), vk: Boolean(ch.vk), email: Boolean(ch.email) },
      emailSubject: emailSubject ? String(emailSubject).trim() : null,
    });
    res.json({ report });
  } catch (err) {
    next(err);
  } finally {
    broadcastRunning = false;
  }
});

module.exports = router;

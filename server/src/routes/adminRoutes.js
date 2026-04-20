const { Router } = require('express');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const pool = require('../db/pool');
const config = require('../config');
const dealScheduler = require('../services/dealScheduler');
const digisellerService = require('../services/digisellerService');
const logger = require('../utils/logger');

const router = Router();

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
      SELECT product_id, snapshot->>'title' AS title, COUNT(*)::int AS count
      FROM favorites
      GROUP BY product_id, snapshot->>'title'
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
      pool.query('SELECT product_id, snapshot, created_at FROM favorites WHERE user_id = $1 ORDER BY updated_at DESC', [userId]),
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
    res.json({ success: true, message: 'Deal check completed' });
  } catch (err) {
    logger.error('Manual deal check failed', { message: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== Digiseller mappings ====================

router.get('/digiseller', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const search = (req.query.search || '').trim();

    const result = await digisellerService.listMappings({ page, limit, search });
    res.json({
      ...result,
      sellerId: config.digiseller.sellerId || null,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/digiseller/rates', requireAdmin, async (_req, res, next) => {
  try {
    const state = await digisellerService.getPriceRateState();
    res.json(state);
  } catch (err) {
    next(err);
  }
});

router.post('/digiseller/rates/refresh', requireAdmin, async (_req, res, next) => {
  try {
    const result = await digisellerService.refreshPriceRateTable();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

router.post('/digiseller', requireAdmin, async (req, res, next) => {
  try {
    const productId = String(req.body.productId || '').trim();
    const digisellerIdRaw = req.body.digisellerId;
    const note = req.body.note != null ? String(req.body.note).trim() : null;

    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }
    const digisellerId = Number(digisellerIdRaw);
    if (!Number.isInteger(digisellerId) || digisellerId <= 0) {
      return res.status(400).json({ error: 'digisellerId must be a positive integer' });
    }

    const item = await digisellerService.upsertMapping({ productId, digisellerId, note });
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

router.delete('/digiseller/:productId', requireAdmin, async (req, res, next) => {
  try {
    const ok = await digisellerService.deleteMapping(req.params.productId);
    if (!ok) return res.status(404).json({ error: 'Mapping not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

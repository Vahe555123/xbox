const pool = require('../db/pool');
const config = require('../config');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function getTelegramConfigAdminUserIdSet(userIds = []) {
  const adminTelegramIds = config.admin.telegramIds || [];
  if (!adminTelegramIds.length) {
    return new Set();
  }

  const params = [adminTelegramIds];
  let where = `provider = 'telegram' AND provider_user_id = ANY($1)`;

  if (Array.isArray(userIds) && userIds.length > 0) {
    params.push(userIds);
    where += ' AND user_id = ANY($2)';
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT user_id
     FROM oauth_accounts
     WHERE ${where} AND user_id IS NOT NULL`,
    params,
  );

  return new Set(rows.map((row) => row.user_id).filter(Boolean));
}

function resolveUserAdminAccess(user, { telegramConfigAdminUserIds = new Set() } = {}) {
  const sources = [];
  const normalizedEmail = normalizeEmail(user?.email);

  if (Boolean(user?.is_admin)) {
    sources.push('panel');
  }
  if (normalizedEmail && (config.admin.emails || []).includes(normalizedEmail)) {
    sources.push('config-email');
  }
  if (user?.id && telegramConfigAdminUserIds.has(user.id)) {
    sources.push('config-telegram');
  }

  return {
    ...user,
    isAdmin: sources.length > 0,
    isManualAdmin: Boolean(user?.is_admin),
    isConfigAdmin: sources.some((source) => source.startsWith('config-')),
    adminSources: sources,
  };
}

async function enrichUsersWithAdminAccess(users = []) {
  const userIds = users.map((user) => user?.id).filter(Boolean);
  const telegramConfigAdminUserIds = await getTelegramConfigAdminUserIdSet(userIds);
  return users.map((user) => resolveUserAdminAccess(user, { telegramConfigAdminUserIds }));
}

async function enrichUserWithAdminAccess(user) {
  if (!user) return null;
  const [enriched] = await enrichUsersWithAdminAccess([user]);
  return enriched || null;
}

async function isUserAdmin(user) {
  const enriched = await enrichUserWithAdminAccess(user);
  return Boolean(enriched?.isAdmin);
}

async function setUserAdminAccess(userId, isAdmin) {
  const { rows } = await pool.query(
    `UPDATE users
     SET is_admin = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId, Boolean(isAdmin)],
  );

  return rows[0] || null;
}

module.exports = {
  enrichUserWithAdminAccess,
  enrichUsersWithAdminAccess,
  getTelegramConfigAdminUserIdSet,
  isUserAdmin,
  resolveUserAdminAccess,
  setUserAdminAccess,
};

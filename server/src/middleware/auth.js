const config = require('../config');
const { AppError } = require('../utils/errorFormatter');
const { verifyToken, findUserById } = require('../services/authService');

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').map((part) => part.trim()).filter(Boolean);
  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index === -1) continue;
    const key = decodeURIComponent(cookie.slice(0, index));
    if (key === name) {
      return decodeURIComponent(cookie.slice(index + 1));
    }
  }
  return '';
}

async function requireAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = bearerToken || readCookie(req, config.auth.cookieName);

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    const payload = verifyToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      throw new AppError('Authentication required', 401);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Authentication required', 401));
  }
}

async function requireAdmin(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = bearerToken || readCookie(req, config.auth.cookieName);

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    const payload = verifyToken(token);
    const user = await findUserById(payload.sub);
    if (!user) {
      throw new AppError('Authentication required', 401);
    }

    // Check admin access
    const adminEmails = config.admin.emails;
    const adminTgIds = config.admin.telegramIds;

    const isAdminByEmail = user.email && adminEmails.includes(user.email.toLowerCase());

    // Check if user has a telegram oauth account matching admin IDs
    let isAdminByTg = false;
    if (adminTgIds.length > 0) {
      const pool = require('../db/pool');
      const { rows } = await pool.query(
        `SELECT provider_user_id FROM oauth_accounts
         WHERE user_id = $1 AND provider = 'telegram'`,
        [user.id],
      );
      isAdminByTg = rows.some((r) => adminTgIds.includes(r.provider_user_id));
    }

    if (!isAdminByEmail && !isAdminByTg) {
      throw new AppError('Admin access required', 403);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Authentication required', 401));
  }
}

module.exports = { requireAuth, requireAdmin };

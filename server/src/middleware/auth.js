const { AppError } = require('../utils/errorFormatter');
const config = require('../config');
const { verifyToken, findUserById } = require('../services/authService');
const { isUserAdmin } = require('../services/adminAccessService');

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

async function optionalAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const token = bearerToken || readCookie(req, config.auth.cookieName);
    if (!token) return next();

    const payload = verifyToken(token);
    const user = await findUserById(payload.sub);
    if (user) req.user = user;
    return next();
  } catch (_err) {
    return next();
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

    if (!await isUserAdmin(user)) {
      throw new AppError('Admin access required', 403);
    }

    req.user = user;
    next();
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new AppError('Authentication required', 401));
  }
}

module.exports = { requireAuth, optionalAuth, requireAdmin };

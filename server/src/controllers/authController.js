const { AppError } = require('../utils/errorFormatter');
const config = require('../config');
const logger = require('../utils/logger');
const {
  registerUser,
  verifyEmail,
  loginUser,
  getProfile,
  changePassword,
  getAuthProviderConfig,
  createOAuthStartUrl,
  finishOAuthLogin,
  loginWithTelegram,
  createOAuthSession,
  consumeOAuthSession,
} = require('../services/authService');

function setAuthCookie(res, token) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: config.auth.cookieSameSite,
    maxAge: config.auth.cookieTtlMs,
    path: '/',
  });
}

function redirectToClient(res, params) {
  const url = new URL(config.clientOrigin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  res.redirect(url.toString());
}

async function register(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }
    if (String(password).length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    const result = await registerUser(email, password);
    logger.info('User registered', { email: result.email });

    res.status(201).json({
      success: true,
      message: 'Registered. Verification code sent to email.',
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err.message === 'User already exists') {
      return next(new AppError('User already exists', 409));
    }
    next(err);
  }
}

async function verify(req, res, next) {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      throw new AppError('Email and code are required', 400);
    }

    const result = await verifyEmail(email, code);
    logger.info('Email verified', { email: result.email });

    res.json({
      success: true,
      message: 'Email verified',
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err.message === 'User not found') {
      return next(new AppError('User not found', 404));
    }
    if (err.message === 'Invalid or expired verification code') {
      return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const result = await loginUser(email, password);
    logger.info('User login', { email: result.email });
    setAuthCookie(res, result.token);

    res.json({
      success: true,
      token: result.token,
      email: result.email,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (['Invalid credentials', 'Email not verified'].includes(err.message)) {
      return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

function providers(_req, res) {
  res.json({
    success: true,
    providers: getAuthProviderConfig(),
  });
}

async function oauthStart(req, res, next) {
  try {
    const url = await createOAuthStartUrl(req.params.provider);
    res.redirect(url);
  } catch (err) {
    if (err.message === 'Unsupported OAuth provider') {
      return next(new AppError(err.message, 404));
    }
    if (err.message.includes('OAuth is not configured')) {
      return next(new AppError(err.message, 503));
    }
    next(err);
  }
}

async function oauthCallback(req, res) {
  const { provider } = req.params;

  try {
    const result = await finishOAuthLogin(provider, req.query || {});
    setAuthCookie(res, result.token);

    const sessionId = await createOAuthSession(result);
    logger.info('OAuth login', { provider, user: result.user.email || result.user.name });

    redirectToClient(res, {
      auth_provider: provider,
      auth_session: sessionId,
    });
  } catch (err) {
    logger.error('OAuth callback failed', {
      provider,
      message: err.message,
    });

    redirectToClient(res, {
      auth_error: err.message || 'OAuth login failed',
      auth_provider: provider,
    });
  }
}

async function oauthSession(req, res, next) {
  try {
    const result = await consumeOAuthSession(req.params.sessionId);
    setAuthCookie(res, result.token);

    res.json({
      success: true,
      token: result.token,
      user: result.user,
      email: result.user.email,
    });
  } catch (err) {
    if (err.message === 'OAuth session expired') {
      return next(new AppError(err.message, 410));
    }
    next(err);
  }
}

async function telegram(req, res, next) {
  try {
    const result = await loginWithTelegram(req.body || {});
    setAuthCookie(res, result.token);
    logger.info('Telegram login', { user: result.user.name });

    res.json({
      success: true,
      token: result.token,
      user: result.user,
      email: result.user.email,
    });
  } catch (err) {
    if ([
      'Telegram bot token is required',
      'Invalid Telegram login payload',
      'Telegram login payload expired',
      'Invalid Telegram login signature',
    ].includes(err.message)) {
      return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const profile = await getProfile(req.user.id);
    res.json({
      success: true,
      ...profile,
    });
  } catch (err) {
    if (err.message === 'User not found') {
      return next(new AppError(err.message, 404));
    }
    next(err);
  }
}

async function updatePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }
    if (String(newPassword).length < 6) {
      throw new AppError('Password must be at least 6 characters', 400);
    }

    await changePassword(req.user.id, currentPassword, newPassword);
    res.json({
      success: true,
      message: 'Password changed',
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if ([
      'User not found',
      'Password login is not enabled for this account',
      'Invalid current password',
    ].includes(err.message)) {
      return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

module.exports = {
  register,
  verify,
  login,
  providers,
  oauthStart,
  oauthCallback,
  oauthSession,
  telegram,
  me,
  updatePassword,
};


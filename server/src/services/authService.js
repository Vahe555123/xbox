const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const config = require('../config');
const pool = require('../db/pool');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-me';
}

function getProfileEncryptionKey() {
  const secret = process.env.PROFILE_ENCRYPTION_SECRET || getJwtSecret();
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptProfileSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getProfileEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptProfileSecret(value) {
  if (!value) return '';
  const [version, ivHex, tagHex, encryptedHex] = String(value).split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !encryptedHex) return '';
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getProfileEncryptionKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch (_err) {
    return '';
  }
}

function normalizePurchasePaymentMode(mode) {
  const allowed = new Set(['oplata', 'key_activation', 'topup_cards']);
  return allowed.has(mode) ? mode : 'oplata';
}

function toPurchaseSettings(user) {
  return {
    purchaseEmail: user.purchase_email || '',
    xboxAccountEmail: user.xbox_account_email || '',
    hasXboxAccountPassword: Boolean(user.xbox_account_password_encrypted),
    paymentMode: normalizePurchasePaymentMode(user.purchase_payment_mode),
  };
}

function getApiOrigin() {
  return config.apiPublicOrigin.replace(/\/$/, '');
}

function getRedirectUri(provider) {
  const providerConfig = config.auth[provider];
  return providerConfig.redirectUri || `${getApiOrigin()}/api/auth/oauth/${provider}/callback`;
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email || '',
    name: user.name || user.email || 'Player',
    avatar: user.avatar || '',
    provider: user.last_provider || user.lastProvider || 'email',
  };
}

async function getProfile(userId) {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const { rows: providers } = await pool.query(
    `SELECT provider FROM oauth_accounts WHERE user_id = $1 ORDER BY provider`,
    [userId],
  );

  const providerNames = providers.map((row) => row.provider);
  if (user.password_hash) {
    providerNames.unshift('email');
  }

  return {
    user: toPublicUser(user),
    verified: user.verified,
    hasPassword: Boolean(user.password_hash),
    providers: [...new Set(providerNames)],
    purchaseSettings: toPurchaseSettings(user),
    createdAt: user.created_at,
  };
}

async function getPurchaseSettingsForCheckout(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  return {
    ...toPurchaseSettings(user),
    xboxAccountPassword: decryptProfileSecret(user.xbox_account_password_encrypted),
  };
}

async function updatePurchaseSettings(userId, settings = {}) {
  const current = await findUserById(userId);
  if (!current) {
    throw new Error('User not found');
  }

  const purchaseEmail = normalizeEmail(settings.purchaseEmail);
  const xboxAccountEmail = normalizeEmail(settings.xboxAccountEmail);
  const paymentMode = normalizePurchasePaymentMode(settings.paymentMode);
  let encryptedPassword = current.xbox_account_password_encrypted || null;
  if (settings.clearXboxAccountPassword) {
    encryptedPassword = null;
  } else if (settings.xboxAccountPassword) {
    encryptedPassword = encryptProfileSecret(settings.xboxAccountPassword);
  }

  const { rows } = await pool.query(
    `UPDATE users
     SET purchase_email = $2,
         xbox_account_email = $3,
         xbox_account_password_encrypted = $4,
         purchase_payment_mode = $5,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      userId,
      purchaseEmail || null,
      xboxAccountEmail || null,
      encryptedPassword,
      paymentMode,
    ],
  );

  return toPurchaseSettings(rows[0]);
}

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email || undefined,
      name: user.name || undefined,
      provider: user.last_provider || user.lastProvider || 'email',
    },
    getJwtSecret(),
    { expiresIn: '7d' },
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function createTransport() {
  return nodemailer.createTransport({
    host: config.auth.smtp.host,
    port: config.auth.smtp.port,
    secure: config.auth.smtp.secure,
    auth: {
      user: config.auth.smtp.username,
      pass: config.auth.smtp.password,
    },
  });
}

function getFromAddress() {
  if (config.auth.smtp.from) return config.auth.smtp.from;
  if (!config.auth.smtp.fromEmail) return config.auth.smtp.username;
  return `"${config.auth.smtp.fromName}" <${config.auth.smtp.fromEmail}>`;
}

async function sendVerificationCode(email, code) {
  const transporter = createTransport();

  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject: 'Your Xbox Store verification code',
    text: `Your verification code is: ${code}`,
  });
}

async function findUserById(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}

async function registerUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new Error('User already exists');
  }

  const userId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO users (id, email, password_hash, verified, last_provider)
     VALUES ($1, $2, $3, false, 'email')`,
    [userId, normalizedEmail, passwordHash],
  );

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  await pool.query(
    `INSERT INTO email_verification_codes (email, code_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
     ON CONFLICT (email)
     DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
    [normalizedEmail, codeHash],
  );
  await sendVerificationCode(normalizedEmail, code);

  return { email: normalizedEmail };
}

async function verifyEmail(email, code) {
  const normalizedEmail = normalizeEmail(email);
  const { rows: users } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  const user = users[0];
  if (!user) {
    throw new Error('User not found');
  }

  const { rows: codes } = await pool.query(
    'SELECT * FROM email_verification_codes WHERE email = $1 AND expires_at > NOW()',
    [normalizedEmail],
  );
  const savedCode = codes[0];
  if (!savedCode || !(await bcrypt.compare(String(code), savedCode.code_hash))) {
    throw new Error('Invalid or expired verification code');
  }

  await pool.query('UPDATE users SET verified = true, updated_at = NOW() WHERE id = $1', [user.id]);
  await pool.query('DELETE FROM email_verification_codes WHERE email = $1', [normalizedEmail]);
  return { email: normalizedEmail };
}

async function loginUser(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  const user = rows[0];
  if (!user || !user.password_hash) {
    throw new Error('Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new Error('Invalid credentials');
  }
  if (!user.verified) {
    throw new Error('Email not verified');
  }

  const { rows: updatedRows } = await pool.query(
    `UPDATE users SET last_provider = 'email', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [user.id],
  );
  const updatedUser = updatedRows[0];
  const token = issueToken(updatedUser);

  return { email: normalizedEmail, token, user: toPublicUser(updatedUser) };
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await findUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  if (!user.password_hash) {
    throw new Error('Password login is not enabled for this account');
  }

  const ok = await bcrypt.compare(String(currentPassword || ''), user.password_hash);
  if (!ok) {
    throw new Error('Invalid current password');
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await pool.query(
    `UPDATE users
     SET password_hash = $2, updated_at = NOW()
     WHERE id = $1`,
    [userId, passwordHash],
  );
}

function getAuthProviderConfig() {
  return {
    google: {
      enabled: Boolean(config.auth.google.clientId && config.auth.google.clientSecret),
    },
    vk: {
      enabled: Boolean(config.auth.vk.clientId && config.auth.vk.clientSecret),
    },
    telegram: {
      enabled: Boolean(config.auth.telegram.botUsername),
      ready: Boolean(config.auth.telegram.botUsername && config.auth.telegram.botToken),
      botUsername: config.auth.telegram.botUsername,
    },
  };
}

function assertOAuthProvider(provider) {
  if (!['google', 'vk'].includes(provider)) {
    throw new Error('Unsupported OAuth provider');
  }
  const providerConfig = config.auth[provider];
  if (!providerConfig.clientId || !providerConfig.clientSecret) {
    throw new Error(`${provider} OAuth is not configured`);
  }
}

async function createOAuthStartUrl(provider) {
  assertOAuthProvider(provider);

  const state = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO oauth_states (state, provider, expires_at)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'))`,
    [state, provider, config.auth.oauthStateTtlSeconds],
  );

  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', config.auth.google.clientId);
    url.searchParams.set('redirect_uri', getRedirectUri('google'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  const url = new URL('https://oauth.vk.com/authorize');
  url.searchParams.set('client_id', config.auth.vk.clientId);
  url.searchParams.set('display', 'page');
  url.searchParams.set('redirect_uri', getRedirectUri('vk'));
  url.searchParams.set('scope', 'email');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('v', config.auth.vk.apiVersion);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeGoogleCode(code) {
  const { data: token } = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: config.auth.google.clientId,
      client_secret: config.auth.google.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getRedirectUri('google'),
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  const { data: profile } = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!profile.sub) {
    throw new Error('Google profile response is missing user id');
  }

  return {
    provider: 'google',
    providerId: String(profile.sub),
    email: normalizeEmail(profile.email),
    name: profile.name || profile.email || 'Google user',
    avatar: profile.picture || '',
  };
}

async function exchangeVkCode(code) {
  const tokenUrl = new URL('https://oauth.vk.com/access_token');
  tokenUrl.searchParams.set('client_id', config.auth.vk.clientId);
  tokenUrl.searchParams.set('client_secret', config.auth.vk.clientSecret);
  tokenUrl.searchParams.set('redirect_uri', getRedirectUri('vk'));
  tokenUrl.searchParams.set('code', code);

  const { data: token } = await axios.get(tokenUrl.toString());
  if (token.error) {
    throw new Error(token.error_description || token.error);
  }

  const profileUrl = new URL('https://api.vk.com/method/users.get');
  profileUrl.searchParams.set('user_ids', String(token.user_id));
  profileUrl.searchParams.set('fields', 'photo_100');
  profileUrl.searchParams.set('access_token', token.access_token);
  profileUrl.searchParams.set('v', config.auth.vk.apiVersion);

  const { data: profileResponse } = await axios.get(profileUrl.toString());
  if (profileResponse.error) {
    throw new Error(profileResponse.error.error_msg || 'VK profile request failed');
  }

  const profile = profileResponse.response?.[0] || {};
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();

  return {
    provider: 'vk',
    providerId: String(token.user_id || profile.id),
    email: normalizeEmail(token.email),
    name: name || `VK ${token.user_id}`,
    avatar: profile.photo_100 || '',
  };
}

async function upsertSocialUser(profile) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const linked = await client.query(
      `SELECT u.* FROM oauth_accounts oa
       JOIN users u ON u.id = oa.user_id
       WHERE oa.provider = $1 AND oa.provider_user_id = $2`,
      [profile.provider, profile.providerId],
    );

    let user = linked.rows[0] || null;
    const emailKey = normalizeEmail(profile.email);

    if (!user && emailKey) {
      const byEmail = await client.query('SELECT * FROM users WHERE email = $1', [emailKey]);
      user = byEmail.rows[0] || null;
    }

    if (!user) {
      const userId = crypto.randomUUID();
      const inserted = await client.query(
        `INSERT INTO users (id, email, verified, name, avatar, last_provider)
         VALUES ($1, $2, true, $3, $4, $5)
         RETURNING *`,
        [userId, emailKey || null, profile.name || null, profile.avatar || null, profile.provider],
      );
      user = inserted.rows[0];
    } else {
      const updated = await client.query(
        `UPDATE users
         SET
           verified = true,
           name = COALESCE($2, name),
           avatar = COALESCE($3, avatar),
           last_provider = $4,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [user.id, profile.name || null, profile.avatar || null, profile.provider],
      );
      user = updated.rows[0];
    }

    await client.query(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET user_id = EXCLUDED.user_id`,
      [profile.provider, profile.providerId, user.id],
    );

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function finishOAuthLogin(provider, query) {
  assertOAuthProvider(provider);

  if (query.error) {
    throw new Error(query.error_description || query.error);
  }
  if (!query.code || !query.state) {
    throw new Error('OAuth callback is missing code or state');
  }

  const stateResult = await pool.query(
    `DELETE FROM oauth_states
     WHERE state = $1 AND provider = $2 AND expires_at > NOW()
     RETURNING state`,
    [query.state, provider],
  );
  if (stateResult.rows.length === 0) {
    throw new Error('Invalid or expired OAuth state');
  }

  const profile = provider === 'google'
    ? await exchangeGoogleCode(query.code)
    : await exchangeVkCode(query.code);

  const user = await upsertSocialUser(profile);
  const token = issueToken(user);

  return { token, user: toPublicUser(user) };
}

function safeHexCompare(left, right) {
  try {
    const leftBuffer = Buffer.from(left, 'hex');
    const rightBuffer = Buffer.from(right, 'hex');
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch (_err) {
    return false;
  }
}

function verifyTelegramPayload(payload) {
  if (!config.auth.telegram.botToken) {
    throw new Error('Telegram bot token is required');
  }

  const receivedHash = String(payload.hash || '');
  const authDate = Number(payload.auth_date);
  if (!receivedHash || !authDate) {
    throw new Error('Invalid Telegram login payload');
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > config.auth.telegramLoginTtlSeconds) {
    throw new Error('Telegram login payload expired');
  }

  const checkString = Object.keys(payload)
    .filter((key) => key !== 'hash' && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n');

  const secret = crypto.createHash('sha256').update(config.auth.telegram.botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  if (!safeHexCompare(calculatedHash, receivedHash)) {
    throw new Error('Invalid Telegram login signature');
  }

  const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim();
  return {
    provider: 'telegram',
    providerId: String(payload.id),
    email: '',
    name: name || payload.username || `Telegram ${payload.id}`,
    avatar: payload.photo_url || '',
  };
}

async function loginWithTelegram(payload) {
  const profile = verifyTelegramPayload(payload || {});
  const user = await upsertSocialUser(profile);
  const token = issueToken(user);
  return { token, user: toPublicUser(user) };
}

async function createOAuthSession(authResult) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  await pool.query(
    `INSERT INTO oauth_sessions (id, payload, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '2 minutes')`,
    [sessionId, authResult],
  );
  return sessionId;
}

async function consumeOAuthSession(sessionId) {
  const result = await pool.query(
    `DELETE FROM oauth_sessions
     WHERE id = $1 AND expires_at > NOW()
     RETURNING payload`,
    [sessionId],
  );
  if (result.rows.length === 0) {
    throw new Error('OAuth session expired');
  }
  return result.rows[0].payload;
}

module.exports = {
  registerUser,
  verifyEmail,
  loginUser,
  getProfile,
  getPurchaseSettingsForCheckout,
  updatePurchaseSettings,
  changePassword,
  verifyToken,
  findUserById,
  getAuthProviderConfig,
  createOAuthStartUrl,
  finishOAuthLogin,
  loginWithTelegram,
  createOAuthSession,
  consumeOAuthSession,
};

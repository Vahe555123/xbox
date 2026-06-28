const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const pool = require('../db/pool');
const { linkTelegramChatToUser } = require('./telegramBotService');
const { createSmtpTransport, getFromAddress } = require('./mailTransport');

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
    notifyDeals: user.notify_deals !== false,
    notifySpecialOffers: user.notify_special_offers !== false,
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

  const purchaseSettings = {
    ...toPurchaseSettings(user),
    hasXboxAccountPassword: Boolean(
      user.xbox_account_password_encrypted &&
      decryptProfileSecret(user.xbox_account_password_encrypted),
    ),
  };

  return {
    user: toPublicUser(user),
    verified: user.verified,
    hasPassword: Boolean(user.password_hash),
    providers: [...new Set(providerNames)],
    purchaseSettings,
    createdAt: user.created_at,
  };
}

async function getPurchaseSettingsForCheckout(userId) {
  const user = await findUserById(userId);
  if (!user) return null;
  const xboxAccountPassword = decryptProfileSecret(user.xbox_account_password_encrypted) || null;
  return {
    ...toPurchaseSettings(user),
    // override hasXboxAccountPassword to reflect actual decryption result —
    // encrypted value may exist in DB but fail to decrypt (e.g. key rotation)
    hasXboxAccountPassword: Boolean(xboxAccountPassword),
    xboxAccountPassword,
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

  const notifyDeals = settings.notifyDeals !== undefined ? Boolean(settings.notifyDeals) : undefined;
  const notifySpecialOffers = settings.notifySpecialOffers !== undefined ? Boolean(settings.notifySpecialOffers) : undefined;

  const { rows } = await pool.query(
    `UPDATE users
     SET purchase_email = $2,
         xbox_account_email = $3,
         xbox_account_password_encrypted = $4,
         purchase_payment_mode = $5,
         notify_deals = COALESCE($6, notify_deals),
         notify_special_offers = COALESCE($7, notify_special_offers),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      userId,
      purchaseEmail || null,
      xboxAccountEmail || null,
      encryptedPassword,
      paymentMode,
      notifyDeals !== undefined ? notifyDeals : null,
      notifySpecialOffers !== undefined ? notifySpecialOffers : null,
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

async function sendVerificationCode(email, code) {
  const transporter = createSmtpTransport();

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

async function createOAuthStartUrl(provider, linkUserId = null) {
  assertOAuthProvider(provider);

  const state = crypto.randomBytes(24).toString('hex');

  if (provider === 'vk') {
    const codeVerifier = crypto.randomBytes(72).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    await pool.query(
      `INSERT INTO oauth_states (state, provider, expires_at, link_user_id, code_verifier)
       VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'), $4, $5)`,
      [state, provider, config.auth.oauthStateTtlSeconds, linkUserId || null, codeVerifier],
    );

    const url = new URL('https://id.vk.com/authorize');
    url.searchParams.set('client_id', config.auth.vk.clientId);
    url.searchParams.set('redirect_uri', getRedirectUri('vk'));
    url.searchParams.set('scope', 'email');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  await pool.query(
    `INSERT INTO oauth_states (state, provider, expires_at, link_user_id)
     VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 second'), $4)`,
    [state, provider, config.auth.oauthStateTtlSeconds, linkUserId || null],
  );

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.auth.google.clientId);
  url.searchParams.set('redirect_uri', getRedirectUri('google'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
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

async function exchangeVkCode(code, codeVerifier, deviceId) {
  // VK ID (OAuth 2.1) token exchange — requires PKCE code_verifier and device_id
  const params = {
    grant_type: 'authorization_code',
    client_id: config.auth.vk.clientId,
    redirect_uri: getRedirectUri('vk'),
    code,
  };
  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }
  if (deviceId) {
    params.device_id = deviceId;
  }

  const { data: token } = await axios.post(
    'https://id.vk.com/oauth2/auth',
    new URLSearchParams(params).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  if (token.error) {
    throw new Error(token.error_description || token.error);
  }

  // VK ID user info endpoint
  const { data: profileResponse } = await axios.post(
    'https://id.vk.com/oauth2/user_info',
    new URLSearchParams({
      client_id: config.auth.vk.clientId,
      access_token: token.access_token,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  if (profileResponse.error) {
    throw new Error(profileResponse.error_description || profileResponse.error || 'VK profile request failed');
  }

  const profile = profileResponse.user || {};
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const userId = profile.user_id || token.user_id;

  return {
    provider: 'vk',
    providerId: String(userId),
    email: normalizeEmail(profile.email || token.email),
    name: name || `VK ${userId}`,
    avatar: profile.avatar || '',
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
      // First-account priority: keep existing name/avatar, only fill blanks.
      const updated = await client.query(
        `UPDATE users
         SET
           verified = true,
           name = COALESCE(name, $2),
           avatar = COALESCE(avatar, $3),
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

// Merge all data of `mergedId` into `survivorId`, then delete the merged user.
// `survivorId` stays the active account (keeps the current session valid);
// on conflicting profile fields the OLDER account (first login) wins, while
// favorites / purchase history / reminders from both accounts are combined.
async function mergeUsers(client, survivorId, mergedId) {
  if (!mergedId || survivorId === mergedId) return;

  const { rows } = await client.query(
    `SELECT id, email, name, avatar, password_hash, is_admin,
            purchase_email, xbox_account_email, xbox_account_password_encrypted,
            purchase_payment_mode, created_at
       FROM users WHERE id IN ($1, $2)`,
    [survivorId, mergedId],
  );
  const survivor = rows.find((r) => r.id === survivorId);
  const merged = rows.find((r) => r.id === mergedId);
  if (!survivor || !merged) return;

  // First login (older created_at) takes priority on conflicting fields.
  const survivorFirst = new Date(survivor.created_at) <= new Date(merged.created_at);
  const primary = survivorFirst ? survivor : merged;
  const secondary = survivorFirst ? merged : survivor;

  // Reassign child data (dedup where a composite key would collide).
  await client.query(
    `UPDATE favorites SET user_id = $1
       WHERE user_id = $2
         AND product_id NOT IN (SELECT product_id FROM favorites WHERE user_id = $1)`,
    [survivorId, mergedId],
  );
  await client.query(`DELETE FROM favorites WHERE user_id = $1`, [mergedId]);

  await client.query(`UPDATE purchases SET user_id = $1 WHERE user_id = $2`, [survivorId, mergedId]);

  await client.query(
    `UPDATE deal_notifications SET user_id = $1
       WHERE user_id = $2
         AND (product_id, deal_key) NOT IN
             (SELECT product_id, deal_key FROM deal_notifications WHERE user_id = $1)`,
    [survivorId, mergedId],
  );
  await client.query(`DELETE FROM deal_notifications WHERE user_id = $1`, [mergedId]);

  await client.query(
    `UPDATE sale_end_reminders SET user_id = $1
       WHERE user_id = $2
         AND deal_end_day NOT IN (SELECT deal_end_day FROM sale_end_reminders WHERE user_id = $1)`,
    [survivorId, mergedId],
  );
  await client.query(`DELETE FROM sale_end_reminders WHERE user_id = $1`, [mergedId]);

  await client.query(`UPDATE telegram_bot_chats SET user_id = $1 WHERE user_id = $2`, [survivorId, mergedId]);
  await client.query(`UPDATE oauth_accounts SET user_id = $1 WHERE user_id = $2`, [survivorId, mergedId]);

  // Delete merged user only after all child rows were reassigned (avoids cascade loss).
  await client.query(`DELETE FROM users WHERE id = $1`, [mergedId]);

  await client.query(
    `UPDATE users SET
       email = COALESCE($2, $3),
       name = COALESCE($4, $5),
       avatar = COALESCE($6, $7),
       password_hash = COALESCE($8, $9),
       purchase_email = COALESCE($10, $11),
       xbox_account_email = COALESCE($12, $13),
       xbox_account_password_encrypted = COALESCE($14, $15),
       purchase_payment_mode = COALESCE($16, $17),
       is_admin = $18,
       verified = true,
       updated_at = NOW()
     WHERE id = $1`,
    [
      survivorId,
      primary.email, secondary.email,
      primary.name, secondary.name,
      primary.avatar, secondary.avatar,
      primary.password_hash, secondary.password_hash,
      primary.purchase_email, secondary.purchase_email,
      primary.xbox_account_email, secondary.xbox_account_email,
      primary.xbox_account_password_encrypted, secondary.xbox_account_password_encrypted,
      primary.purchase_payment_mode, secondary.purchase_payment_mode,
      Boolean(survivor.is_admin) || Boolean(merged.is_admin),
    ],
  );
}

async function linkProviderToUser(userId, profile) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT user_id FROM oauth_accounts
       WHERE provider = $1 AND provider_user_id = $2`,
      [profile.provider, profile.providerId],
    );

    const otherUserId = existing.rows[0]?.user_id;
    if (otherUserId && otherUserId !== userId) {
      // Account already belongs to a separate user — merge it into the current one.
      await mergeUsers(client, userId, otherUserId);
    }

    await client.query(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [profile.provider, profile.providerId, userId],
    );

    await client.query(
      `UPDATE users SET last_provider = $2, updated_at = NOW() WHERE id = $1`,
      [userId, profile.provider],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function unlinkProvider(userId, provider) {
  const { rows: accounts } = await pool.query(
    `SELECT provider FROM oauth_accounts WHERE user_id = $1`,
    [userId],
  );
  const { rows: users } = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  const hasPassword = Boolean(users[0]?.password_hash);
  const totalMethods = accounts.length + (hasPassword ? 1 : 0);

  if (totalMethods <= 1) {
    throw new Error('Cannot unlink the only login method');
  }

  const { rowCount } = await pool.query(
    `DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );

  if (rowCount === 0) {
    throw new Error('Provider not linked');
  }
}

async function sendEmailLinkCode(userId, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error('Email is required');

  const { rows: conflict } = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND id != $2',
    [normalizedEmail, userId],
  );
  if (conflict.length > 0) throw new Error('Email already in use');

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

async function verifyEmailLinkCode(userId, email, code, newPassword) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new Error('Email is required');

  const { rows: conflict } = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND id != $2',
    [normalizedEmail, userId],
  );
  if (conflict.length > 0) throw new Error('Email already in use');

  const { rows: codes } = await pool.query(
    'SELECT * FROM email_verification_codes WHERE email = $1 AND expires_at > NOW()',
    [normalizedEmail],
  );
  const savedCode = codes[0];
  if (!savedCode || !(await bcrypt.compare(String(code), savedCode.code_hash))) {
    throw new Error('Invalid or expired verification code');
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await pool.query(
    `UPDATE users SET email = $2, password_hash = $3, verified = true, updated_at = NOW() WHERE id = $1`,
    [userId, normalizedEmail, passwordHash],
  );
  await pool.query('DELETE FROM email_verification_codes WHERE email = $1', [normalizedEmail]);
  return { email: normalizedEmail };
}

async function linkTelegramToUser(userId, payload) {
  const profile = verifyTelegramPayload(payload || {});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT user_id FROM oauth_accounts
       WHERE provider = 'telegram' AND provider_user_id = $1`,
      [profile.providerId],
    );

    const otherUserId = existing.rows[0]?.user_id;
    if (otherUserId && otherUserId !== userId) {
      // Telegram account already belongs to a separate user — merge it in.
      await mergeUsers(client, userId, otherUserId);
    }

    await client.query(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id)
       VALUES ('telegram', $1, $2)
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [profile.providerId, userId],
    );

    await client.query(
      `UPDATE users SET updated_at = NOW() WHERE id = $1`,
      [userId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await linkTelegramChatToUser(userId, profile.providerId);
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
     RETURNING state, link_user_id, code_verifier`,
    [query.state, provider],
  );
  if (stateResult.rows.length === 0) {
    throw new Error('Invalid or expired OAuth state');
  }

  const { link_user_id: linkUserId, code_verifier: codeVerifier } = stateResult.rows[0];

  const profile = provider === 'google'
    ? await exchangeGoogleCode(query.code)
    : await exchangeVkCode(query.code, codeVerifier, query.device_id);

  if (linkUserId) {
    await linkProviderToUser(linkUserId, profile);
    return { isLink: true, userId: linkUserId };
  }

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
  await linkTelegramChatToUser(user.id, profile.providerId);
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
  linkProviderToUser,
  unlinkProvider,
  linkTelegramToUser,
  loginWithTelegram,
  createOAuthSession,
  consumeOAuthSession,
  sendEmailLinkCode,
  verifyEmailLinkCode,
};

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const config = {
  port: parseInt(process.env.PORT, 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',

  xbox: {
    emeraldBaseUrl: process.env.XBOX_EMERALD_BASE_URL || 'https://emerald.xboxservices.com/xboxcomfd',
    catalogBaseUrl: process.env.XBOX_CATALOG_BASE_URL || 'https://displaycatalog.mp.microsoft.com',
    market: process.env.XBOX_CATALOG_MARKET || 'US',
    language: process.env.XBOX_CATALOG_LANGUAGE || 'en-US',
    locale: process.env.XBOX_CATALOG_LOCALE || 'en-US',
    pageSize: parseInt(process.env.XBOX_PAGE_SIZE, 10) || 25,
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL, 10) || 300,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60,
  },

  axios: {
    timeout: parseInt(process.env.AXIOS_TIMEOUT, 10) || 15_000,
    retryCount: parseInt(process.env.AXIOS_RETRY_COUNT, 10) || 2,
    retryDelay: parseInt(process.env.AXIOS_RETRY_DELAY, 10) || 500,
  },

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  apiPublicOrigin: process.env.API_PUBLIC_ORIGIN || `http://localhost:${parseInt(process.env.PORT, 10) || 4000}`,
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/xbox_store',

  auth: {
    cookieName: process.env.AUTH_COOKIE_NAME || 'xbox_auth_token',
    cookieSecure: parseBool(process.env.AUTH_COOKIE_SECURE, process.env.NODE_ENV === 'production'),
    cookieSameSite: process.env.AUTH_COOKIE_SAMESITE || 'lax',
    cookieTtlMs: parseInt(process.env.AUTH_COOKIE_TTL_MS, 10) || 7 * 24 * 60 * 60 * 1000,
    oauthStateTtlSeconds: parseInt(process.env.AUTH_OAUTH_STATE_TTL_SECONDS, 10) || 600,
    telegramLoginTtlSeconds: parseInt(process.env.AUTH_TELEGRAM_LOGIN_TTL_SECONDS, 10) || 300,
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    },
    vk: {
      clientId: process.env.VK_CLIENT_ID || '',
      clientSecret: process.env.VK_CLIENT_SECRET || '',
      redirectUri: process.env.VK_REDIRECT_URI || '',
      apiVersion: process.env.VK_API_VERSION || '5.199',
    },
    telegram: {
      botUsername: process.env.TELEGRAM_BOT_USERNAME || '',
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    },
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: parseBool(process.env.SMTP_SECURE, parseInt(process.env.SMTP_PORT, 10) === 465),
      username: process.env.SMTP_USERNAME || process.env.SMTP_USER || '',
      password: process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASS || '',
      fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USERNAME || process.env.SMTP_USER || '',
      fromName: process.env.SMTP_FROM_NAME || 'Xbox Search',
      from: process.env.SMTP_FROM || '',
    },
  },
  admin: {
    emails: (process.env.ADMIN_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    telegramIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',').map((id) => id.trim()).filter(Boolean),
    dealCheckIntervalHours: parseFloat(process.env.DEAL_CHECK_INTERVAL_HOURS) || 24,
  },
};

module.exports = config;

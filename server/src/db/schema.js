const pool = require('./pool');
const logger = require('../utils/logger');

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      name TEXT,
      avatar TEXT,
      last_provider TEXT NOT NULL DEFAULT 'email',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, provider_user_id)
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      email TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS oauth_sessions (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS deal_notifications (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      deal_key TEXT NOT NULL,
      notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id, deal_key)
    );

    CREATE INDEX IF NOT EXISTS idx_deal_notifications_cleanup
      ON deal_notifications (notified_at);

    CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at
      ON email_verification_codes (expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
      ON oauth_states (expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires_at
      ON oauth_sessions (expires_at);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_updated_at
      ON favorites (user_id, updated_at DESC);
  `);

  logger.info('PostgreSQL schema ready');
}

module.exports = { initDb };

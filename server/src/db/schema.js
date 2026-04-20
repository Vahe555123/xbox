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

    CREATE TABLE IF NOT EXISTS digiseller_products (
      product_id TEXT PRIMARY KEY,
      digiseller_id BIGINT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS digiseller_price_rate_runs (
      id BIGSERIAL PRIMARY KEY,
      digiseller_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      samples_count INTEGER NOT NULL DEFAULT 0,
      min_rate NUMERIC,
      max_rate NUMERIC,
      avg_rate NUMERIC,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS digiseller_price_rate_samples (
      id BIGSERIAL PRIMARY KEY,
      run_id BIGINT NOT NULL REFERENCES digiseller_price_rate_runs(id) ON DELETE CASCADE,
      digiseller_id BIGINT NOT NULL,
      target_rub NUMERIC NOT NULL,
      label TEXT,
      requested_usd NUMERIC NOT NULL,
      amount_rub NUMERIC NOT NULL,
      effective_rate NUMERIC NOT NULL,
      unit_price_rub NUMERIC,
      raw_response JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_runs_lookup
      ON digiseller_price_rate_runs (digiseller_id, status, finished_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_samples_lookup
      ON digiseller_price_rate_samples (digiseller_id, run_id, requested_usd);
  `);

  logger.info('PostgreSQL schema ready');
}

module.exports = { initDb };

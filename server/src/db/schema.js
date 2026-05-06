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

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS purchase_email TEXT,
      ADD COLUMN IF NOT EXISTS xbox_account_email TEXT,
      ADD COLUMN IF NOT EXISTS xbox_account_password_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS purchase_payment_mode TEXT NOT NULL DEFAULT 'oplata';

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, provider_user_id)
    );

    CREATE TABLE IF NOT EXISTS telegram_bot_chats (
      telegram_user_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, product_id)
    );

    ALTER TABLE favorites
      ALTER COLUMN snapshot SET DEFAULT '{}'::jsonb;

    UPDATE favorites
    SET snapshot = '{}'::jsonb
    WHERE snapshot <> '{}'::jsonb;

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
    CREATE INDEX IF NOT EXISTS idx_telegram_bot_chats_user_id
      ON telegram_bot_chats (user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user_updated_at
      ON favorites (user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS product_overrides (
      product_id TEXT PRIMARY KEY,
      title TEXT,
      russian_language_mode TEXT,
      language_note TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE product_overrides
      ADD COLUMN IF NOT EXISTS special_offer_url TEXT;

    CREATE INDEX IF NOT EXISTS idx_product_overrides_updated_at
      ON product_overrides (updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_links (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      vk_url TEXT NOT NULL DEFAULT '',
      telegram_url TEXT NOT NULL DEFAULT '',
      telegram_bot_proxy_url TEXT NOT NULL DEFAULT '',
      max_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE support_links
      ADD COLUMN IF NOT EXISTS telegram_bot_proxy_url TEXT NOT NULL DEFAULT '';

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

    ALTER TABLE digiseller_price_rate_runs
      ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'oplata',
      ADD COLUMN IF NOT EXISTS option_xml TEXT;

    ALTER TABLE digiseller_price_rate_samples
      ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'oplata',
      ADD COLUMN IF NOT EXISTS option_xml TEXT;

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_runs_lookup
      ON digiseller_price_rate_runs (digiseller_id, status, finished_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_runs_mode_lookup
      ON digiseller_price_rate_runs (mode, digiseller_id, status, finished_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_samples_lookup
      ON digiseller_price_rate_samples (digiseller_id, run_id, requested_usd);

    CREATE INDEX IF NOT EXISTS idx_digiseller_price_rate_samples_mode_lookup
      ON digiseller_price_rate_samples (mode, digiseller_id, run_id, requested_usd);

    CREATE TABLE IF NOT EXISTS xbox_topup_cards (
      usd_value INTEGER PRIMARY KEY,
      option_id TEXT,
      price_rub INTEGER,
      in_stock BOOLEAN NOT NULL DEFAULT TRUE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      label TEXT,
      last_refreshed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS xbox_topup_refresh_runs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      parsed_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      option_category_id TEXT,
      error TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    );

    INSERT INTO xbox_topup_cards (usd_value, enabled) VALUES
      (5, TRUE), (10, TRUE), (25, TRUE), (50, TRUE)
    ON CONFLICT (usd_value) DO NOTHING;
  `);

  logger.info('PostgreSQL schema ready');
}

module.exports = { initDb };

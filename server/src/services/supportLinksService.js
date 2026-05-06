const pool = require('../db/pool');
const config = require('../config');

function normalizeLink(value) {
  return String(value || '').trim();
}

function rowToSupportLinks(row, { includePrivate = false } = {}) {
  const data = {
    vkUrl: normalizeLink(row?.vk_url),
    telegramUrl: normalizeLink(row?.telegram_url),
    maxUrl: normalizeLink(row?.max_url),
    updatedAt: row?.updated_at || null,
  };

  if (includePrivate) {
    data.telegramBotProxyUrl = normalizeLink(row?.telegram_bot_proxy_url);
  }

  return data;
}

function getDefaultSupportLinks({ includePrivate = false } = {}) {
  const data = {
    vkUrl: normalizeLink(config.supportLinks?.vkUrl),
    telegramUrl: normalizeLink(config.supportLinks?.telegramUrl),
    maxUrl: normalizeLink(config.supportLinks?.maxUrl),
    updatedAt: null,
  };

  if (includePrivate) {
    data.telegramBotProxyUrl = normalizeLink(config.auth?.telegram?.proxyUrl);
  }

  return data;
}

async function getSupportLinks(options = {}) {
  const { rows } = await pool.query('SELECT * FROM support_links WHERE id = 1');
  if (!rows[0]) return getDefaultSupportLinks(options);
  return rowToSupportLinks(rows[0], options);
}

async function updateSupportLinks(payload = {}) {
  const vkUrl = normalizeLink(payload.vkUrl);
  const telegramUrl = normalizeLink(payload.telegramUrl);
  const telegramBotProxyUrl = normalizeLink(payload.telegramBotProxyUrl);
  const maxUrl = normalizeLink(payload.maxUrl);

  const { rows } = await pool.query(
    `INSERT INTO support_links (id, vk_url, telegram_url, telegram_bot_proxy_url, max_url, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id)
     DO UPDATE SET
       vk_url = EXCLUDED.vk_url,
       telegram_url = EXCLUDED.telegram_url,
       telegram_bot_proxy_url = EXCLUDED.telegram_bot_proxy_url,
       max_url = EXCLUDED.max_url,
       updated_at = NOW()
     RETURNING *`,
    [vkUrl, telegramUrl, telegramBotProxyUrl, maxUrl],
  );

  return rowToSupportLinks(rows[0], { includePrivate: true });
}

module.exports = {
  getSupportLinks,
  updateSupportLinks,
};

const pool = require('../db/pool');
const config = require('../config');

function normalizeLink(value) {
  return String(value || '').trim();
}

function rowToSupportLinks(row) {
  return {
    vkUrl: normalizeLink(row?.vk_url),
    telegramUrl: normalizeLink(row?.telegram_url),
    maxUrl: normalizeLink(row?.max_url),
    updatedAt: row?.updated_at || null,
  };
}

function getDefaultSupportLinks() {
  return {
    vkUrl: normalizeLink(config.supportLinks?.vkUrl),
    telegramUrl: normalizeLink(config.supportLinks?.telegramUrl),
    maxUrl: normalizeLink(config.supportLinks?.maxUrl),
    updatedAt: null,
  };
}

async function getSupportLinks() {
  const { rows } = await pool.query('SELECT * FROM support_links WHERE id = 1');
  if (!rows[0]) return getDefaultSupportLinks();
  return rowToSupportLinks(rows[0]);
}

async function updateSupportLinks(payload = {}) {
  const vkUrl = normalizeLink(payload.vkUrl);
  const telegramUrl = normalizeLink(payload.telegramUrl);
  const maxUrl = normalizeLink(payload.maxUrl);

  const { rows } = await pool.query(
    `INSERT INTO support_links (id, vk_url, telegram_url, max_url, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id)
     DO UPDATE SET
       vk_url = EXCLUDED.vk_url,
       telegram_url = EXCLUDED.telegram_url,
       max_url = EXCLUDED.max_url,
       updated_at = NOW()
     RETURNING *`,
    [vkUrl, telegramUrl, maxUrl],
  );

  return rowToSupportLinks(rows[0]);
}

module.exports = {
  getSupportLinks,
  updateSupportLinks,
};

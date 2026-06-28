/**
 * Proxy pool for the russian-language index store-page fetches.
 *
 * - CRUD persisted in the `proxies` table.
 * - Health check: makes a real request to xbox.com through the proxy and records
 *   alive/dead + latency.
 * - Round-robin agent rotation across enabled + alive proxies, so the bulk page
 *   parsing spreads its requests over many IPs and avoids an Xbox ban.
 *
 * Only the language index uses these (see russianLanguageIndexService). The rest
 * of the site keeps talking to Xbox directly.
 */
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const pool = require('../db/pool');
const logger = require('../utils/logger');

const HEALTH_CHECK_URL = 'https://www.xbox.com/en-US/';
const HEALTH_CHECK_TIMEOUT_MS = 12_000;

// Round-robin cursor over the in-memory list of usable proxy URLs.
let rotation = [];
let cursor = 0;

function rowToProxy(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    url: row.url,
    label: row.label || '',
    enabled: row.enabled,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function maskProxyUrl(url) {
  // Hide credentials when echoing a proxy URL into logs/UI.
  return String(url || '').replace(/\/\/[^@/]*@/, '//***@');
}

async function listProxies() {
  const { rows } = await pool.query('SELECT * FROM proxies ORDER BY created_at ASC');
  return rows.map(rowToProxy);
}

async function createProxy({ url, label }) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error('Proxy URL is required');
  const { rows } = await pool.query(
    `INSERT INTO proxies (url, label) VALUES ($1, $2) RETURNING *`,
    [trimmed, String(label || '').trim() || null],
  );
  await refreshRotation();
  return rowToProxy(rows[0]);
}

async function updateProxy(id, { url, label, enabled }) {
  const sets = [];
  const params = [];
  let i = 1;
  if (url !== undefined) { sets.push(`url = $${i++}`); params.push(String(url).trim()); }
  if (label !== undefined) { sets.push(`label = $${i++}`); params.push(String(label || '').trim() || null); }
  if (enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(Boolean(enabled)); }
  if (!sets.length) return getProxy(id);
  sets.push('updated_at = NOW()');
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE proxies SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  await refreshRotation();
  return rowToProxy(rows[0]);
}

async function getProxy(id) {
  const { rows } = await pool.query('SELECT * FROM proxies WHERE id = $1', [id]);
  return rowToProxy(rows[0]);
}

async function deleteProxy(id) {
  await pool.query('DELETE FROM proxies WHERE id = $1', [id]);
  await refreshRotation();
  return { id: Number(id) };
}

function buildAgent(url) {
  return new HttpsProxyAgent(url);
}

// Make a real request through the proxy; record alive/dead + latency.
async function checkProxy(id) {
  const proxy = await getProxy(id);
  if (!proxy) throw new Error('Proxy not found');

  const startedAt = Date.now();
  let status = 'dead';
  let latency = null;
  let lastError = null;

  try {
    const agent = buildAgent(proxy.url);
    const res = await axios.get(HEALTH_CHECK_URL, {
      httpsAgent: agent,
      proxy: false,
      timeout: HEALTH_CHECK_TIMEOUT_MS,
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 500,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
    });
    latency = Date.now() - startedAt;
    // 429/403 means the proxy works but the IP is rate-limited/blocked by Xbox.
    if (res.status === 429 || res.status === 403) {
      status = 'dead';
      lastError = `Xbox ответил ${res.status} (IP заблокирован)`;
    } else {
      status = 'alive';
    }
  } catch (err) {
    lastError = err.message;
  }

  const { rows } = await pool.query(
    `UPDATE proxies
     SET status = $1, last_latency_ms = $2, last_error = $3, last_checked_at = NOW(), updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [status, latency, lastError, id],
  );
  await refreshRotation();
  return rowToProxy(rows[0]);
}

async function checkAllProxies() {
  const proxies = await listProxies();
  const results = [];
  for (const proxy of proxies) {
    try {
      results.push(await checkProxy(proxy.id));
    } catch (err) {
      logger.warn('[Proxy] Health check failed', { id: proxy.id, message: err.message });
    }
  }
  await refreshRotation();
  return results;
}

// Rebuild the in-memory rotation list from enabled + alive proxies.
async function refreshRotation() {
  try {
    const { rows } = await pool.query(
      `SELECT url FROM proxies WHERE enabled = TRUE AND status = 'alive' ORDER BY created_at ASC`,
    );
    rotation = rows.map((r) => r.url);
    if (cursor >= rotation.length) cursor = 0;
  } catch (err) {
    logger.warn('[Proxy] refreshRotation failed', { message: err.message });
  }
}

// Count of currently usable proxies (enabled + alive).
async function countAlive() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM proxies WHERE enabled = TRUE AND status = 'alive'`,
  );
  return rows[0]?.n || 0;
}

// Returns the next usable proxy { url, agent } in round-robin order, or null if
// the pool is empty. Caller decides what to do when null (we stop the parser).
function nextAgent() {
  if (!rotation.length) return null;
  const url = rotation[cursor % rotation.length];
  cursor = (cursor + 1) % rotation.length;
  return { url, agent: buildAgent(url) };
}

// Mark a proxy dead by URL (e.g. after a ban-like response during parsing) and
// drop it from the live rotation immediately.
async function markDeadByUrl(url, errorMessage) {
  rotation = rotation.filter((u) => u !== url);
  if (cursor >= rotation.length) cursor = 0;
  try {
    await pool.query(
      `UPDATE proxies SET status = 'dead', last_error = $2, last_checked_at = NOW(), updated_at = NOW()
       WHERE url = $1`,
      [url, String(errorMessage || '').slice(0, 500)],
    );
  } catch (err) {
    logger.warn('[Proxy] markDeadByUrl failed', { message: err.message });
  }
}

// Load the rotation on startup so the parser can use proxies right away.
refreshRotation().catch(() => {});

module.exports = {
  listProxies,
  createProxy,
  updateProxy,
  deleteProxy,
  getProxy,
  checkProxy,
  checkAllProxies,
  refreshRotation,
  countAlive,
  nextAgent,
  markDeadByUrl,
  maskProxyUrl,
};

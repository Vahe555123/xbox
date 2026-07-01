/**
 * Generates the sitemap (as a sitemap index + child sitemaps) and robots.txt.
 *
 * A single flat sitemap with the whole ~16k-game catalog is large and slow to
 * fetch, and Google was reporting "Sitemap could not be read" on it. Instead we
 * follow the standard large-site pattern:
 *
 *   /sitemap.xml            -> <sitemapindex> listing the child sitemaps below
 *   /sitemap-static.xml     -> the handful of static pages
 *   /sitemap-games-<N>.xml  -> games chunked CHUNK_SIZE per file (1-based N)
 *
 * Game URLs come from the russian-language index (the full walked catalog); if
 * that isn't built yet we fall back to whatever product IDs we have in the DB.
 * Everything is cached in memory to avoid rebuilding on every hit.
 */
const russianIndex = require('./russianLanguageIndexService');
const pool = require('../db/pool');
const config = require('../config');

const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CHUNK_SIZE = 1000;           // games per child sitemap
const MAX_URLS = 45000;            // hard cap across all games (spec limit is 50k/file)

// path -> { xml, expiresAt }
const cache = new Map();

async function getGameIds() {
  const index = russianIndex.getIndexData();
  if (index && Array.isArray(index.walkedList) && index.walkedList.length) {
    return index.walkedList.map((p) => p.id).filter(Boolean);
  }
  // Fallback: every product we know about from the DB.
  try {
    const { rows } = await pool.query(`
      SELECT product_id FROM sale_products
      UNION SELECT product_id FROM collection_product_snapshots
      UNION SELECT product_id FROM product_overrides
    `);
    return rows.map((r) => r.product_id).filter(Boolean);
  } catch {
    return [];
  }
}

function urlTag(loc, { changefreq, priority } = {}) {
  return `<url><loc>${loc}</loc>`
    + (changefreq ? `<changefreq>${changefreq}</changefreq>` : '')
    + (priority ? `<priority>${priority}</priority>` : '')
    + '</url>';
}

function urlsetXml(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.join('\n')
    + `\n</urlset>`;
}

function cached(key, build) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.xml;
  const xml = build();
  cache.set(key, { xml, expiresAt: now + TTL_MS });
  return xml;
}

// Number of /sitemap-games-<N>.xml files needed for the current catalog.
async function getGamePageCount() {
  const total = Math.min((await getGameIds()).length, MAX_URLS);
  return Math.max(1, Math.ceil(total / CHUNK_SIZE));
}

// /sitemap.xml — index pointing at the static + per-chunk game sitemaps.
async function getSitemapIndexXml() {
  const origin = config.siteOrigin;
  const pages = await getGamePageCount();
  return cached(`index:${pages}`, () => {
    const children = [`${origin}/sitemap-static.xml`];
    for (let p = 1; p <= pages; p += 1) children.push(`${origin}/sitemap-games-${p}.xml`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n`
      + `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      + children.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`).join('\n')
      + `\n</sitemapindex>`;
  });
}

// /sitemap-static.xml — the static (non-game) pages.
function getStaticSitemapXml() {
  const origin = config.siteOrigin;
  return cached('static', () => urlsetXml([
    urlTag(`${origin}/`, { changefreq: 'daily', priority: '1.0' }),
    urlTag(`${origin}/gamepass`, { changefreq: 'daily', priority: '0.8' }),
    urlTag(`${origin}/ubisoft`, { changefreq: 'daily', priority: '0.8' }),
  ]));
}

// /sitemap-games-<page>.xml — one CHUNK_SIZE slice of game URLs (page is 1-based).
// Returns null for out-of-range pages so the route can 404.
async function getGamesSitemapXml(page) {
  const n = Number(page);
  if (!Number.isInteger(n) || n < 1) return null;

  const origin = config.siteOrigin;
  const ids = (await getGameIds()).slice(0, MAX_URLS);
  const start = (n - 1) * CHUNK_SIZE;
  if (start >= ids.length) return null;

  const slice = ids.slice(start, start + CHUNK_SIZE);
  return cached(`games:${n}:${ids.length}`, () => urlsetXml(
    slice.map((id) =>
      urlTag(`${origin}/game/${encodeURIComponent(id)}`, { changefreq: 'weekly', priority: '0.6' })),
  ));
}

function getRobotsTxt() {
  const origin = config.siteOrigin;
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

module.exports = {
  getSitemapIndexXml,
  getStaticSitemapXml,
  getGamesSitemapXml,
  getRobotsTxt,
};

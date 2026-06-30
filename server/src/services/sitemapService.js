/**
 * Generates sitemap.xml and robots.txt for search engines.
 *
 * Game URLs come from the russian-language index (the full walked catalog of
 * ~16k games); if that isn't built yet we fall back to whatever product IDs we
 * have in the DB. The XML is cached in memory to avoid rebuilding on every hit.
 */
const russianIndex = require('./russianLanguageIndexService');
const pool = require('../db/pool');
const config = require('../config');

const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const MAX_URLS = 45000; // sitemap spec limit is 50k

let cache = { xml: null, expiresAt: 0 };

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

async function getSitemapXml() {
  const now = Date.now();
  if (cache.xml && cache.expiresAt > now) return cache.xml;

  const origin = config.siteOrigin;
  const ids = (await getGameIds()).slice(0, MAX_URLS);

  const staticUrls = [
    urlTag(`${origin}/`, { changefreq: 'daily', priority: '1.0' }),
    urlTag(`${origin}/gamepass`, { changefreq: 'daily', priority: '0.8' }),
    urlTag(`${origin}/ubisoft`, { changefreq: 'daily', priority: '0.8' }),
  ];
  const gameUrls = ids.map((id) =>
    urlTag(`${origin}/game/${encodeURIComponent(id)}`, { changefreq: 'weekly', priority: '0.6' }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + [...staticUrls, ...gameUrls].join('\n')
    + `\n</urlset>`;

  cache = { xml, expiresAt: now + TTL_MS };
  return xml;
}

function getRobotsTxt() {
  const origin = config.siteOrigin;
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

module.exports = { getSitemapXml, getRobotsTxt };

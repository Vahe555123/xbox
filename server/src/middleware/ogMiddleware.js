const pool = require('../db/pool');
const { getProductById } = require('../services/displayCatalogService');

// Известные User-Agent строки социальных ботов
const SOCIAL_BOT_RE = /TelegramBot|vkShare|Facebot|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Max\/|mail\.ru/i;

const DEFAULT_TITLE = 'XboxTracker - поможем купить игры для Xbox Series Ключи в России и на аккаунт Xbox One, Xbox Series X, Xbox Series S.';
const DEFAULT_DESCRIPTION = 'Удобный способ купить игры для Xbox Series Ключи в России, а также на аккаунт Xbox One, Xbox Series X, Xbox Series S. Отслеживай скидки на игры для Xbox Series и Xbox One. Покупай игры Xbox в России дешево.';
const DEFAULT_IMAGE = 'https://xboxtracker.ru/og-image.png';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOgHtml({ title, description, image, url }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image || DEFAULT_IMAGE)}">
  <meta name="twitter:card" content="summary_large_image">
</head>
<body></body>
</html>`;
}

function absUri(uri) {
  if (!uri) return null;
  if (String(uri).startsWith('//')) return `https:${uri}`;
  return uri;
}

// Быстрый поиск в БД (sale_products, collections, product_overrides)
async function getGameMetaFromDb(productId) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(po.title, cps.data->>'title', sp.title) AS title,
       COALESCE(cps.data->>'image', sp.image)           AS image
     FROM (SELECT $1::text AS pid) q
     LEFT JOIN product_overrides po          ON po.product_id  = q.pid
     LEFT JOIN collection_product_snapshots cps ON cps.product_id = q.pid
     LEFT JOIN sale_products sp              ON sp.product_id  = q.pid`,
    [productId.toUpperCase()],
  );
  const row = rows[0];
  return row?.title ? row : null;
}

// Фолбэк: Display Catalog API (есть кеш, таймаут 3 сек)
async function getGameMetaFromCatalog(productId) {
  try {
    const product = await Promise.race([
      getProductById(productId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('og-timeout')), 3000)),
    ]);
    if (!product) return null;
    const lp = product.LocalizedProperties?.[0] || {};
    const title = lp.ProductTitle;
    if (!title) return null;
    const images = lp.Images || [];
    const ogImage = (
      images.find((img) => img.ImagePurpose === 'SuperHeroArt') ||
      images.find((img) => img.ImagePurpose === 'Poster') ||
      images.find((img) => img.ImagePurpose === 'BoxArt') ||
      images[0]
    );
    return { title, image: absUri(ogImage?.Uri) };
  } catch {
    return null;
  }
}

async function getGameMeta(productId) {
  const fromDb = await getGameMetaFromDb(productId);
  if (fromDb) return fromDb;
  return getGameMetaFromCatalog(productId);
}

module.exports = async function ogMiddleware(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  if (!SOCIAL_BOT_RE.test(ua)) return next();

  const config = require('../config');
  const origin = config.siteOrigin.toLowerCase();
  // originalUrl (не path) — чтобы query-параметры попадали в og:url.
  // Без этого Telegram канонизирует любой URL обратно к "/" и переиспользует
  // старый закэшированный результат, игнорируя обновления.
  const url = `${origin}${req.originalUrl}`;

  // Страница игры: /game/<productId>
  const gameMatch = req.path.match(/^\/game\/([A-Za-z0-9]+)$/);
  if (gameMatch) {
    try {
      const meta = await getGameMeta(gameMatch[1]);
      if (meta?.title) {
        const t = meta.title;
        return res.type('html').send(buildOgHtml({
          title: `${t} купить Xbox Ключ в России и на аккаунт Xbox Series X, Xbox Series S, Xbox One.`,
          description: `Легко и быстро купить ${t} Xbox Ключ в России и на аккаунт Xbox Series X, Xbox Series S, Xbox One. Отслеживай скидки на ${t} для Xbox Series и Xbox One. Покупай игры Xbox в России дешево.`,
          image: meta.image || DEFAULT_IMAGE,
          url,
        }));
      }
    } catch (_) { /* fall through */ }
  }

  // Любая другая страница — дефолтные теги
  return res.type('html').send(buildOgHtml({
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
    url,
  }));
};

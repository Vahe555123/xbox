const pool = require('../db/pool');
const { getProductById } = require('../services/displayCatalogService');

// Социальные боты (берут только OG-теги для превью ссылки)
const SOCIAL_BOT_RE = /TelegramBot|vkShare|Facebot|facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|Max\/|mail\.ru/i;
// Поисковые боты — им отдаём ту же мету + реальный контент в <body> для индексации
const SEARCH_BOT_RE = /Googlebot|Google-InspectionTool|YandexBot|YandexWebmaster|YandexImages|Yandex|Bingbot|DuckDuckBot|Applebot|Baiduspider|SemrushBot|AhrefsBot|MJ12bot|PetalBot/i;

const DEFAULT_TITLE = 'XboxTracker - поможем купить игры для Xbox Series Ключи в России и на аккаунт Xbox One, Xbox Series X, Xbox Series S.';
const DEFAULT_DESCRIPTION = 'Удобный способ купить игры для Xbox Series Ключи в России, а также на аккаунт Xbox One, Xbox Series X, Xbox Series S. Отслеживай скидки на игры для Xbox Series и Xbox One. Покупай игры Xbox в России дешево.';
const DEFAULT_IMAGE = 'https://xboxtracker.ru/og-image.png';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildOgHtml({ title, description, image, url, canonical, jsonLd, h1, bodyText }) {
  const ldBlock = jsonLd
    ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
    : '';
  const canonicalTag = canonical
    ? `\n  <link rel="canonical" href="${esc(canonical)}">`
    : '';
  // Реальный контент в body — чтобы поисковик индексировал текст, а не пустую страницу.
  const paragraphs = (Array.isArray(bodyText) ? bodyText : [bodyText || description])
    .filter(Boolean)
    .map((p) => `\n  <p>${esc(p)}</p>`)
    .join('');
  const body = `
  <h1>${esc(h1 || title)}</h1>
  ${image ? `<img src="${esc(image)}" alt="${esc(h1 || title)}" width="320">` : ''}${paragraphs}
  <p><a href="${esc(url)}">Открыть на XboxTracker</a></p>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">${canonicalTag}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image || DEFAULT_IMAGE)}">
  <meta name="twitter:card" content="summary_large_image">${ldBlock}
</head>
<body>${body}
</body>
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
  const isBot = SOCIAL_BOT_RE.test(ua) || SEARCH_BOT_RE.test(ua);
  if (!isBot) return next();

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
      const productId = gameMatch[1];
      const meta = await getGameMeta(productId);
      if (meta?.title) {
        const t = meta.title;
        const canonical = `${origin}/game/${productId}`;
        const description = `Легко и быстро купить ${t} Xbox Ключ в России и на аккаунт Xbox Series X, Xbox Series S, Xbox One. Отслеживай скидки на ${t} для Xbox Series и Xbox One. Покупай игры Xbox в России дешево.`;
        const jsonLd = {
          '@context': 'https://schema.org',
          '@type': 'VideoGame',
          name: t,
          url: canonical,
          description,
          gamePlatform: ['Xbox Series X|S', 'Xbox One'],
          operatingSystem: 'Xbox',
          ...(meta.image ? { image: meta.image } : {}),
        };
        return res.type('html').send(buildOgHtml({
          title: `${t} купить Xbox Ключ в России и на аккаунт Xbox Series X, Xbox Series S, Xbox One.`,
          description,
          image: meta.image || DEFAULT_IMAGE,
          url,
          canonical,
          jsonLd,
          h1: `${t} — купить Xbox Ключ в России`,
          bodyText: [
            description,
            `Купить ${t} для Xbox можно несколькими способами: ключ активации на игру, покупка напрямую на ваш Xbox-аккаунт, пополнение баланса кодами или спецпредложение продавца.`,
            `Поддерживаемые платформы: Xbox Series X, Xbox Series S, Xbox One. Оплата в рублях через СБП. Следите за скидками на ${t} и другими играми Xbox на XboxTracker.`,
          ],
        }));
      }
    } catch (_) { /* fall through */ }
  }

  // Game Pass
  if (req.path === '/gamepass') {
    const canonical = `${origin}/gamepass`;
    const title = 'Xbox Game Pass Ultimate — купить подписку в России | XboxTracker';
    const description = 'Купить Xbox Game Pass Ultimate в России. Доступ к 100+ играм, EA Play в комплекте, онлайн-мультиплеер. Активация на аккаунт 10 мин — 3 часа. Оплата через СБП.';
    return res.type('html').send(buildOgHtml({
      title,
      description,
      image: DEFAULT_IMAGE,
      url,
      canonical,
      h1: 'Xbox Game Pass Ultimate — купить подписку в России',
      bodyText: [
        description,
        'Xbox Game Pass Ultimate включает доступ к более чем 100 играм для Xbox Series X, Xbox Series S и Xbox One, онлайн-мультиплеер Xbox Live Gold и подписку EA Play. Новые игры добавляются каждый месяц.',
        'Выберите срок подписки: 1 месяц, 3 месяца или 12 месяцев. Продавец активирует подписку напрямую на ваш Xbox-аккаунт. Оплата в рублях через СБП на XboxTracker.',
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Xbox Game Pass Ultimate',
        url: canonical,
        description,
        brand: { '@type': 'Brand', name: 'Microsoft Xbox' },
      },
    }));
  }

  // Ubisoft+
  if (req.path === '/ubisoft') {
    const canonical = `${origin}/ubisoft`;
    const title = 'Ubisoft+ — купить подписку на игры Ubisoft для Xbox | XboxTracker';
    const description = 'Купить Ubisoft+ для Xbox в России. Доступ к библиотеке игр Ubisoft: Assassin\'s Creed, Far Cry, Watch Dogs и другие. Активация на аккаунт. Оплата через СБП.';
    return res.type('html').send(buildOgHtml({
      title,
      description,
      image: DEFAULT_IMAGE,
      url,
      canonical,
      h1: 'Ubisoft+ — купить подписку для Xbox в России',
      bodyText: [
        description,
        'Ubisoft+ даёт доступ к полной библиотеке игр Ubisoft для Xbox, включая новинки в день релиза. Играйте в Assassin\'s Creed, Far Cry, Tom Clancy\'s Rainbow Six, Watch Dogs и десятки других игр.',
        'Подписка активируется напрямую на ваш Xbox-аккаунт. Поддерживаемые платформы: Xbox Series X, Xbox Series S, Xbox One. Оплата в рублях через СБП на XboxTracker.',
      ],
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Ubisoft+',
        url: canonical,
        description,
        brand: { '@type': 'Brand', name: 'Ubisoft' },
      },
    }));
  }

  // Любая другая страница — дефолтные теги
  return res.type('html').send(buildOgHtml({
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    image: DEFAULT_IMAGE,
    url,
    canonical: `${origin}${req.path}`,
  }));
};

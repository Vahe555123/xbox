const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const config = require('../config');
const { getProductsByIds } = require('./displayCatalogService');
const { mapRelatedProducts } = require('../mappers/relatedProductMapper');
const {
  enrichProductsWithRub,
  getKeyActivationRubPriceForProduct,
  isGameCurrencyProduct,
} = require('./digisellerService');
const topupCardService = require('./topupCardService');
const {
  getChatIdForUser,
  sendTelegramMessage: sendBotMessage,
  sendTelegramPhoto: sendBotPhoto,
} = require('./telegramBotService');
const { createSmtpTransport, getFromAddress } = require('./mailTransport');
const logger = require('../utils/logger');

const FAVORITE_DEALS_BANNER_CID = 'favorite-deals-banner@xbox-store';
const FAVORITE_DEALS_BANNER_PATH = path.resolve(__dirname, '../assets/favorite-deals-banner.png');
const FAVORITE_DEALS_TELEGRAM_BANNER_PATH = path.resolve(__dirname, '../assets/favorite-deals-telegram-banner.png');
const TELEGRAM_PHOTO_CAPTION_LIMIT = 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value, currency) {
  if (value === null || value === undefined) return null;
  const c = currency || 'USD';
  if (value === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(value);
  } catch {
    return `$${Number(value).toFixed(2)}`;
  }
}

function absUri(uri) {
  if (!uri) return null;
  if (String(uri).startsWith('//')) return `https:${uri}`;
  return uri;
}

function findImage(images, purpose) {
  if (!Array.isArray(images)) return null;
  const img = images.find((i) => i.ImagePurpose === purpose);
  return img ? absUri(img.Uri) : null;
}

function storeUrl(productId, title) {
  const slug = (title || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80);
  return `https://www.xbox.com/${config.xbox.locale}/games/store/${slug}/${productId}`;
}

/**
 * Generate a stable key for a specific deal so we can track
 * whether we already notified a user about it.
 * Key = listPrice + msrp so if prices change it's a new deal.
 */
function dealKey(listPrice, msrp) {
  return `${Number(listPrice).toFixed(2)}_${Number(msrp).toFixed(2)}`;
}

function normalizeProductId(productId) {
  return String(productId || '').trim().toUpperCase();
}

function favoritesUrl() {
  return `${String(config.clientOrigin || '').replace(/\/$/, '')}/favorites`;
}

function formatRubCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(numeric))}₽`;
}

function getRubValue(price) {
  const value = price?.value ?? price?.amount ?? price?.totalRub;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function getProductUsdPrice(product) {
  const candidates = [product?.gamePassPrice, product?.price?.value, product?.price?.listPrice, product?.price?.msrp];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric * 100) / 100;
  }
  return null;
}

function getProductOriginalUsdPrice(product) {
  const current = getProductUsdPrice(product);
  const original = Number(product?.price?.original || product?.price?.msrp || product?.price?.value);
  if (!Number.isFinite(original) || original <= 0) return null;
  if (current && original <= current) return null;
  return Math.round(original * 100) / 100;
}

function estimateOriginalRubValue(currentRub, product) {
  const value = getRubValue(currentRub);
  const currentUsd = getProductUsdPrice(product);
  const originalUsd = getProductOriginalUsdPrice(product);
  if (!value || !currentUsd || !originalUsd) return null;
  return Math.round(value * (originalUsd / currentUsd));
}

function getTopupEffectiveRub(combo, priceUsd = combo?.price) {
  const totalRub = Number(combo?.totalRub);
  const totalUsd = Number(combo?.totalUsd);
  const usd = Number(priceUsd);
  if (!Number.isFinite(totalRub) || !Number.isFinite(totalUsd) || !Number.isFinite(usd)) return null;
  if (totalRub <= 0 || totalUsd <= 0 || usd <= 0) return null;
  return Math.ceil((totalRub / totalUsd) * usd);
}

function formatPaymentPair(currentValue, originalValue) {
  const current = formatRubCompact(currentValue);
  if (!current) return null;
  const original = formatRubCompact(originalValue);
  return original && Number(originalValue) > Number(currentValue)
    ? `${current} ${original}`
    : current;
}

function formatDealPaymentLine(deal) {
  const prices = deal.paymentPrices || {};
  return [
    formatPaymentPair(prices.topup?.current, prices.topup?.original),
    formatPaymentPair(prices.key?.current, prices.key?.original),
    formatPaymentPair(prices.account?.current, prices.account?.original),
  ].filter(Boolean).join(' • ');
}

function getDealPaymentPairs(deal) {
  const prices = deal.paymentPrices || {};
  return [
    prices.topup,
    prices.key,
    prices.account,
  ].map((price) => {
    const current = formatRubCompact(price?.current);
    if (!current) return null;

    const original = Number(price?.original) > Number(price?.current)
      ? formatRubCompact(price?.original)
      : null;

    return { current, original };
  }).filter(Boolean);
}

function formatDealEndDate(endDate) {
  if (!endDate) return null;
  const date = new Date(endDate);
  if (Number.isNaN(date.getTime())) return null;
  return `до ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

// ---------------------------------------------------------------------------
// 1. Gather all users who have favorites
// ---------------------------------------------------------------------------

async function getUsersWithFavorites() {
  const { rows } = await pool.query(`
    SELECT
      u.id       AS user_id,
      u.email,
      u.name,
      u.last_provider,
      array_agg(f.product_id ORDER BY f.updated_at DESC) AS product_ids
    FROM users u
    JOIN favorites f ON f.user_id = u.id
    GROUP BY u.id
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// 2. For a set of product IDs, fetch current prices from Display Catalog
// ---------------------------------------------------------------------------

function extractDealInfo(raw, product) {
  const lp = raw.LocalizedProperties?.[0] || {};
  const images = lp.Images || [];
  const price = product?.price || {};
  const listPrice = Number(price.value ?? price.listPrice);
  const msrp = Number(price.original ?? price.msrp);

  const image = product?.image ||
    findImage(images, 'Poster') ||
    findImage(images, 'BoxArt') ||
    findImage(images, 'BrandedKeyArt') ||
    findImage(images, 'SuperHeroArt') ||
    (images[0] ? absUri(images[0].Uri) : null);

  const hasDiscount = Number.isFinite(msrp)
    && Number.isFinite(listPrice)
    && listPrice < msrp
    && listPrice > 0;

  if (!hasDiscount) return null;

  const discountPercent = Math.round(((msrp - listPrice) / msrp) * 100);
  const currency = price.currency || 'USD';
  const endDate = findDealEndDate(raw, listPrice, msrp);

  return {
    productId: raw.ProductId,
    title: product?.title || lp.ProductTitle || raw.ProductId,
    image,
    listPrice,
    msrp,
    currency,
    formattedListPrice: formatMoney(listPrice, currency),
    formattedMsrp: formatMoney(msrp, currency),
    discountPercent,
    endDate,
    storeUrl: storeUrl(raw.ProductId, lp.ProductTitle),
    siteUrl: `${config.clientOrigin}/game/${raw.ProductId}`,
    paymentPrices: product?.notificationPaymentPrices || null,
  };
}

function findDealEndDate(raw, listPrice, msrp) {
  const list = Number(listPrice);
  const original = Number(msrp);
  for (const skuEntry of raw.DisplaySkuAvailabilities || []) {
    for (const av of skuEntry.Availabilities || []) {
      const price = av.OrderManagementData?.Price;
      const avList = Number(price?.ListPrice);
      const avMsrp = Number(price?.MSRP);
      const actions = av.Actions || [];
      if (
        Number.isFinite(avList)
        && Number.isFinite(avMsrp)
        && Math.abs(avList - list) < 0.01
        && Math.abs(avMsrp - original) < 0.01
        && (actions.length === 0 || actions.includes('Purchase'))
      ) {
        return av.Conditions?.EndDate || av.EndDate || null;
      }
    }
  }
  return null;
}

async function enrichProductsForDealNotifications(rawProducts) {
  const products = mapRelatedProducts(rawProducts, {});
  await enrichProductsWithRub(products).catch((err) => {
    logger.warn('[DealNotifier] RUB enrichment failed', { message: err.message });
  });

  await Promise.all(products.map(enrichProductNotificationPrices));

  return new Map(products.map((product) => [normalizeProductId(product.id), product]));
}

async function enrichProductNotificationPrices(product) {
  if (!product || product.price?.value === 0 || product.price?.isFree || product.releaseInfo?.status === 'unreleased') {
    product.notificationPaymentPrices = null;
    return product;
  }

  const currentUsd = getProductUsdPrice(product);
  const originalUsd = getProductOriginalUsdPrice(product);
  const accountCurrent = getRubValue(product.priceRub);
  const prices = {
    account: {
      current: accountCurrent,
      original: estimateOriginalRubValue(product.priceRub, product),
    },
    key: null,
    topup: null,
  };

  if (!isGameCurrencyProduct(product)) {
    const keyRub = await getKeyActivationRubPriceForProduct(product).catch((err) => {
      logger.warn('[DealNotifier] Key RUB enrichment failed', {
        productId: product.id,
        message: err.message,
      });
      return null;
    });
    if (keyRub) {
      prices.key = {
        current: getRubValue(keyRub),
        original: estimateOriginalRubValue(keyRub, product),
      };
    }

    if (currentUsd) {
      const combo = await topupCardService.computeCombo(currentUsd).catch((err) => {
        logger.warn('[DealNotifier] Topup combo failed', {
          productId: product.id,
          message: err.message,
        });
        return null;
      });
      const originalCombo = originalUsd
        ? await topupCardService.computeCombo(originalUsd).catch(() => null)
        : null;
      if (combo?.available) {
        prices.topup = {
          current: getTopupEffectiveRub(combo, currentUsd),
          original: originalCombo?.available ? getTopupEffectiveRub(originalCombo, originalUsd) : null,
        };
      }
    }
  }

  product.notificationPaymentPrices = prices;
  return product;
}

// ---------------------------------------------------------------------------
// 3. Dedup: which (user, product, dealKey) pairs were already notified?
// ---------------------------------------------------------------------------

async function getAlreadyNotified(userId, productDealPairs) {
  if (productDealPairs.length === 0) return new Set();

  // Build a VALUES clause for lookup
  const values = productDealPairs
    .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
    .join(', ');
  const params = [userId];
  for (const [pid, dk] of productDealPairs) {
    params.push(pid, dk);
  }

  const { rows } = await pool.query(
    `SELECT product_id, deal_key FROM deal_notifications
     WHERE (user_id, product_id, deal_key) IN (${values})`,
    params,
  );

  return new Set(rows.map((r) => `${r.product_id}::${r.deal_key}`));
}

async function markNotified(userId, productDealPairs) {
  if (productDealPairs.length === 0) return;

  const values = productDealPairs
    .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3}, NOW())`)
    .join(', ');
  const params = [userId];
  for (const [pid, dk] of productDealPairs) {
    params.push(pid, dk);
  }

  await pool.query(
    `INSERT INTO deal_notifications (user_id, product_id, deal_key, notified_at)
     VALUES ${values}
     ON CONFLICT (user_id, product_id, deal_key) DO NOTHING`,
    params,
  );
}

// ---------------------------------------------------------------------------
// 4. Get Telegram chat_id for a user (from oauth_accounts)
// ---------------------------------------------------------------------------

async function getTelegramChatId(userId) {
  return getChatIdForUser(userId);
}

// ---------------------------------------------------------------------------
// 5. Send email
// ---------------------------------------------------------------------------

function buildEmailHtml(userName, deals) {
  const itemsHtml = deals.map((d) => {
    const endText = d.endDate
      ? `<span style="color:#ffa94d;font-size:13px;">Заканчивается: ${new Date(d.endDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>`
      : '';
    return `
      <tr>
        <td style="padding:16px 0;border-bottom:1px solid #2a2a2a;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="90" style="vertical-align:top;">
                <a href="${d.siteUrl}" style="display:block;">
                  <img src="${d.image || ''}" alt="${d.title}" width="80" height="107"
                       style="border-radius:8px;object-fit:cover;display:block;background:#1a1a1a;" />
                </a>
              </td>
              <td style="vertical-align:top;padding-left:14px;">
                <a href="${d.siteUrl}" style="color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;display:block;margin-bottom:6px;">
                  ${d.title}
                </a>
                <div style="margin-bottom:6px;">
                  <span style="background:#107c10;color:#fff;font-weight:800;font-size:13px;padding:3px 8px;border-radius:4px;display:inline-block;">
                    -${d.discountPercent}%
                  </span>
                </div>
                <div style="margin-bottom:4px;">
                  <span style="color:#888;font-size:13px;text-decoration:line-through;">${d.formattedMsrp}</span>
                  <span style="color:#20d66b;font-size:18px;font-weight:800;margin-left:8px;">${d.formattedListPrice}</span>
                </div>
                ${endText}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#0d0d0d;">
    <tr><td align="center" style="padding:24px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;">

        <!-- Header -->
        <tr><td style="padding:24px 24px 16px;background:linear-gradient(135deg,#0b1a0d,#0d1117);border-radius:16px 16px 0 0;border:1px solid #1e1e1e;border-bottom:none;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td>
                <span style="display:inline-block;width:40px;height:40px;border-radius:10px;background:#107c10;text-align:center;line-height:40px;font-size:18px;font-weight:800;color:#fff;">XB</span>
              </td>
              <td style="padding-left:12px;">
                <span style="color:#20d66b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Xbox Store</span><br/>
                <span style="color:#ffffff;font-size:20px;font-weight:800;">Скидки на ваши избранные!</span>
              </td>
            </tr>
          </table>
          <p style="color:#aaa;font-size:14px;margin:12px 0 0;">
            Привет${userName ? ', ' + userName : ''}! У ${deals.length === 1 ? 'одной из ваших любимых игр' : 'нескольких ваших любимых игр'} сейчас скидка:
          </p>
        </td></tr>

        <!-- Products -->
        <tr><td style="padding:0 24px 24px;background:#111114;border:1px solid #1e1e1e;border-top:none;border-bottom:none;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            ${itemsHtml}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 24px;background:#111114;border-radius:0 0 16px 16px;border:1px solid #1e1e1e;border-top:none;text-align:center;">
          <a href="${config.clientOrigin}/?deals=true"
             style="display:inline-block;padding:12px 28px;background:#107c10;color:#fff;font-weight:700;border-radius:8px;text-decoration:none;font-size:14px;">
            Смотреть все скидки
          </a>
          <p style="color:#666;font-size:11px;margin:16px 0 0;">
            Вы получили это письмо, потому что добавили эти игры в избранное на Xbox Store.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendDealEmail(email, userName, deals) {
  const transporter = createSmtpTransport();

  const notificationSubject = deals.length === 1
    ? `Скидка ${deals[0].discountPercent}% на ${deals[0].title}`
    : `Подешевели ${deals.length} игр из избранного`;

  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject: notificationSubject,
    html: buildFavoriteDealsEmailHtml(userName, deals),
    text: buildFavoriteDealsTelegramMessage(userName, deals),
    attachments: getFavoriteDealsEmailAttachments(),
  });
}

// ---------------------------------------------------------------------------
// 6. Send Telegram message
// ---------------------------------------------------------------------------

function buildTelegramMessage(userName, deals) {
  const greeting = userName ? `Привет, ${userName}!` : 'Привет!';
  const lines = [`🔥 *${greeting}*\n\nУ ваших избранных игр сейчас скидки:\n`];

  for (const d of deals) {
    const endText = d.endDate
      ? `\n   ⏳ до ${new Date(d.endDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
      : '';
    lines.push(
      `🎮 *${escapeMd(d.title)}*\n` +
      `   ~~${escapeMd(d.formattedMsrp)}~~ → *${escapeMd(d.formattedListPrice)}* \\(\\-${d.discountPercent}%\\)` +
      endText +
      `\n   [Открыть](${d.siteUrl})\n`,
    );
  }

  lines.push(`\n[Все скидки](${config.clientOrigin}/?deals=true)`);
  return lines.join('\n');
}

function escapeMd(text) {
  if (!text) return '';
  // MarkdownV2 special characters
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendTelegramMessage(chatId, text) {
  await sendBotMessage(chatId, text, {
    disableWebPagePreview: true,
  });
  return true;
}

function buildFavoriteDealsTelegramPhotoCaption(deals) {
  return [
    `Подешевели ${deals.length} игр из Избранного`,
    favoritesUrl(),
  ].join('\n');
}

function canUseTelegramPhotoCaption(text) {
  return String(text || '').length <= TELEGRAM_PHOTO_CAPTION_LIMIT;
}

async function sendFavoriteDealsTelegramNotification(chatId, userName, deals) {
  const text = buildFavoriteDealsTelegramMessage(userName, deals);
  const bannerPath = getFavoriteDealsTelegramBannerPath();

  if (!bannerPath) {
    await sendTelegramMessage(chatId, text, { parseMode: 'HTML' });
    return true;
  }

  if (canUseTelegramPhotoCaption(text)) {
    try {
      await sendBotPhoto(chatId, bannerPath, {
        caption: text,
        filename: 'favorite-deals-telegram-banner.png',
        parseMode: 'HTML',
      });
      return true;
    } catch (err) {
      logger.warn('[DealNotifier] Telegram banner send failed, retrying as text only', {
        chatId,
        message: err.message,
      });
      await sendTelegramMessage(chatId, text, { parseMode: 'HTML' });
      return true;
    }
  }

  try {
    await sendBotPhoto(chatId, bannerPath, {
      caption: buildFavoriteDealsTelegramPhotoCaption(deals),
      filename: 'favorite-deals-telegram-banner.png',
      disableNotification: true,
      parseMode: 'HTML',
    });
  } catch (err) {
    logger.warn('[DealNotifier] Telegram banner send failed, continuing with text', {
      chatId,
      message: err.message,
    });
  }

  await sendTelegramMessage(chatId, text, { parseMode: 'HTML' });
  return true;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPaymentPairsHtml(deal) {
  const pairs = getDealPaymentPairs(deal);
  if (!pairs.length) return '';

  return pairs.map((pair) => {
    const originalHtml = pair.original
      ? ` <span style="color:#c2c8d2;text-decoration:line-through;text-decoration-thickness:2px;">${escapeHtml(pair.original)}</span>`
      : '';

    return `<span style="white-space:nowrap;color:#f4f7fb;font-size:16px;font-weight:800;">${escapeHtml(pair.current)}${originalHtml}</span>`;
  }).join('<span style="color:#7d8794;font-weight:700;margin:0 7px;">•</span>');
}

function getFavoriteDealsEmailAttachments() {
  if (!fs.existsSync(FAVORITE_DEALS_BANNER_PATH)) return [];

  return [{
    filename: 'favorite-deals-banner.png',
    path: FAVORITE_DEALS_BANNER_PATH,
    cid: FAVORITE_DEALS_BANNER_CID,
    contentDisposition: 'inline',
  }];
}

function getFavoriteDealsTelegramBannerPath() {
  if (!fs.existsSync(FAVORITE_DEALS_TELEGRAM_BANNER_PATH)) return null;
  return FAVORITE_DEALS_TELEGRAM_BANNER_PATH;
}

function visibleDeals(deals) {
  return deals.slice(0, Math.min(10, deals.length));
}

function buildFavoriteDealsTelegramMessage(_userName, deals) {
  const shownDeals = visibleDeals(deals);
  const hiddenCount = Math.max(0, deals.length - shownDeals.length);
  const lines = [
    `<b>🗣 Подешевели ${deals.length} игр из Избранного</b>`,
    `<a href="${favoritesUrl()}">Открыть избранное</a>`,
    '',
  ];

  for (const deal of shownDeals) {
    const paymentLine = buildTelegramPaymentLine(deal);
    const endText = formatDealEndDate(deal.endDate);
    lines.push(`➬ <a href="${deal.siteUrl}"><b>${escapeHtml(deal.title)}</b></a> <b>(-${deal.discountPercent}%)</b>`);
    if (paymentLine) lines.push(paymentLine);
    if (endText) lines.push(`<i>${escapeHtml(endText)}</i>`);
    lines.push('');
  }

  if (hiddenCount > 0) {
    lines.push(`<i>Еще ${hiddenCount} игр со скидкой в избранном</i>`);
    lines.push('');
  }

  lines.push('<b>·••• Открыть мое ИЗБРАННОЕ •••·</b>');
  lines.push(`<a href="${favoritesUrl()}">${favoritesUrl()}</a>`);
  return lines.join('\n');
}

function buildTelegramPaymentLine(deal) {
  const pairs = getDealPaymentPairs(deal);
  if (!pairs.length) return '';
  return pairs
    .map((pair) => (
      pair.original
        ? `<b>${escapeHtml(pair.current)}</b> <s>${escapeHtml(pair.original)}</s>`
        : `<b>${escapeHtml(pair.current)}</b>`
    ))
    .join(' • ');
}

function buildFavoriteDealsEmailHtml(userName, deals) {
  const shownDeals = visibleDeals(deals);
  const hiddenCount = Math.max(0, deals.length - shownDeals.length);
  const safeName = userName ? `, ${escapeHtml(userName)}` : '';
  const itemsHtml = shownDeals.map((deal) => {
    const paymentLineHtml = buildPaymentPairsHtml(deal);
    const endText = formatDealEndDate(deal.endDate);
    return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #27303a;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td width="72" style="vertical-align:top;">
                <a href="${deal.siteUrl}" style="display:block;">
                  <img src="${deal.image || ''}" alt="${escapeHtml(deal.title)}" width="58" height="58"
                       style="border-radius:8px;object-fit:cover;display:block;background:#161b22;" />
                </a>
              </td>
              <td style="vertical-align:top;">
                <a href="${deal.siteUrl}" style="color:#f4f7fb;font-size:17px;line-height:1.25;font-weight:800;text-decoration:none;">
                  ↝ ${escapeHtml(deal.title)} (-${deal.discountPercent}%)
                </a>
                ${paymentLineHtml ? `<div style="margin-top:7px;line-height:1.6;">${paymentLineHtml}</div>` : ''}
                ${endText ? `<div style="margin-top:3px;color:#f4f7fb;font-size:15px;font-style:italic;">${escapeHtml(endText)}</div>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');
  const moreHtml = hiddenCount > 0
    ? `<p style="color:#9aa4b2;font-size:14px;margin:14px 0 0;">Еще ${hiddenCount} игр со скидкой ждут в избранном.</p>`
    : '';

  return `
<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080d10;font-family:Arial,'Segoe UI',sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#080d10;">
    <tr><td align="center" style="padding:24px 12px;">
      <table cellpadding="0" cellspacing="0" border="0" width="620" style="max-width:620px;width:100%;">
        <tr>
          <td style="background:#fafaf8;border:1px solid #26313d;border-bottom:none;border-radius:12px 12px 0 0;overflow:hidden;">
            <img src="cid:${FAVORITE_DEALS_BANNER_CID}" alt="Избранные игры подешевели" width="620"
                 style="width:100%;max-width:620px;height:auto;display:block;border:0;" />
          </td>
        </tr>
        <tr>
          <td style="padding:24px;background:#111820;border:1px solid #26313d;border-radius:0;">
            <div style="color:#8ef58d;font-size:13px;font-weight:800;text-transform:uppercase;">Избранное Xbox Store</div>
            <h1 style="color:#ffffff;font-size:26px;line-height:1.2;margin:8px 0 8px;">Подешевели ${deals.length} игр из избранного</h1>
            <p style="color:#b8c1cc;font-size:15px;line-height:1.5;margin:0;">Привет${safeName}. Собрал свежие скидки и текущие цены в порядке: код пополнения, ключ, покупка на аккаунт.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:6px 24px 20px;background:#0f141a;border-left:1px solid #26313d;border-right:1px solid #26313d;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">${itemsHtml}</table>
            ${moreHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:22px 24px;background:#111820;border:1px solid #26313d;border-radius:0 0 12px 12px;text-align:center;">
            <a href="${favoritesUrl()}" style="display:inline-block;background:#107c10;color:#fff;text-decoration:none;font-size:15px;font-weight:800;border-radius:8px;padding:13px 24px;">Открыть мое избранное</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function compactDealForReport(deal) {
  return {
    productId: deal.productId,
    title: deal.title,
    discountPercent: deal.discountPercent,
    price: deal.formattedListPrice,
    oldPrice: deal.formattedMsrp,
    siteUrl: deal.siteUrl,
    paymentLine: formatDealPaymentLine(deal),
  };
}

function createRunReport() {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    totals: {
      clients: 0,
      favorites: 0,
      productsChecked: 0,
      productsOnSale: 0,
      clientsWithDeals: 0,
      clientsWithNewDeals: 0,
      sent: 0,
      email: 0,
      telegram: 0,
      skippedNoDeals: 0,
      skippedAlreadyNotified: 0,
      skippedNoContact: 0,
      failed: 0,
    },
    entries: [],
    errors: [],
  };
}

function finishRunReport(report, status = 'success') {
  report.status = status;
  report.finishedAt = new Date().toISOString();
  return report;
}

function addReportEntry(report, entry) {
  report.entries.push({
    userId: entry.user?.user_id || entry.userId,
    name: entry.user?.name || null,
    email: entry.user?.email || null,
    provider: entry.user?.last_provider || null,
    status: entry.status,
    reason: entry.reason || null,
    channel: entry.channel || null,
    recipient: entry.recipient || null,
    favoritesCount: entry.favoritesCount || 0,
    deals: (entry.deals || []).map(compactDealForReport),
    error: entry.error || null,
  });
}

// ---------------------------------------------------------------------------
// 7. Main orchestrator — run once every 24h
// ---------------------------------------------------------------------------

async function runDealNotifications() {
  const report = createRunReport();
  logger.info('[DealNotifier] Starting deal check...');

  // 1. Get all users with favorites
  const users = await getUsersWithFavorites();
  report.totals.clients = users.length;
  report.totals.favorites = users.reduce((sum, user) => sum + (user.product_ids?.length || 0), 0);

  if (users.length === 0) {
    logger.info('[DealNotifier] No users with favorites, done.');
    return finishRunReport(report);
  }

  // 2. Collect unique product IDs across all users
  const allProductIds = [...new Set(users.flatMap((u) => u.product_ids))];
  report.totals.productsChecked = allProductIds.length;
  logger.info(`[DealNotifier] Checking ${allProductIds.length} products for ${users.length} users`);

  // 3. Batch-fetch current product data from Display Catalog
  let rawProducts;
  try {
    rawProducts = await getProductsByIds(allProductIds);
  } catch (err) {
    logger.error('[DealNotifier] Failed to fetch products', { message: err.message });
    report.errors.push({ stage: 'fetch_products', message: err.message });
    return finishRunReport(report, 'failed');
  }

  const productsById = await enrichProductsForDealNotifications(rawProducts);

  // 4. Extract deal info for each product
  const dealsByProductId = {};
  for (const raw of rawProducts) {
    const product = productsById.get(normalizeProductId(raw.ProductId));
    const deal = extractDealInfo(raw, product);
    if (deal) {
      dealsByProductId[normalizeProductId(deal.productId)] = deal;
    }
  }

  const dealProductCount = Object.keys(dealsByProductId).length;
  report.totals.productsOnSale = dealProductCount;
  if (dealProductCount === 0) {
    logger.info('[DealNotifier] No favorites are on sale right now, done.');
    report.totals.skippedNoDeals = users.length;
    return finishRunReport(report);
  }

  logger.info(`[DealNotifier] ${dealProductCount} products have active deals`);

  // 5. For each user, determine which deals are new (not yet notified)
  let totalSent = 0;

  for (const user of users) {
    try {
      // Find which of this user's favorites are on sale
      const userDeals = user.product_ids
        .map((pid) => dealsByProductId[normalizeProductId(pid)])
        .filter(Boolean);

      if (userDeals.length === 0) {
        report.totals.skippedNoDeals += 1;
        continue;
      }

      report.totals.clientsWithDeals += 1;

      // Build (productId, dealKey) pairs to check dedup
      const pairs = userDeals.map((d) => [d.productId, dealKey(d.listPrice, d.msrp)]);

      // Check which were already notified
      const alreadyNotifiedSet = await getAlreadyNotified(user.user_id, pairs);

      // Filter to only new deals
      const newDeals = userDeals.filter((d) => {
        const key = `${d.productId}::${dealKey(d.listPrice, d.msrp)}`;
        return !alreadyNotifiedSet.has(key);
      });

      if (newDeals.length === 0) {
        report.totals.skippedAlreadyNotified += 1;
        addReportEntry(report, {
          user,
          status: 'skipped',
          reason: 'already_notified',
          favoritesCount: user.product_ids.length,
          deals: userDeals,
        });
        continue;
      }

      report.totals.clientsWithNewDeals += 1;

      // Determine notification channel: Telegram if logged in via TG, else email
      const isTelegramUser = user.last_provider === 'telegram';
      let sent = false;
      let sentChannel = null;
      let sentRecipient = null;

      if (isTelegramUser) {
        const chatId = await getTelegramChatId(user.user_id);
        if (chatId) {
          try {
            const telegramSent = await sendFavoriteDealsTelegramNotification(chatId, user.name, newDeals);
            if (!telegramSent) {
              throw new Error('Telegram bot token not configured');
            }
            sent = true;
            sentChannel = 'telegram';
            sentRecipient = chatId;
            logger.info('[DealNotifier] Sent Telegram deals', {
              userId: user.user_id,
              recipient: chatId,
              deals: newDeals.map((deal) => deal.title),
            });
          } catch (err) {
            logger.error(`[DealNotifier] TG send failed for ${user.user_id}`, { message: err.message });
            // Fall back to email if user has one
            if (user.email) {
              try {
                await sendDealEmail(user.email, user.name, newDeals);
                sent = true;
                sentChannel = 'email';
                sentRecipient = user.email;
                logger.info('[DealNotifier] Fallback email deals', {
                  userId: user.user_id,
                  recipient: user.email,
                  deals: newDeals.map((deal) => deal.title),
                });
              } catch (emailErr) {
                logger.error(`[DealNotifier] Email fallback also failed`, { message: emailErr.message });
                report.totals.failed += 1;
                addReportEntry(report, {
                  user,
                  status: 'failed',
                  reason: 'telegram_and_email_failed',
                  favoritesCount: user.product_ids.length,
                  deals: newDeals,
                  error: `${err.message}; ${emailErr.message}`,
                });
              }
            } else {
              report.totals.failed += 1;
              addReportEntry(report, {
                user,
                status: 'failed',
                reason: 'telegram_failed_no_email',
                favoritesCount: user.product_ids.length,
                deals: newDeals,
                error: err.message,
              });
            }
          }
        } else if (user.email) {
          // No TG chat ID available, fall back to email
          try {
            await sendDealEmail(user.email, user.name, newDeals);
            sent = true;
            sentChannel = 'email';
            sentRecipient = user.email;
            logger.info('[DealNotifier] Sent email deals after missing Telegram chat', {
              userId: user.user_id,
              recipient: user.email,
              deals: newDeals.map((deal) => deal.title),
            });
          } catch (err) {
            logger.error(`[DealNotifier] Email failed for ${user.user_id}`, { message: err.message });
            report.totals.failed += 1;
            addReportEntry(report, {
              user,
              status: 'failed',
              reason: 'email_failed',
              favoritesCount: user.product_ids.length,
              deals: newDeals,
              error: err.message,
            });
          }
        } else {
          report.totals.skippedNoContact += 1;
          addReportEntry(report, {
            user,
            status: 'skipped',
            reason: 'no_telegram_chat_or_email',
            favoritesCount: user.product_ids.length,
            deals: newDeals,
          });
        }
      } else if (user.email) {
        try {
          await sendDealEmail(user.email, user.name, newDeals);
          sent = true;
          sentChannel = 'email';
          sentRecipient = user.email;
          logger.info('[DealNotifier] Sent email deals', {
            userId: user.user_id,
            recipient: user.email,
            deals: newDeals.map((deal) => deal.title),
          });
        } catch (err) {
          logger.error(`[DealNotifier] Email failed for ${user.user_id}`, { message: err.message });
          report.totals.failed += 1;
          addReportEntry(report, {
            user,
            status: 'failed',
            reason: 'email_failed',
            favoritesCount: user.product_ids.length,
            deals: newDeals,
            error: err.message,
          });
        }
      } else {
        report.totals.skippedNoContact += 1;
        addReportEntry(report, {
          user,
          status: 'skipped',
          reason: 'no_email',
          favoritesCount: user.product_ids.length,
          deals: newDeals,
        });
      }

      // Mark as notified only if we actually sent something
      if (sent) {
        const newPairs = newDeals.map((d) => [d.productId, dealKey(d.listPrice, d.msrp)]);
        await markNotified(user.user_id, newPairs);
        totalSent++;
        report.totals.sent += 1;
        if (sentChannel === 'telegram') report.totals.telegram += 1;
        if (sentChannel === 'email') report.totals.email += 1;
        addReportEntry(report, {
          user,
          status: 'sent',
          channel: sentChannel,
          recipient: sentRecipient,
          favoritesCount: user.product_ids.length,
          deals: newDeals,
        });
      }
    } catch (err) {
      report.totals.failed += 1;
      report.errors.push({ stage: 'process_user', userId: user.user_id, message: err.message });
      addReportEntry(report, {
        user,
        status: 'failed',
        reason: 'process_user_error',
        favoritesCount: user.product_ids?.length || 0,
        deals: [],
        error: err.message,
      });
      logger.error(`[DealNotifier] Error processing user ${user.user_id}`, {
        message: err.message,
        stack: err.stack,
      });
    }
  }

  // 6. Cleanup old notification records (older than 30 days)
  try {
    await pool.query(`DELETE FROM deal_notifications WHERE notified_at < NOW() - INTERVAL '30 days'`);
  } catch (err) {
    logger.error('[DealNotifier] Cleanup failed', { message: err.message });
    report.errors.push({ stage: 'cleanup', message: err.message });
  }

  logger.info('[DealNotifier] Done.', {
    clients: report.totals.clients,
    sent: totalSent,
    email: report.totals.email,
    telegram: report.totals.telegram,
    skippedAlreadyNotified: report.totals.skippedAlreadyNotified,
    skippedNoContact: report.totals.skippedNoContact,
    failed: report.totals.failed,
  });

  return finishRunReport(report, report.totals.failed > 0 || report.errors.length > 0 ? 'partial' : 'success');
}

module.exports = { runDealNotifications };

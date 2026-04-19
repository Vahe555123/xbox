const axios = require('axios');
const nodemailer = require('nodemailer');
const pool = require('../db/pool');
const config = require('../config');
const { getProductsByIds } = require('./displayCatalogService');
const logger = require('../utils/logger');

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
      array_agg(f.product_id) AS product_ids
    FROM users u
    JOIN favorites f ON f.user_id = u.id
    GROUP BY u.id
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// 2. For a set of product IDs, fetch current prices from Display Catalog
// ---------------------------------------------------------------------------

function extractDealInfo(raw) {
  const lp = raw.LocalizedProperties?.[0] || {};
  const images = lp.Images || [];

  const image =
    findImage(images, 'Poster') ||
    findImage(images, 'BoxArt') ||
    findImage(images, 'BrandedKeyArt') ||
    findImage(images, 'SuperHeroArt') ||
    (images[0] ? absUri(images[0].Uri) : null);

  // Find best price across SKUs
  let listPrice = null;
  let msrp = null;
  let currency = 'USD';
  let endDate = null;

  const skus = raw.DisplaySkuAvailabilities || [];
  for (const skuEntry of skus) {
    for (const av of skuEntry.Availabilities || []) {
      const price = av.OrderManagementData?.Price;
      if (price && price.ListPrice != null) {
        listPrice = price.ListPrice;
        msrp = price.MSRP ?? null;
        currency = price.CurrencyCode || 'USD';
        // EndDate signals when the sale ends
        endDate = av.Conditions?.EndDate || av.EndDate || null;
        break;
      }
    }
    if (listPrice !== null) break;
  }

  const hasDiscount = msrp != null && listPrice != null && listPrice < msrp && listPrice > 0;

  if (!hasDiscount) return null;

  const discountPercent = Math.round(((msrp - listPrice) / msrp) * 100);

  return {
    productId: raw.ProductId,
    title: lp.ProductTitle || raw.ProductId,
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
  };
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
  const { rows } = await pool.query(
    `SELECT provider_user_id FROM oauth_accounts
     WHERE user_id = $1 AND provider = 'telegram'`,
    [userId],
  );
  return rows[0]?.provider_user_id || null;
}

// ---------------------------------------------------------------------------
// 5. Send email
// ---------------------------------------------------------------------------

function createTransport() {
  return nodemailer.createTransport({
    host: config.auth.smtp.host,
    port: config.auth.smtp.port,
    secure: config.auth.smtp.secure,
    auth: {
      user: config.auth.smtp.username,
      pass: config.auth.smtp.password,
    },
  });
}

function getFromAddress() {
  if (config.auth.smtp.from) return config.auth.smtp.from;
  if (!config.auth.smtp.fromEmail) return config.auth.smtp.username;
  return `"${config.auth.smtp.fromName}" <${config.auth.smtp.fromEmail}>`;
}

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
  const transporter = createTransport();

  const subject = deals.length === 1
    ? `Скидка ${deals[0].discountPercent}% на ${deals[0].title}!`
    : `Скидки на ${deals.length} ваших любимых игр!`;

  await transporter.sendMail({
    from: getFromAddress(),
    to: email,
    subject,
    html: buildEmailHtml(userName, deals),
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
  const botToken = config.auth.telegram.botToken;
  if (!botToken) {
    logger.warn('Telegram bot token not configured, skipping TG notification');
    return;
  }

  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: false,
  });
}

// ---------------------------------------------------------------------------
// 7. Main orchestrator — run once every 24h
// ---------------------------------------------------------------------------

async function runDealNotifications() {
  logger.info('[DealNotifier] Starting deal check...');

  // 1. Get all users with favorites
  const users = await getUsersWithFavorites();
  if (users.length === 0) {
    logger.info('[DealNotifier] No users with favorites, done.');
    return;
  }

  // 2. Collect unique product IDs across all users
  const allProductIds = [...new Set(users.flatMap((u) => u.product_ids))];
  logger.info(`[DealNotifier] Checking ${allProductIds.length} products for ${users.length} users`);

  // 3. Batch-fetch current product data from Display Catalog
  let rawProducts;
  try {
    rawProducts = await getProductsByIds(allProductIds);
  } catch (err) {
    logger.error('[DealNotifier] Failed to fetch products', { message: err.message });
    return;
  }

  // 4. Extract deal info for each product
  const dealsByProductId = {};
  for (const raw of rawProducts) {
    const deal = extractDealInfo(raw);
    if (deal) {
      dealsByProductId[deal.productId] = deal;
    }
  }

  const dealProductCount = Object.keys(dealsByProductId).length;
  if (dealProductCount === 0) {
    logger.info('[DealNotifier] No favorites are on sale right now, done.');
    return;
  }

  logger.info(`[DealNotifier] ${dealProductCount} products have active deals`);

  // 5. For each user, determine which deals are new (not yet notified)
  let totalSent = 0;

  for (const user of users) {
    try {
      // Find which of this user's favorites are on sale
      const userDeals = user.product_ids
        .map((pid) => dealsByProductId[pid])
        .filter(Boolean);

      if (userDeals.length === 0) continue;

      // Build (productId, dealKey) pairs to check dedup
      const pairs = userDeals.map((d) => [d.productId, dealKey(d.listPrice, d.msrp)]);

      // Check which were already notified
      const alreadyNotifiedSet = await getAlreadyNotified(user.user_id, pairs);

      // Filter to only new deals
      const newDeals = userDeals.filter((d) => {
        const key = `${d.productId}::${dealKey(d.listPrice, d.msrp)}`;
        return !alreadyNotifiedSet.has(key);
      });

      if (newDeals.length === 0) continue;

      // Determine notification channel: Telegram if logged in via TG, else email
      const isTelegramUser = user.last_provider === 'telegram';
      let sent = false;

      if (isTelegramUser) {
        const chatId = await getTelegramChatId(user.user_id);
        if (chatId) {
          try {
            const msg = buildTelegramMessage(user.name, newDeals);
            await sendTelegramMessage(chatId, msg);
            sent = true;
            logger.info(`[DealNotifier] Sent TG to user ${user.user_id} (${newDeals.length} deals)`);
          } catch (err) {
            logger.error(`[DealNotifier] TG send failed for ${user.user_id}`, { message: err.message });
            // Fall back to email if user has one
            if (user.email) {
              try {
                await sendDealEmail(user.email, user.name, newDeals);
                sent = true;
                logger.info(`[DealNotifier] Fallback email to ${user.user_id}`);
              } catch (emailErr) {
                logger.error(`[DealNotifier] Email fallback also failed`, { message: emailErr.message });
              }
            }
          }
        } else if (user.email) {
          // No TG chat ID available, fall back to email
          try {
            await sendDealEmail(user.email, user.name, newDeals);
            sent = true;
          } catch (err) {
            logger.error(`[DealNotifier] Email failed for ${user.user_id}`, { message: err.message });
          }
        }
      } else if (user.email) {
        try {
          await sendDealEmail(user.email, user.name, newDeals);
          sent = true;
          logger.info(`[DealNotifier] Sent email to ${user.user_id} (${newDeals.length} deals)`);
        } catch (err) {
          logger.error(`[DealNotifier] Email failed for ${user.user_id}`, { message: err.message });
        }
      }

      // Mark as notified only if we actually sent something
      if (sent) {
        const newPairs = newDeals.map((d) => [d.productId, dealKey(d.listPrice, d.msrp)]);
        await markNotified(user.user_id, newPairs);
        totalSent++;
      }
    } catch (err) {
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
  }

  logger.info(`[DealNotifier] Done. Notified ${totalSent} users.`);
}

module.exports = { runDealNotifications };

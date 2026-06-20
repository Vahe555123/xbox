const pool = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');
const catalogService = require('./xboxCatalogService');
const { mapProducts } = require('../mappers/productMapper');
const { encodeFilters } = require('../mappers/filtersMapper');

const MAX_PAGES = Number(process.env.SALE_INDEX_MAX_PAGES) || 80;
const STOP_EMPTY_RUNS = 3; // stop scanning if N consecutive pages have no deals

// Encode browse filters for the "AllDeals desc" sort
const DEALS_ENCODED_FILTERS = encodeFilters({ orderby: ['AllDeals desc'] });

async function fetchBrowsePage(encodedCT) {
  return catalogService.browseGames({
    encodedFilters: DEALS_ENCODED_FILTERS,
    encodedCT,
    returnFilters: false,
    channelId: '',
  });
}

async function upsertSaleProducts(products) {
  if (!products.length) return 0;
  let updated = 0;
  const now = new Date();

  for (const p of products) {
    const endDate = p.price?.dealEndDate ? new Date(p.price.dealEndDate) : null;
    const endDay = endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString().slice(0, 10) : null;
    const res = await pool.query(
      `INSERT INTO sale_products
         (product_id, title, image, price_usd, original_price_usd, discount_percent,
          deal_end_date, deal_end_day, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (product_id) DO UPDATE SET
         title = EXCLUDED.title,
         image = EXCLUDED.image,
         price_usd = EXCLUDED.price_usd,
         original_price_usd = EXCLUDED.original_price_usd,
         discount_percent = EXCLUDED.discount_percent,
         deal_end_date = EXCLUDED.deal_end_date,
         deal_end_day = EXCLUDED.deal_end_day,
         last_seen_at = EXCLUDED.last_seen_at
       RETURNING product_id`,
      [
        p.id,
        p.title || null,
        p.image || null,
        p.price?.value ?? null,
        p.price?.original ?? null,
        p.price?.discountPercent != null ? Math.round(p.price.discountPercent) : null,
        endDate ?? null,
        endDay,
        now,
      ],
    );
    if (res.rowCount > 0) updated += 1;
  }
  return updated;
}

async function refreshSaleProducts() {
  const startedAt = new Date();
  const runRes = await pool.query(
    `INSERT INTO sale_index_runs (status, started_at) VALUES ('running', $1) RETURNING id`,
    [startedAt],
  );
  const runId = runRes.rows[0].id;

  try {
    let encodedCT = '';
    let pages = 0;
    let totalFound = 0;
    let totalUpdated = 0;
    let emptyRuns = 0;
    const seenTokens = new Set();

    do {
      const raw = await fetchBrowsePage(encodedCT);
      const mapped = mapProducts(raw.products || []);
      const saleProducts = mapped.filter(
        (p) => p.price && p.price.discountPercent > 0 && !p.notAvailableSeparately,
      );

      if (saleProducts.length === 0) {
        emptyRuns += 1;
      } else {
        emptyRuns = 0;
        totalFound += saleProducts.length;
        totalUpdated += await upsertSaleProducts(saleProducts);
      }

      pages += 1;
      const nextToken = raw.encodedCT || '';
      if (!nextToken || seenTokens.has(nextToken)) break;
      seenTokens.add(nextToken);
      encodedCT = nextToken;

      if (emptyRuns >= STOP_EMPTY_RUNS) {
        logger.info('[SaleIndex] No deals on last pages, stopping early', { pages });
        break;
      }
    } while (pages < MAX_PAGES);

    // Remove stale records (not seen in this run)
    await pool.query(
      `DELETE FROM sale_products WHERE last_seen_at < $1`,
      [startedAt],
    );

    const finishedAt = new Date();
    await pool.query(
      `UPDATE sale_index_runs SET status='success', products_found=$2,
         products_updated=$3, pages_scanned=$4, finished_at=$5 WHERE id=$1`,
      [runId, totalFound, totalUpdated, pages, finishedAt],
    );

    logger.info('[SaleIndex] Refresh complete', { pages, found: totalFound, updated: totalUpdated });
    return { runId, pagesScanned: pages, productsFound: totalFound, productsUpdated: totalUpdated };
  } catch (err) {
    await pool.query(
      `UPDATE sale_index_runs SET status='failed', error=$2, finished_at=NOW() WHERE id=$1`,
      [runId, err.message],
    ).catch(() => {});
    logger.error('[SaleIndex] Refresh failed', { runId, message: err.message });
    throw err;
  }
}

async function listSaleEndDates() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT deal_end_day, COUNT(*)::int AS product_count
     FROM sale_products
     WHERE deal_end_day IS NOT NULL AND deal_end_day >= $1
     GROUP BY deal_end_day
     ORDER BY deal_end_day ASC`,
    [today],
  );
  return rows.map((r) => ({
    date: r.deal_end_day,
    productCount: r.product_count,
  }));
}

async function getProductsByEndDay(date) {
  const { rows } = await pool.query(
    `SELECT product_id, title, image, price_usd, original_price_usd,
            discount_percent, deal_end_date
     FROM sale_products
     WHERE deal_end_day = $1
     ORDER BY discount_percent DESC NULLS LAST`,
    [date],
  );
  return rows;
}

async function getLastRun() {
  const { rows } = await pool.query(
    `SELECT id, status, products_found, products_updated, pages_scanned, error, started_at, finished_at
     FROM sale_index_runs
     ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] || null;
}

async function getState() {
  const [lastRun, totalCount, endDates] = await Promise.all([
    getLastRun(),
    pool.query('SELECT COUNT(*)::int AS count FROM sale_products').then((r) => r.rows[0].count),
    listSaleEndDates(),
  ]);
  return { lastRun, totalProducts: totalCount, saleEndDates: endDates };
}

// Subscribe user to reminder for a specific deal-end day
async function subscribeSaleEndReminder(userId, dealEndDay) {
  await pool.query(
    `INSERT INTO sale_end_reminders (user_id, deal_end_day)
     VALUES ($1, $2)
     ON CONFLICT (user_id, deal_end_day) DO NOTHING`,
    [userId, dealEndDay],
  );
}

// Get pending reminders for today (to be processed by the notifier)
async function getPendingReminders(day) {
  const { rows } = await pool.query(
    `SELECT r.id, r.user_id, r.deal_end_day,
            u.email, u.name, u.last_provider
     FROM sale_end_reminders r
     JOIN users u ON u.id = r.user_id
     WHERE r.deal_end_day = $1 AND r.notified = FALSE`,
    [day],
  );
  return rows;
}

async function markReminderSent(ids) {
  if (!ids.length) return;
  await pool.query(
    `UPDATE sale_end_reminders SET notified=TRUE, notified_at=NOW()
     WHERE id = ANY($1::bigint[])`,
    [ids],
  );
}

module.exports = {
  refreshSaleProducts,
  listSaleEndDates,
  getProductsByEndDay,
  getLastRun,
  getState,
  subscribeSaleEndReminder,
  getPendingReminders,
  markReminderSent,
};

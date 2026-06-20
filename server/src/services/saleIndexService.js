const pool = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');
const catalogService = require('./xboxCatalogService');
const { mapProducts } = require('../mappers/productMapper');
const { encodeFilters } = require('../mappers/filtersMapper');

const MAX_PAGES = Number(process.env.SALE_INDEX_MAX_PAGES) || 400;

// Same query the site's "Скидки" filter sends: the Price=OnSale facet returns
// ONLY discounted games, so we can page through every result to the end.
// Sorted by discount desc so biggest deals come first.
const DEALS_ENCODED_FILTERS = encodeFilters({
  Price: ['OnSale'],
  orderby: ['DiscountPercentage desc'],
});

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

/**
 * Run a full sale-index refresh.
 *
 * @param {Object}   [opts]
 * @param {Function} [opts.onProgress] called with a `{ progress, log }` snapshot
 *                   whenever state changes, so callers can stream it live.
 * @param {Function} [opts.shouldCancel] return `true` to abort the scan early
 *                   (cleanup of stale records is skipped on cancel).
 */
async function refreshSaleProducts({ onProgress, shouldCancel } = {}) {
  const startedAt = new Date();
  const runRes = await pool.query(
    `INSERT INTO sale_index_runs (status, started_at) VALUES ('running', $1) RETURNING id`,
    [startedAt],
  );
  const runId = runRes.rows[0].id;

  const log = [];
  const progress = {
    phase: 'scanning', // scanning | cleanup | done | cancelled | error
    page: 0,
    pagesScanned: 0,
    productsFound: 0,
    productsUpdated: 0,
    productsDeleted: 0,
    totalItems: null,
    estimatedPages: null,
    maxPages: MAX_PAGES,
  };

  const emit = (message) => {
    if (message) log.push({ ts: new Date().toISOString(), message });
    if (onProgress) {
      try {
        onProgress({ progress: { ...progress }, log: log.slice() });
      } catch { /* ignore */ }
    }
  };

  emit('Запуск сканирования игр со скидкой (фильтр Price=OnSale)');

  try {
    let encodedCT = '';
    let cancelled = false;
    let pageSize = 0;
    const seenTokens = new Set();

    do {
      if (shouldCancel && shouldCancel()) {
        cancelled = true;
        progress.phase = 'cancelled';
        emit('⛔ Сканирование отменено пользователем');
        break;
      }

      const raw = await fetchBrowsePage(encodedCT);

      const mapped = mapProducts(raw.products || []);
      if (!pageSize && mapped.length) pageSize = mapped.length;
      if (progress.totalItems === null && Number.isFinite(raw.totalItems)) {
        progress.totalItems = raw.totalItems;
        if (pageSize) progress.estimatedPages = Math.ceil(raw.totalItems / pageSize);
        emit(`Игр со скидкой всего: ${raw.totalItems.toLocaleString('ru-RU')}${progress.estimatedPages ? ` (~${progress.estimatedPages} стр.)` : ''}`);
      }

      const saleProducts = mapped.filter(
        (p) => p.price && p.price.discountPercent > 0 && !p.notAvailableSeparately,
      );

      progress.page += 1;
      progress.productsFound += saleProducts.length;
      const updated = await upsertSaleProducts(saleProducts);
      progress.productsUpdated += updated;
      progress.pagesScanned = progress.page;

      const totalLabel = progress.totalItems != null ? ` из ~${progress.totalItems.toLocaleString('ru-RU')}` : '';
      emit(`Страница ${progress.page}${progress.estimatedPages ? `/${progress.estimatedPages}` : ''}: +${saleProducts.length} · сохранено всего ${progress.productsUpdated}${totalLabel}`);

      const nextToken = raw.encodedCT || '';
      if (!nextToken || seenTokens.has(nextToken)) {
        emit('Достигнут конец списка скидок');
        break;
      }
      seenTokens.add(nextToken);
      encodedCT = nextToken;
    } while (progress.page < MAX_PAGES);

    if (!cancelled && progress.page >= MAX_PAGES) {
      emit(`Достигнут лимит страниц (${MAX_PAGES})`);
    }

    if (cancelled) {
      const finishedAt = new Date();
      await pool.query(
        `UPDATE sale_index_runs SET status='cancelled', products_found=$2,
           products_updated=$3, pages_scanned=$4, total_items=$5, log=$6, finished_at=$7 WHERE id=$1`,
        [runId, progress.productsFound, progress.productsUpdated, progress.pagesScanned,
          progress.totalItems, JSON.stringify(log), finishedAt],
      );
      logger.info('[SaleIndex] Refresh cancelled', { pages: progress.pagesScanned });
      emit('Сканирование остановлено. Устаревшие записи НЕ удалялись.');
      return {
        runId, status: 'cancelled', progress: { ...progress }, log: log.slice(),
        pagesScanned: progress.pagesScanned, productsFound: progress.productsFound,
        productsUpdated: progress.productsUpdated,
      };
    }

    // Remove stale records (not seen in this run)
    progress.phase = 'cleanup';
    emit('Удаление устаревших записей (скидки, которых больше нет)...');
    const del = await pool.query(
      `DELETE FROM sale_products WHERE last_seen_at < $1`,
      [startedAt],
    );
    progress.productsDeleted = del.rowCount || 0;
    emit(`Удалено устаревших: ${progress.productsDeleted}`);

    progress.phase = 'done';
    const finishedAt = new Date();
    await pool.query(
      `UPDATE sale_index_runs SET status='success', products_found=$2,
         products_updated=$3, pages_scanned=$4, products_deleted=$5, total_items=$6,
         log=$7, finished_at=$8 WHERE id=$1`,
      [runId, progress.productsFound, progress.productsUpdated, progress.pagesScanned,
        progress.productsDeleted, progress.totalItems, JSON.stringify(log), finishedAt],
    );

    emit(`✅ Готово: страниц ${progress.pagesScanned}, найдено ${progress.productsFound}, удалено ${progress.productsDeleted}`);
    logger.info('[SaleIndex] Refresh complete', {
      pages: progress.pagesScanned, found: progress.productsFound, updated: progress.productsUpdated,
    });
    return {
      runId, status: 'success', progress: { ...progress }, log: log.slice(),
      pagesScanned: progress.pagesScanned, productsFound: progress.productsFound,
      productsUpdated: progress.productsUpdated,
    };
  } catch (err) {
    progress.phase = 'error';
    emit(`❌ Ошибка: ${err.message}`);
    await pool.query(
      `UPDATE sale_index_runs SET status='failed', error=$2, pages_scanned=$3,
         products_found=$4, products_updated=$5, log=$6, finished_at=NOW() WHERE id=$1`,
      [runId, err.message, progress.pagesScanned, progress.productsFound,
        progress.productsUpdated, JSON.stringify(log)],
    ).catch(() => {});
    logger.error('[SaleIndex] Refresh failed', { runId, message: err.message });
    throw err;
  }
}

async function listSaleEndDates() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT to_char(deal_end_day, 'YYYY-MM-DD') AS deal_end_day, COUNT(*)::int AS product_count
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
    `SELECT id, status, products_found, products_updated, pages_scanned,
            products_deleted, total_items, log, error, started_at, finished_at
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

const axios = require('axios');
const pool = require('../db/pool');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const CARDS_CACHE_KEY = 'topup:cards';
const CARDS_CACHE_TTL_SECONDS = 60;
const ALLOWED_DENOMINATIONS = [5, 10, 25, 50];

const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// Brackets per user spec for denominations {5,10,25,50}.
// Each slot covers prices (low, high]: 0-5→[5], 5-10→[10], 10-15→[5,10], etc.
const PRICE_BRACKETS = [
  { max: 5, cards: [5] },
  { max: 10, cards: [10] },
  { max: 15, cards: [5, 10] },
  { max: 20, cards: [10, 10] },
  { max: 25, cards: [25] },
  { max: 30, cards: [10, 10, 10] },
  { max: 35, cards: [25, 10] },
  { max: 40, cards: [25, 10, 5] },
  { max: 45, cards: [25, 10, 10, 5] },
  { max: 50, cards: [50] },
];

function normalizeUsdValue(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return ALLOWED_DENOMINATIONS.includes(n) ? n : null;
}

function formatRub(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(Number(value));
  } catch {
    return `${Math.round(Number(value))} RUB`;
  }
}

function mapCardRow(row) {
  if (!row) return null;
  const priceRub = row.price_rub != null ? Number(row.price_rub) : null;
  return {
    usdValue: Number(row.usd_value),
    optionId: row.option_id || null,
    priceRub,
    priceRubFormatted: formatRub(priceRub),
    inStock: Boolean(row.in_stock),
    enabled: Boolean(row.enabled),
    label: row.label || null,
    lastRefreshedAt: row.last_refreshed_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function listCards({ useCache = true } = {}) {
  if (useCache) {
    const cached = cache.get(CARDS_CACHE_KEY);
    if (cached) return cached;
  }
  const { rows } = await pool.query(
    `SELECT usd_value, option_id, price_rub, in_stock, enabled, label, last_refreshed_at, updated_at
     FROM xbox_topup_cards
     WHERE usd_value = ANY($1::int[])
     ORDER BY usd_value ASC`,
    [ALLOWED_DENOMINATIONS],
  );
  const items = rows.map(mapCardRow);
  cache.set(CARDS_CACHE_KEY, items, CARDS_CACHE_TTL_SECONDS);
  return items;
}

async function getLatestRefreshRun() {
  const { rows } = await pool.query(
    `SELECT id, status, parsed_count, updated_count, option_category_id, error, started_at, finished_at
     FROM xbox_topup_refresh_runs
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
  );
  return rows[0] || null;
}

async function getTopupState() {
  const [cards, lastRun] = await Promise.all([listCards({ useCache: false }), getLatestRefreshRun()]);
  return {
    productId: config.digiseller.topupCardProductId,
    optionCategoryId: config.digiseller.topupCardOptionCategoryId || null,
    cards,
    lastRun,
  };
}

function invalidateCache() {
  cache.delete(CARDS_CACHE_KEY);
}

async function updateCard(usdValue, patch = {}) {
  const usd = normalizeUsdValue(usdValue);
  if (!usd) throw new Error(`Unsupported denomination: ${usdValue}`);

  const fields = [];
  const values = [];
  let i = 1;
  const push = (column, value) => {
    fields.push(`${column} = $${i}`);
    values.push(value);
    i += 1;
  };

  if (patch.optionId !== undefined) push('option_id', patch.optionId || null);
  if (patch.priceRub !== undefined) {
    const priceRub = patch.priceRub === null || patch.priceRub === '' ? null : Number(patch.priceRub);
    push('price_rub', Number.isFinite(priceRub) ? priceRub : null);
  }
  if (patch.inStock !== undefined) push('in_stock', Boolean(patch.inStock));
  if (patch.enabled !== undefined) push('enabled', Boolean(patch.enabled));
  if (patch.label !== undefined) push('label', patch.label || null);
  if (patch.markRefreshed) push('last_refreshed_at', new Date());

  if (fields.length === 0) {
    const { rows } = await pool.query(
      `SELECT usd_value, option_id, price_rub, in_stock, enabled, label, last_refreshed_at, updated_at
       FROM xbox_topup_cards WHERE usd_value = $1`,
      [usd],
    );
    return mapCardRow(rows[0]);
  }

  fields.push(`updated_at = NOW()`);
  values.push(usd);
  const { rows } = await pool.query(
    `UPDATE xbox_topup_cards SET ${fields.join(', ')}
     WHERE usd_value = $${i}
     RETURNING usd_value, option_id, price_rub, in_stock, enabled, label, last_refreshed_at, updated_at`,
    values,
  );
  invalidateCache();
  return mapCardRow(rows[0]);
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTopupHtml(html) {
  if (!html) return { categoryId: null, options: [] };

  const radioRegex = /<input\b[^>]*type=["']radio["'][^>]*>/gi;
  const options = [];
  let categoryId = null;
  let match;

  while ((match = radioRegex.exec(html)) !== null) {
    const tag = match[0];
    const nameMatch = tag.match(/name=["']?Option_radio_(\d+)["']?/i);
    if (!nameMatch) continue;
    const catId = nameMatch[1];
    if (!categoryId) categoryId = catId;

    const valueMatch = tag.match(/value=["']?(\d+)["']?/i);
    if (!valueMatch) continue;
    const optionId = valueMatch[1];

    const startIdx = match.index;
    const endIdx = Math.min(html.length, radioRegex.lastIndex + 600);
    const context = html.slice(Math.max(0, startIdx - 200), endIdx);

    const usdMatch = context.match(/\$\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:USD|\$)\b/i);
    if (!usdMatch) continue;
    const usd = parseInt(usdMatch[1] || usdMatch[2], 10);
    if (!ALLOWED_DENOMINATIONS.includes(usd)) continue;

    const priceMatch = context.match(/\+\s*([\d\s.,]+)\s*(?:RUB|руб|₽)/i)
      || context.match(/\(\s*([\d\s.,]+)\s*(?:RUB|руб|₽)\s*\)/i);
    let priceRub = null;
    if (priceMatch) {
      const cleaned = priceMatch[1].replace(/[\s.]/g, '').replace(',', '.');
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) priceRub = Math.round(parsed);
    }

    const plainContext = stripTags(context);
    const outOfStock = /нет\s+в\s+налич|не\s*в\s*налич|out\s+of\s+stock|недоступ/i.test(plainContext)
      || /disabled/i.test(tag);

    const labelMatch = plainContext.match(new RegExp(`\\$\\s*${usd}\\b[^()]*`, 'i'));
    const label = labelMatch ? labelMatch[0].trim().slice(0, 120) : `$${usd}`;

    options.push({
      categoryId: catId,
      optionId,
      usdValue: usd,
      priceRub,
      inStock: !outOfStock,
      label,
    });
  }

  const deduped = new Map();
  for (const opt of options) {
    const existing = deduped.get(opt.usdValue);
    if (!existing || (opt.priceRub && !existing.priceRub)) deduped.set(opt.usdValue, opt);
  }
  return { categoryId, options: [...deduped.values()].sort((a, b) => a.usdValue - b.usdValue) };
}

async function fetchTopupPageHtml() {
  const productId = config.digiseller.topupCardProductId;
  if (!productId) throw new Error('Topup card product id is not configured');
  const url = new URL(config.digiseller.payBaseUrl);
  url.searchParams.set('id_d', String(productId));
  url.searchParams.set('ai', String(config.digiseller.sellerId || ''));
  url.searchParams.set('_ow', '0');
  url.searchParams.set('Lang', 'ru-RU');

  const { data } = await axios.get(url.toString(), {
    headers: BROWSER_HEADERS,
    timeout: 15000,
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  return data;
}

async function refreshCards() {
  const startedAt = new Date();
  const runInsert = await pool.query(
    `INSERT INTO xbox_topup_refresh_runs (status, started_at) VALUES ('running', $1)
     RETURNING id`,
    [startedAt],
  );
  const runId = runInsert.rows[0].id;

  try {
    const html = await fetchTopupPageHtml();
    const { categoryId, options } = parseTopupHtml(html);

    if (options.length === 0) {
      throw new Error('Parser could not find any topup options on the page');
    }

    let updatedCount = 0;
    for (const opt of options) {
      const res = await pool.query(
        `INSERT INTO xbox_topup_cards (usd_value, option_id, price_rub, in_stock, label, last_refreshed_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (usd_value) DO UPDATE SET
           option_id = EXCLUDED.option_id,
           price_rub = EXCLUDED.price_rub,
           in_stock = EXCLUDED.in_stock,
           label = EXCLUDED.label,
           last_refreshed_at = NOW(),
           updated_at = NOW()
         RETURNING usd_value`,
        [opt.usdValue, opt.optionId, opt.priceRub, opt.inStock, opt.label],
      );
      if (res.rowCount > 0) updatedCount += 1;
    }

    // Any denomination that wasn't seen in this parse: mark as out of stock
    const seenValues = options.map((o) => o.usdValue);
    await pool.query(
      `UPDATE xbox_topup_cards SET in_stock = FALSE, updated_at = NOW()
       WHERE usd_value = ANY($1::int[]) AND usd_value <> ALL($2::int[])`,
      [ALLOWED_DENOMINATIONS, seenValues],
    );

    const finishedAt = new Date();
    await pool.query(
      `UPDATE xbox_topup_refresh_runs
       SET status = 'success', parsed_count = $2, updated_count = $3,
           option_category_id = $4, finished_at = $5
       WHERE id = $1`,
      [runId, options.length, updatedCount, categoryId, finishedAt],
    );
    invalidateCache();

    logger.info('Xbox topup cards refreshed', {
      runId,
      parsed: options.length,
      updated: updatedCount,
      categoryId,
    });

    return {
      runId,
      parsedCount: options.length,
      updatedCount,
      optionCategoryId: categoryId,
      cards: await listCards({ useCache: false }),
    };
  } catch (err) {
    const finishedAt = new Date();
    await pool.query(
      `UPDATE xbox_topup_refresh_runs
       SET status = 'failed', error = $2, finished_at = $3
       WHERE id = $1`,
      [runId, err.message, finishedAt],
    ).catch(() => {});
    logger.error('Xbox topup cards refresh failed', { runId, message: err.message });
    throw err;
  }
}

function bracketFor(priceUsd) {
  const p = Math.max(0, Number(priceUsd) || 0);
  if (p === 0) return [];
  if (p > 50) {
    const fifties = Math.floor(p / 50);
    const remainder = p - fifties * 50;
    const tail = remainder > 0 ? bracketFor(remainder) : [];
    return [...Array(fifties).fill(50), ...tail];
  }
  for (const bracket of PRICE_BRACKETS) {
    if (p <= bracket.max) return [...bracket.cards];
  }
  return [50];
}

function substituteForUnavailable(cards, availableSet) {
  const result = [];
  for (const denomination of cards) {
    if (availableSet.has(denomination)) {
      result.push(denomination);
      continue;
    }
    // Fallback: replace with the nearest smaller available denominations covering >= denomination
    let remaining = denomination;
    const sortedAvail = [...availableSet].sort((a, b) => b - a);
    let guard = 0;
    while (remaining > 0 && guard < 50) {
      const pick = sortedAvail.find((v) => v <= remaining) || sortedAvail[sortedAvail.length - 1];
      if (!pick) return null;
      result.push(pick);
      remaining -= pick;
      guard += 1;
    }
    if (remaining > 0) {
      const smallest = sortedAvail[sortedAvail.length - 1];
      if (smallest) result.push(smallest);
    }
  }
  return result;
}

function summarizeCombo(cardList, cardMap) {
  const summary = new Map();
  let totalUsd = 0;
  let totalRub = 0;
  let totalRubKnown = true;
  for (const usd of cardList) {
    const entry = summary.get(usd) || { usdValue: usd, count: 0, priceRub: cardMap.get(usd)?.priceRub ?? null };
    entry.count += 1;
    summary.set(usd, entry);
    totalUsd += usd;
    const card = cardMap.get(usd);
    if (card?.priceRub != null) totalRub += Number(card.priceRub);
    else totalRubKnown = false;
  }
  const items = [...summary.values()]
    .sort((a, b) => b.usdValue - a.usdValue)
    .map((item) => ({
      ...item,
      subtotalRub: item.priceRub != null ? item.priceRub * item.count : null,
      subtotalRubFormatted: item.priceRub != null ? formatRub(item.priceRub * item.count) : null,
    }));
  return {
    items,
    cardsCount: cardList.length,
    totalUsd,
    totalRub: totalRubKnown ? totalRub : null,
    totalRubFormatted: totalRubKnown ? formatRub(totalRub) : null,
  };
}

function buildCardPayUrl(card, { quantity = 1, purchaseEmail, optionCategoryId } = {}) {
  const productId = config.digiseller.topupCardProductId;
  const sellerId = config.digiseller.sellerId;
  if (!productId || !sellerId || !card?.optionId) return null;
  const catId = optionCategoryId || config.digiseller.topupCardOptionCategoryId || null;
  const url = new URL(config.digiseller.payBaseUrl);
  url.searchParams.set('id_d', String(productId));
  url.searchParams.set('ai', String(sellerId));
  url.searchParams.set('_ow', '0');
  url.searchParams.set('Lang', 'ru-RU');
  if (catId) url.searchParams.set(`Option_radio_${catId}`, String(card.optionId));
  if (quantity > 1) {
    url.searchParams.set('n', String(quantity));
    url.searchParams.set('product_cnt', String(quantity));
  }
  if (purchaseEmail) url.searchParams.set('email', purchaseEmail);
  return url.toString();
}

async function buildComboPurchase(priceUsd, { purchaseEmail } = {}) {
  const combo = await computeCombo(priceUsd);
  if (!combo?.available) return combo;
  const state = await getTopupState();
  const cardMap = new Map(state.cards.map((c) => [c.usdValue, c]));
  const links = combo.items.map((item) => {
    const card = cardMap.get(item.usdValue);
    return {
      usdValue: item.usdValue,
      count: item.count,
      optionId: card?.optionId || null,
      priceRub: item.priceRub,
      subtotalRub: item.subtotalRub,
      subtotalRubFormatted: item.subtotalRubFormatted,
      paymentUrl: buildCardPayUrl(card, {
        quantity: item.count,
        purchaseEmail,
        optionCategoryId: state.optionCategoryId,
      }),
    };
  });
  return {
    ...combo,
    optionCategoryId: state.optionCategoryId,
    links,
  };
}

async function computeCombo(priceUsd) {
  const price = Math.max(0, Number(priceUsd) || 0);
  if (price <= 0) return { available: false, reason: 'price_invalid' };

  const cards = await listCards();
  const enabledCards = cards.filter((c) => c.enabled);
  const availableCards = enabledCards.filter((c) => c.inStock);
  const cardMap = new Map(enabledCards.map((c) => [c.usdValue, c]));

  if (availableCards.length === 0) {
    return { available: false, reason: 'no_cards_in_stock', price };
  }

  const availableSet = new Set(availableCards.map((c) => c.usdValue));
  let combo = bracketFor(price);

  const needsSubstitute = combo.some((v) => !availableSet.has(v));
  if (needsSubstitute) {
    combo = substituteForUnavailable(combo, availableSet);
    if (!combo) return { available: false, reason: 'cannot_cover_price', price };
  }

  const sum = summarizeCombo(combo, cardMap);
  return {
    available: true,
    price,
    ...sum,
    substituted: needsSubstitute,
  };
}

module.exports = {
  listCards,
  getTopupState,
  updateCard,
  refreshCards,
  computeCombo,
  buildComboPurchase,
  buildCardPayUrl,
  bracketFor,
  parseTopupHtml,
  ALLOWED_DENOMINATIONS,
};

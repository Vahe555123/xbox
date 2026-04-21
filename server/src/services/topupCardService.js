const axios = require('axios');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const CARDS_CACHE_KEY = 'topup:cards';
const CARDS_CACHE_TTL_SECONDS = 60;
const ALLOWED_DENOMINATIONS = [5, 10, 25, 50];
const OPLATA_BASE_URL = 'https://www.oplata.info';
const PRICE_OPTIONS_URL = `${OPLATA_BASE_URL}/asp2/price_options.asp`;
const TOPUP_TYPE_CURRENCY = 'API_17432_RUB';

const BROWSER_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const POST_PAYMENT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: OPLATA_BASE_URL,
  Referer: `${OPLATA_BASE_URL}/`,
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': BROWSER_HEADERS['User-Agent'],
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
  const optionCategoryId = config.digiseller.topupCardOptionCategoryId
    || lastRun?.option_category_id
    || null;
  return {
    productId: config.digiseller.topupCardProductId,
    optionCategoryId,
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
  const radios = [];
  let m;
  while ((m = radioRegex.exec(html)) !== null) {
    radios.push({ tag: m[0], start: m.index, end: radioRegex.lastIndex });
  }

  const options = [];
  let categoryId = null;

  for (let i = 0; i < radios.length; i += 1) {
    const { tag, end } = radios[i];
    const nameMatch = tag.match(/name=["']?Option_radio_(\d+)["']?/i);
    if (!nameMatch) continue;
    const catId = nameMatch[1];
    if (!categoryId) categoryId = catId;

    const valueMatch = tag.match(/value=["']?(\d+)["']?/i);
    if (!valueMatch) continue;
    const optionId = valueMatch[1];

    // Label for this radio is strictly between this tag and the next radio (bounded).
    const nextStart = i + 1 < radios.length ? radios[i + 1].start : html.length;
    const contextEnd = Math.min(nextStart, end + 600);
    const plainContext = stripTags(html.slice(end, contextEnd));

    // "5 USD", "10 USD" etc — word-boundary protects against substring matches.
    const usdMatch = plainContext.match(/\b(\d{1,3})\s*USD\b/i)
      || plainContext.match(/\$\s*(\d{1,3})\b/);
    if (!usdMatch) continue;
    const usd = parseInt(usdMatch[1], 10);
    if (!ALLOWED_DENOMINATIONS.includes(usd)) continue;

    const priceMatch = plainContext.match(/\+\s*([\d\s.,]+)\s*(?:RUB|руб|₽)/i)
      || plainContext.match(/\(\s*([\d\s.,]+)\s*(?:RUB|руб|₽)\s*\)/i);
    let priceRub = null;
    if (priceMatch) {
      const cleaned = priceMatch[1].replace(/[\s.]/g, '').replace(',', '.');
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) priceRub = Math.round(parsed);
    }

    const outOfStock = /нет\s+в\s+налич|out\s+of\s+stock|недоступ/i.test(plainContext)
      || /disabled/i.test(tag);

    const label = plainContext.slice(0, 120).trim() || `$${usd}`;

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
    // Prefer the entry that actually has a price; otherwise keep the first seen.
    if (!existing) deduped.set(opt.usdValue, opt);
    else if (opt.priceRub && !existing.priceRub) deduped.set(opt.usdValue, opt);
  }
  return { categoryId, options: [...deduped.values()].sort((a, b) => a.usdValue - b.usdValue) };
}

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(',', '.').replace(/\s+/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePriceOptionsResponse(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

async function fetchTopupOptionPriceRub(option) {
  if (!option?.categoryId || !option?.optionId) return null;
  const optionXml = `<response><option O="${option.categoryId}" V="${option.optionId}"/></response>`;
  try {
    const { data } = await axios.get(PRICE_OPTIONS_URL, {
      params: {
        p: config.digiseller.topupCardProductId,
        n: 1,
        c: 'RUB',
        x: optionXml,
        rnd: Math.random(),
      },
      headers: { Accept: 'application/json, text/plain, */*' },
      timeout: 8000,
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    const parsed = parsePriceOptionsResponse(data);
    if (!parsed || (parsed.err !== '0' && parsed.err !== 0 && parsed.err)) return null;
    const value = parseMoney(parsed.amount) || parseMoney(parsed.price);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  } catch (err) {
    logger.warn('Topup option price fetch failed', {
      usd: option.usdValue,
      optionId: option.optionId,
      message: err.message,
    });
    return null;
  }
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

    const pricedOptions = await Promise.all(options.map(async (opt) => {
      const priceRub = await fetchTopupOptionPriceRub(opt);
      return {
        ...opt,
        priceRub: priceRub ?? opt.priceRub,
      };
    }));

    let updatedCount = 0;
    for (const opt of pricedOptions) {
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
    const seenValues = pricedOptions.map((o) => o.usdValue);
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

function parseJsonOrXmlPayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'object') return payload;
  const text = String(payload).trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const readTag = (name) => {
      const match = text.match(new RegExp(`<${name}>\\s*([^<]*)\\s*<\\/${name}>`, 'i'));
      return match ? match[1] : null;
    };
    return {
      retval: readTag('retval'),
      retdesc: readTag('retdesc'),
      id_po: readTag('id_po'),
      cart_err_num: readTag('cart_err_num'),
      cart_err: readTag('cart_err'),
      cart_uid: readTag('cart_uid'),
      cart_cnt: readTag('cart_cnt'),
    };
  }
}

function normalizeIp(value) {
  const ip = String(value || '').split(',')[0].trim();
  if (!ip) return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

function getCartAddCurrency() {
  const currency = String(config.digiseller.cartCurrency || TOPUP_TYPE_CURRENCY).toUpperCase();
  if (currency.includes('_RUB') || currency === 'RUR') return 'RUB';
  if (currency.includes('_USD')) return 'USD';
  if (currency.includes('_EUR')) return 'EUR';
  return currency || 'RUB';
}

async function getPurchaseOptionsId({
  card,
  quantity = 1,
  optionCategoryId,
  buyerIp,
}) {
  const productId = config.digiseller.topupCardProductId;
  if (!productId || !card?.optionId || !optionCategoryId) return null;

  try {
    const response = await axios.post('https://api.digiseller.com/api/purchases/options', {
      product_id: productId,
      options: [
        {
          id: Number(optionCategoryId),
          value: { id: Number(card.optionId) },
        },
      ],
      unit_cnt: Math.max(1, Number(quantity) || 1),
      lang: 'ru-RU',
      ip: normalizeIp(buyerIp),
    }, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    const payload = parseJsonOrXmlPayload(response.data);
    const retval = String(payload.retval ?? '');
    if (retval !== '0' || !payload.id_po) {
      logger.warn('Digiseller purchase options returned error', {
        usd: card.usdValue,
        optionId: card.optionId,
        retval: payload.retval ?? null,
        retdesc: payload.retdesc || null,
      });
      return null;
    }
    return String(payload.id_po);
  } catch (err) {
    logger.error('Digiseller purchase options failed', {
      usd: card.usdValue,
      optionId: card.optionId,
      message: err.message,
    });
    return null;
  }
}

function buildCartPayUrl(cartUid, { purchaseEmail } = {}) {
  const sellerId = config.digiseller.sellerId;
  if (!cartUid || !sellerId) return null;
  const url = new URL(config.digiseller.payApiBaseUrl || `${OPLATA_BASE_URL}/asp2/pay_api.asp`);
  url.searchParams.set('id_d', '0');
  url.searchParams.set('id_po', '0');
  url.searchParams.set('cart_uid', cartUid);
  url.searchParams.set('ai', String(sellerId));
  url.searchParams.set('ain', '');
  url.searchParams.set('curr', config.digiseller.cartPaymentCurrency || 'API_5020_RUB');
  url.searchParams.set('lang', 'ru-RU');
  url.searchParams.set('digiuid', randomUUID().toUpperCase());
  url.searchParams.set('failpage', getFailPageForTopup());
  url.searchParams.set('_ow', '0');
  url.searchParams.set('_ids_shop', String(sellerId));
  url.searchParams.set('item_cnt', '');
  url.searchParams.set('promocode', '');
  if (purchaseEmail) url.searchParams.set('email', purchaseEmail);
  return url.toString();
}

async function addItemToCart(cartUid, {
  card,
  quantity = 1,
  optionCategoryId,
  purchaseEmail,
  buyerIp,
}) {
  const productId = config.digiseller.topupCardProductId;
  if (!productId || !card?.optionId || !optionCategoryId) {
    return { ok: false, reason: 'missing_params' };
  }

  const idPo = await getPurchaseOptionsId({
    card,
    quantity,
    optionCategoryId,
    buyerIp,
  });
  if (!idPo) return { ok: false, reason: 'id_po_missing' };

  const typeCurr = getCartAddCurrency();
  const base = (config.digiseller.cartBaseUrl || 'https://shop.digiseller.ru').replace(/\/$/, '');
  const url = `${base}/xml/shop_cart_add.asp`;

  const body = new URLSearchParams({
    product_id: String(productId),
    product_cnt: String(Math.max(1, Number(quantity) || 1)),
    typecurr: typeCurr,
    email: purchaseEmail || '',
    lang: 'ru-RU',
    cart_uid: cartUid || '',
    id_po: idPo,
  });

  try {
    const response = await axios.post(url, body.toString(), {
      headers: {
        ...POST_PAYMENT_HEADERS,
        Accept: 'application/json, text/plain, */*',
      },
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const payload = parseJsonOrXmlPayload(response.data);
    const cartErr = String(payload.cart_err_num ?? payload.cart_err ?? payload.retval ?? '');
    if ((cartErr !== '0' && cartErr !== '') || !payload.cart_uid) {
      logger.warn('Digiseller cart add returned non-zero', {
        cartUid,
        usd: card.usdValue,
        cartErr,
        retdesc: payload.retdesc || null,
      });
      return { ok: false, cartErr, retdesc: payload.retdesc || null };
    }
    return { ok: true, cartUid: payload.cart_uid, cart: payload };
  } catch (err) {
    logger.error('Digiseller cart add failed', {
      cartUid,
      usd: card.usdValue,
      message: err.message,
    });
    return { ok: false, reason: err.message };
  }
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

function absoluteOplataUrl(location) {
  if (!location) return null;
  if (/^https?:\/\//i.test(location)) return location;
  if (location.startsWith('/')) return `${OPLATA_BASE_URL}${location}`;
  return `${OPLATA_BASE_URL}/asp2/${location}`;
}

function getFailPageForTopup() {
  const productId = config.digiseller.topupCardProductId;
  if (config.digiseller.failPageUrl) return config.digiseller.failPageUrl;
  if (productId && config.clientOrigin) {
    return `${config.clientOrigin.replace(/\/$/, '')}/game/${encodeURIComponent(productId)}`;
  }
  return config.clientOrigin || '';
}

// Submit the chosen option to pay.asp and capture the final pay_api.asp redirect.
async function createCardPayApiUrl(card, { quantity = 1, purchaseEmail, optionCategoryId } = {}) {
  const productId = config.digiseller.topupCardProductId;
  const sellerId = config.digiseller.sellerId;
  const catId = optionCategoryId || config.digiseller.topupCardOptionCategoryId || null;
  if (!productId || !sellerId || !card?.optionId || !catId) return null;

  const digiuid = randomUUID().toUpperCase();
  const unitAmount = Number(card.priceRub) > 0 ? Math.round(Number(card.priceRub) * quantity) : '';
  const body = new URLSearchParams({
    Lang: 'ru-RU',
    ID_D: String(productId),
    product_id: String(productId),
    Agent: String(sellerId),
    AgentN: '',
    FailPage: getFailPageForTopup(),
    failpage: getFailPageForTopup(),
    NoClearBuyerQueryString: 'NoClear',
    digiuid,
    Curr_add: '',
    TypeCurr: TOPUP_TYPE_CURRENCY,
    _subcurr: '',
    _ow: '0',
    firstrun: '0',
    unit_cnt: String(quantity),
    unit_amount: unitAmount === '' ? '' : String(unitAmount),
    product_cnt: String(quantity),
    [`Option_radio_${catId}`]: String(card.optionId),
  });
  if (purchaseEmail) body.set('Email', purchaseEmail);

  try {
    const response = await axios.post(config.digiseller.payPostUrl, body.toString(), {
      headers: POST_PAYMENT_HEADERS,
      timeout: 12000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const location = response.headers.location;
    const url = absoluteOplataUrl(location);
    if (!url) return null;
    // Accept only the final pay_api.asp; options/wm pages mean we didn't reach the final page.
    if (!/pay_api\.asp/i.test(url)) {
      logger.warn('Topup payment returned non-final redirect', {
        usd: card.usdValue,
        optionId: card.optionId,
        location,
      });
      return null;
    }
    if (purchaseEmail) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.set('email', purchaseEmail);
        return parsed.toString();
      } catch {
        return url;
      }
    }
    return url;
  } catch (err) {
    logger.error('Topup payment POST failed', {
      usd: card.usdValue,
      optionId: card.optionId,
      message: err.message,
    });
    return null;
  }
}

async function buildComboPurchase(priceUsd, { purchaseEmail, buyerIp } = {}) {
  const combo = await computeCombo(priceUsd);
  if (!combo?.available) return combo;
  const state = await getTopupState();
  const cardMap = new Map(state.cards.map((c) => [c.usdValue, c]));

  const links = combo.items.map((item) => {
    const card = cardMap.get(item.usdValue);
    const fallbackUrl = buildCardPayUrl(card, {
      quantity: item.count,
      purchaseEmail,
      optionCategoryId: state.optionCategoryId,
    });
    return {
      usdValue: item.usdValue,
      count: item.count,
      optionId: card?.optionId || null,
      priceRub: item.priceRub,
      subtotalRub: item.subtotalRub,
      subtotalRubFormatted: item.subtotalRubFormatted,
      directUrl: fallbackUrl,
    };
  });

  let cartUid = null;
  let cartPaymentUrl = null;
  let cartError = null;

  if (state.optionCategoryId) {
    const addResults = [];
    for (const item of combo.items) {
      const card = cardMap.get(item.usdValue);
      for (let i = 0; i < item.count; i += 1) {
        const result = await addItemToCart(cartUid || '', {
          card,
          quantity: 1,
          optionCategoryId: state.optionCategoryId,
          purchaseEmail,
          buyerIp,
        });
        addResults.push(result);
        if (!result.ok) break;
        cartUid = result.cartUid;
      }
      if (addResults.some((r) => !r.ok)) break;
    }
    const failures = addResults.filter((r) => !r.ok);
    if (failures.length === 0 && cartUid) {
      cartPaymentUrl = buildCartPayUrl(cartUid, { purchaseEmail });
    } else {
      cartError = failures[0]?.retdesc || failures[0]?.reason || 'cart_add_failed';
      logger.warn('Cart build failed, falling back to per-card links', {
        cartUid,
        failures: failures.length,
        total: combo.items.length,
      });
      cartUid = null;
    }
  } else {
    cartError = 'option_category_id_missing';
  }

  let primaryPaymentUrl = cartPaymentUrl;
  if (!primaryPaymentUrl) {
    const perCardApi = await Promise.all(combo.items.map(async (item) => {
      const card = cardMap.get(item.usdValue);
      const apiUrl = await createCardPayApiUrl(card, {
        quantity: item.count,
        purchaseEmail,
        optionCategoryId: state.optionCategoryId,
      });
      return { usdValue: item.usdValue, apiUrl };
    }));
    const byUsd = new Map(perCardApi.map((r) => [r.usdValue, r.apiUrl]));
    links.forEach((link) => {
      const apiUrl = byUsd.get(link.usdValue);
      link.paymentUrl = apiUrl || link.directUrl;
      link.usedPayApi = Boolean(apiUrl);
    });
    primaryPaymentUrl = links[0]?.paymentUrl || null;
  } else {
    links.forEach((link) => {
      link.paymentUrl = cartPaymentUrl;
      link.usedPayApi = true;
    });
  }

  return {
    ...combo,
    optionCategoryId: state.optionCategoryId,
    cartUid,
    cartError,
    paymentUrl: primaryPaymentUrl,
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
  const proportionalInfo = computeProportionalPrice({
    totalRub: sum.totalRub,
    totalUsd: sum.totalUsd,
    priceUsd: price,
  });
  return {
    available: true,
    price,
    ...sum,
    ...proportionalInfo,
    substituted: needsSubstitute,
  };
}

function computeProportionalPrice({ totalRub, totalUsd, priceUsd }) {
  const totalRubNum = Number(totalRub);
  const totalUsdNum = Number(totalUsd);
  const priceUsdNum = Number(priceUsd);
  const hasTotals = Number.isFinite(totalRubNum) && Number.isFinite(totalUsdNum) && totalUsdNum > 0;
  const hasPrice = Number.isFinite(priceUsdNum) && priceUsdNum > 0;

  const proportionalRubRaw = hasTotals && hasPrice
    ? (totalRubNum / totalUsdNum) * priceUsdNum
    : null;
  const proportionalRub = Number.isFinite(proportionalRubRaw)
    ? Math.round(proportionalRubRaw)
    : null;

  const leftoverUsdRaw = hasPrice && Number.isFinite(totalUsdNum)
    ? totalUsdNum - priceUsdNum
    : null;
  const leftoverUsd = Number.isFinite(leftoverUsdRaw)
    ? Math.round(leftoverUsdRaw * 100) / 100
    : null;

  return {
    proportionalRub,
    proportionalRubFormatted: proportionalRub != null ? formatRub(proportionalRub) : null,
    leftoverUsd,
    leftoverUsdFormatted: leftoverUsd != null ? formatLeftoverUsd(leftoverUsd) : null,
  };
}

function formatLeftoverUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return (Math.round(num * 100) / 100).toFixed(2);
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

const axios = require('axios');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const PRICE_API_URL = 'https://www.oplata.info/asp2/price_options.asp';
const OPLATA_BASE_URL = 'https://www.oplata.info';
const PRICE_CACHE_TTL_SECONDS = 15 * 60;
const RATE_CACHE_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_UNIT_COUNT = 300;
const XBOX_GAME_NAME_OPTION = '4931969';
const XBOX_ACCOUNT_EMAIL_OPTION = '4931970';
const XBOX_ACCOUNT_PASSWORD_OPTION = '4931971';
const DEFAULT_PRICE_OPTION_XML = '<response></response>';
const RATE_MODE_OPLATA = 'oplata';
const RATE_MODE_KEY_ACTIVATION = 'key_activation';
const BROWSER_PAYMENT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ru,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://www.oplata.info',
  Pragma: 'no-cache',
  Referer: 'https://www.oplata.info/',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function getKeyActivationOptionXml() {
  return `<response><option O="${config.digiseller.keyActivationOptionCategoryId}" V="${config.digiseller.keyActivationOptionValueId}"/></response>`;
}

function getRateMode(mode = RATE_MODE_OPLATA) {
  const safeMode = mode || RATE_MODE_OPLATA;
  if (safeMode === RATE_MODE_OPLATA) {
    return {
      id: RATE_MODE_OPLATA,
      title: 'Xbox USD',
      digisellerId: config.digiseller.defaultProductId,
      optionXml: DEFAULT_PRICE_OPTION_XML,
      typeCurrency: config.digiseller.typeCurrency,
    };
  }
  if (safeMode === RATE_MODE_KEY_ACTIVATION) {
    return {
      id: RATE_MODE_KEY_ACTIVATION,
      title: 'Ключ активации',
      digisellerId: config.digiseller.keyActivationProductId,
      optionXml: getKeyActivationOptionXml(),
      optionCategoryId: config.digiseller.keyActivationOptionCategoryId,
      optionValueId: config.digiseller.keyActivationOptionValueId,
      gameNameOptionId: config.digiseller.keyActivationGameNameOptionId,
      typeCurrency: config.digiseller.keyActivationTypeCurrency,
      failPageUrl: config.digiseller.keyActivationFailPageUrl,
    };
  }
  throw createPaymentError('Неизвестный режим Digiseller', 400);
}

function getOptionCacheKey(optionXml) {
  return Buffer.from(String(optionXml || DEFAULT_PRICE_OPTION_XML))
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');
}

function normalizeProductKey(productId) {
  return String(productId || '').trim().toLowerCase();
}

function getProductKey(product) {
  return product?.id || product?.productId || product?.product_id || null;
}

function buildPayUrl(digisellerId, { unitCount, buyerEmail } = {}) {
  const sellerId = config.digiseller.sellerId;
  if (!digisellerId) return null;
  const url = new URL(config.digiseller.payBaseUrl);
  url.searchParams.set('id_d', digisellerId);
  if (sellerId) url.searchParams.set('ai', sellerId);
  url.searchParams.set('_ow', '0');
  if (unitCount) {
    const count = normalizeUnitCount(unitCount);
    url.searchParams.set('n', String(count));
    url.searchParams.set('product_cnt', String(count));
  }
  if (buyerEmail) url.searchParams.set('email', buyerEmail);
  return url.toString();
}

const GAME_CURRENCY_PRODUCT_KINDS = new Set([
  'Consumable',
  'UnmanagedConsumable',
]);

const GAME_CURRENCY_CATEGORY_PATTERNS = [
  /\bvirtual\s+currency\b/i,
  /\bin[-\s]?game\s+currency\b/i,
  /\bcurrency\b/i,
  /\bcoins?\b/i,
  /\bcredits?\b/i,
];

function isGameCurrencyProduct(product) {
  if (!product) return false;
  const kind = product.productKind || product.ProductKind;
  if (kind && GAME_CURRENCY_PRODUCT_KINDS.has(kind)) return true;
  const haystacks = [
    product.category,
    product.subcategory,
    ...(Array.isArray(product.categories) ? product.categories : []),
  ].filter(Boolean);
  for (const value of haystacks) {
    const str = String(value);
    if (GAME_CURRENCY_CATEGORY_PATTERNS.some((re) => re.test(str))) return true;
  }
  return false;
}

function buildKeyActivationPayUrl(product, { purchaseEmail, gameName } = {}) {
  const id = config.digiseller.keyActivationProductId;
  const sellerId = config.digiseller.sellerId;
  if (!id || !sellerId) return null;
  if (isGameCurrencyProduct(product)) return null;
  const url = new URL(config.digiseller.payBaseUrl);
  url.searchParams.set('id_d', String(id));
  url.searchParams.set('ai', String(sellerId));
  url.searchParams.set('_ow', '0');
  url.searchParams.set('Lang', 'ru-RU');
  const cleanEmail = purchaseEmail ? normalizePaymentText(purchaseEmail) : '';
  if (cleanEmail) url.searchParams.set('email', cleanEmail);
  const cleanGameName = gameName
    ? normalizePaymentText(gameName)
    : product?.title
      ? normalizePaymentText(product.title)
      : '';
  if (cleanGameName) url.searchParams.set('game_name', cleanGameName);
  return url.toString();
}

async function createKeyActivationPayment(product, { purchaseEmail, gameName } = {}) {
  if (!product) throw createPaymentError('Product is required');
  if (isGameCurrencyProduct(product)) {
    throw createPaymentError('Ключ активации недоступен для игровой валюты', 400);
  }
  const cleanEmail = normalizePaymentText(purchaseEmail);
  if (!cleanEmail) throw createPaymentError('Email для покупки обязателен');
  const cleanGameName = normalizePaymentText(gameName || product.title || product.name);
  if (!cleanGameName) throw createPaymentError('Название игры обязательно');

  const rateMode = getRateMode(RATE_MODE_KEY_ACTIVATION);
  const digisellerId = rateMode.digisellerId;
  if (!digisellerId) throw createPaymentError('Digiseller product id is not configured', 500);

  const unitCount = getUsdPriceValue(product);
  if (!unitCount || !shouldFetchRubPrice(product)) {
    throw createPaymentError('Для этого товара нельзя создать ссылку оплаты', 400);
  }

  const rubQuote = await fetchRubPrice(digisellerId, unitCount, {
    cacheResult: true,
    optionXml: rateMode.optionXml,
  });
  const amountRub = Math.round(Number(rubQuote?.amount || rubQuote?.value || 0));
  if (!amountRub || !Number.isFinite(amountRub)) {
    throw createPaymentError('Не удалось получить цену в рублях для ключа активации', 502);
  }

  const digiuid = randomUUID().toUpperCase();
  const failPage = rateMode.failPageUrl || `https://plati.market/itm/?idd=${digisellerId}`;
  const body = new URLSearchParams({
    Lang: 'ru-RU',
    ID_D: String(digisellerId),
    product_id: String(digisellerId),
    Agent: config.digiseller.sellerId || '',
    AgentN: '',
    FailPage: failPage,
    failpage: failPage,
    NoClearBuyerQueryString: 'NoClear',
    digiuid,
    Curr_add: '',
    TypeCurr: rateMode.typeCurrency || config.digiseller.typeCurrency,
    _subcurr: '',
    _ow: '0',
    firstrun: '0',
    unit_cnt: String(unitCount),
    unit_amount: String(amountRub),
    product_cnt: String(unitCount),
    Email: cleanEmail,
    [`Option_radio_${rateMode.optionCategoryId}`]: String(rateMode.optionValueId),
    [`Option_text_${rateMode.gameNameOptionId}`]: cleanGameName,
  });

  try {
    const response = await axios.post(config.digiseller.payPostUrl, body.toString(), {
      headers: BROWSER_PAYMENT_HEADERS,
      timeout: 12000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const paymentUrl = appendPaymentQuery(buildFullPaymentUrl(response.headers.location), {
      email: cleanEmail,
    });
    if (!paymentUrl || !/pay_api\.asp/i.test(paymentUrl)) {
      logger.warn('Digiseller key activation returned non-final redirect', {
        digisellerId,
        status: response.status,
        location: response.headers.location,
      });
      throw createPaymentError('Digiseller не вернул финальную ссылку оплаты', 502);
    }

    return {
      paymentUrl,
      directUrl: buildKeyActivationPayUrl(product, {
        purchaseEmail: cleanEmail,
        gameName: cleanGameName,
      }),
      provider: 'oplata',
      paymentMode: RATE_MODE_KEY_ACTIVATION,
      paymentType: 'activation_key',
      digisellerId,
      unitCount,
      amountRub,
      amountRubFormatted: formatRub(amountRub),
      currency: 'RUB',
      gameName: cleanGameName,
      purchaseEmail: cleanEmail,
      optionCategoryId: rateMode.optionCategoryId,
      optionValueId: rateMode.optionValueId,
    };
  } catch (err) {
    if (err.statusCode) throw err;
    logger.error('Digiseller key activation payment creation failed', {
      digisellerId,
      unitCount,
      amountRub,
      message: err.message,
    });
    throw createPaymentError('Не удалось подготовить ссылку на оплату ключа активации', 502);
  }
}

function buildFullPaymentUrl(redirectUrl) {
  if (!redirectUrl) return null;
  if (/^https?:\/\//i.test(redirectUrl)) return redirectUrl;
  if (redirectUrl.startsWith('/')) return `${OPLATA_BASE_URL}${redirectUrl}`;
  return `${OPLATA_BASE_URL}/asp2/${redirectUrl}`;
}

function getFailPageUrl(product) {
  if (config.digiseller.failPageUrl) return config.digiseller.failPageUrl;
  const productId = getProductKey(product);
  if (productId && config.clientOrigin) {
    return `${config.clientOrigin.replace(/\/$/, '')}/game/${encodeURIComponent(productId)}`;
  }
  return config.clientOrigin || '';
}

function normalizePaymentText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function createPaymentError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizePaymentMode(mode) {
  if (!mode || mode === 'oplata') return 'oplata';
  throw createPaymentError('Этот способ оплаты пока недоступен', 400);
}

function appendPaymentQuery(url, values = {}) {
  if (!url) return url;
  const target = new URL(url);
  if (values.email) target.searchParams.set('email', values.email);
  return target.toString();
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

function parseMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(',', '.').replace(/\s+/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePriceResponse(raw) {
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

function normalizeUnitCount(value) {
  const numeric = parseMoney(value);
  if (!numeric || numeric <= 0) return 1;
  return Math.max(1, Math.round(numeric * 100) / 100);
}

async function fetchRubPrice(digisellerId, unitCount = 1, {
  cacheResult = true,
  optionXml = DEFAULT_PRICE_OPTION_XML,
} = {}) {
  const safeUnitCount = normalizeUnitCount(unitCount);
  if (!digisellerId) return null;
  const cacheKey = `digiseller:price:rub:${digisellerId}:${safeUnitCount.toFixed(2)}:${getOptionCacheKey(optionXml)}`;
  if (cacheResult) {
    const cached = cache.get(cacheKey);
    if (cached !== null && cached !== undefined) return cached;
  }

  try {
    const { data } = await axios.get(PRICE_API_URL, {
      params: {
        p: digisellerId,
        n: safeUnitCount,
        c: 'RUB',
        x: optionXml || DEFAULT_PRICE_OPTION_XML,
        rnd: Math.random(),
      },
      timeout: 8000,
      headers: { Accept: 'application/json, text/plain, */*' },
    });

    const parsed = parsePriceResponse(data);
    if (!parsed || (parsed.err !== '0' && parsed.err !== 0 && parsed.err)) {
      if (cacheResult) cache.set(cacheKey, null, PRICE_CACHE_TTL_SECONDS);
      return null;
    }

    const baseUnitPrice = parseMoney(parsed.price);
    const count = parseMoney(parsed.cnt) || safeUnitCount;
    const amount = parseMoney(parsed.amount);
    const value = amount || (baseUnitPrice && count ? baseUnitPrice * count : null);
    if (!Number.isFinite(value) || value <= 0) {
      if (cacheResult) cache.set(cacheKey, null, PRICE_CACHE_TTL_SECONDS);
      return null;
    }

    const result = {
      value,
      currency: parsed.curr || 'RUB',
      formatted: formatRub(value),
      requestedCount: safeUnitCount,
      count,
      amount,
      unitPrice: baseUnitPrice,
      effectiveRate: count > 0 ? value / count : null,
      targetCurrency: parsed.tcurr || parsed.curr || 'RUB',
      commission: parseMoney(parsed.commiss) || 0,
      saleBasePrice: parseMoney(parsed.saleBasePrice) || 0,
      salePercent: parsed.salePercent || null,
      source: 'digiseller-price-options',
      raw: parsed,
    };
    if (cacheResult) cache.set(cacheKey, result, PRICE_CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    logger.warn('Digiseller price fetch failed', {
      digisellerId,
      unitCount: safeUnitCount,
      optionXml,
      message: err.message,
    });
    return null;
  }
}

async function getMapping(productId) {
  const { rows } = await pool.query(
    `SELECT product_id, digiseller_id, note, created_at, updated_at
     FROM digiseller_products
     WHERE LOWER(product_id) = LOWER($1)
     LIMIT 1`,
    [String(productId || '').trim()],
  );
  return rows[0] || null;
}

async function getMappingsByProductIds(productIds) {
  const ids = [...new Set((productIds || []).map(normalizeProductKey).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT product_id, digiseller_id
     FROM digiseller_products
     WHERE LOWER(product_id) = ANY($1::text[])`,
    [ids],
  );
  const map = new Map();
  for (const row of rows) map.set(normalizeProductKey(row.product_id), row);
  return map;
}

function getUsdPriceValue(product) {
  const candidates = [
    product?.price?.value,
    product?.price?.listPrice,
    product?.price?.msrp,
  ];
  for (const candidate of candidates) {
    const value = parseMoney(candidate);
    if (value && value > 0) return Math.round(value * 100) / 100;
  }
  return null;
}

function shouldFetchRubPrice(product) {
  if (!product) return false;
  if (product.price?.value === 0 || product.price?.isFree) return false;
  const releaseStatus = product.releaseInfo?.status || product.price?.status;
  if (releaseStatus === 'unreleased') return false;
  return Boolean(getUsdPriceValue(product));
}

async function getLatestRateSamples(digisellerId, mode = RATE_MODE_OPLATA) {
  if (!digisellerId) return [];
  const rateMode = getRateMode(mode);
  const cacheKey = `digiseller:rates:${rateMode.id}:${digisellerId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { rows } = await pool.query(
    `SELECT s.*
     FROM digiseller_price_rate_samples s
     JOIN digiseller_price_rate_runs r ON r.id = s.run_id
     WHERE s.digiseller_id = $1 AND s.mode = $2 AND r.status = 'success'
       AND r.id = (
         SELECT id
         FROM digiseller_price_rate_runs
         WHERE digiseller_id = $1 AND mode = $2 AND status = 'success'
         ORDER BY finished_at DESC NULLS LAST, id DESC
         LIMIT 1
       )
     ORDER BY s.requested_usd ASC`,
    [digisellerId, rateMode.id],
  );
  cache.set(cacheKey, rows, RATE_CACHE_TTL_SECONDS);
  return rows;
}

function estimateRubFromSamples(samples, usdValue) {
  if (!Array.isArray(samples) || samples.length === 0 || !usdValue) return null;
  const sorted = [...samples].sort((a, b) => Number(a.requested_usd) - Number(b.requested_usd));
  let sample = sorted[0];
  for (const item of sorted) {
    if (Number(item.requested_usd) <= usdValue) sample = item;
    else break;
  }
  const rate = Number(sample.effective_rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const value = Math.ceil(usdValue * rate);
  return {
    value,
    currency: 'RUB',
    formatted: formatRub(value),
    requestedCount: usdValue,
    count: usdValue,
    amount: value,
    effectiveRate: rate,
    rateSampleId: sample.id,
    rateSampleTargetRub: Number(sample.target_rub),
    rateSampleRequestedUsd: Number(sample.requested_usd),
    rateSampleAmountRub: Number(sample.amount_rub),
    source: 'digiseller-rate-table',
  };
}

async function getRubPriceForProduct(product, digisellerId, mode = RATE_MODE_OPLATA) {
  const usdValue = getUsdPriceValue(product);
  if (!usdValue || !digisellerId || !shouldFetchRubPrice(product)) return null;
  const rateMode = getRateMode(mode);
  const samples = await getLatestRateSamples(digisellerId, rateMode.id).catch(() => []);
  const estimated = estimateRubFromSamples(samples, usdValue);
  if (estimated) return estimated;
  return fetchRubPrice(digisellerId, usdValue, { optionXml: rateMode.optionXml });
}

async function getKeyActivationRubPriceForProduct(product) {
  if (!config.digiseller.keyActivationProductId || isGameCurrencyProduct(product)) return null;
  return getRubPriceForProduct(
    product,
    config.digiseller.keyActivationProductId,
    RATE_MODE_KEY_ACTIVATION,
  );
}

async function createPurchasePaymentUrl(product, {
  digisellerId = product?.digisellerId || config.digiseller.defaultProductId,
  gameName,
  accountEmail,
  accountPassword,
  purchaseEmail,
  paymentMode = 'oplata',
} = {}) {
  if (!product) throw createPaymentError('Product is required');
  if (!digisellerId) throw createPaymentError('Digiseller product id is not configured', 500);

  const cleanGameName = normalizePaymentText(gameName || product.title || product.name);
  const cleanAccountEmail = normalizePaymentText(accountEmail);
  const cleanAccountPassword = String(accountPassword || '').trim();
  const cleanPurchaseEmail = normalizePaymentText(purchaseEmail);
  const cleanPaymentMode = normalizePaymentMode(paymentMode);
  if (!cleanGameName) throw createPaymentError('Название игры обязательно');
  if (!cleanAccountEmail || !cleanAccountPassword) {
    throw createPaymentError('Email и пароль Xbox аккаунта обязательны для создания ссылки оплаты');
  }
  if (!cleanPurchaseEmail) {
    throw createPaymentError('Email для покупки обязателен для создания ссылки оплаты');
  }

  const unitCount = getUsdPriceValue(product);
  if (!unitCount || !shouldFetchRubPrice(product)) {
    throw createPaymentError('Для этого товара нельзя создать ссылку оплаты');
  }

  const rubQuote = await fetchRubPrice(digisellerId, unitCount, { cacheResult: true });
  const amountRub = Math.round(Number(rubQuote?.amount || rubQuote?.value || product.priceRub?.amount || product.priceRub?.value || 0));
  if (!amountRub || !Number.isFinite(amountRub)) {
    throw createPaymentError('Не удалось получить цену в рублях для оплаты', 502);
  }

  const digiuid = randomUUID().toUpperCase();
  const failPage = getFailPageUrl(product);
  const body = new URLSearchParams({
    Lang: 'ru-RU',
    ID_D: String(digisellerId),
    product_id: String(digisellerId),
    Agent: config.digiseller.sellerId || '',
    AgentN: '',
    FailPage: failPage,
    failpage: failPage,
    NoClearBuyerQueryString: 'NoClear',
    digiuid,
    Curr_add: '',
    TypeCurr: config.digiseller.typeCurrency,
    _subcurr: '',
    _ow: '0',
    firstrun: '0',
    unit_cnt: String(unitCount),
    unit_amount: String(amountRub),
    product_cnt: String(unitCount),
    Email: cleanPurchaseEmail,
    [`Option_text_${XBOX_GAME_NAME_OPTION}`]: cleanGameName,
    [`Option_text_${XBOX_ACCOUNT_EMAIL_OPTION}`]: cleanAccountEmail,
    [`Option_text_${XBOX_ACCOUNT_PASSWORD_OPTION}`]: cleanAccountPassword,
  });

  try {
    const response = await axios.post(config.digiseller.payPostUrl, body.toString(), {
      headers: BROWSER_PAYMENT_HEADERS,
      timeout: 12000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const paymentUrl = appendPaymentQuery(buildFullPaymentUrl(response.headers.location), {
      email: cleanPurchaseEmail,
    });
    if (!paymentUrl || !/pay_api\.asp/i.test(paymentUrl)) {
      logger.warn('Digiseller payment returned non-final redirect', {
        digisellerId,
        status: response.status,
        location: response.headers.location,
      });
      throw createPaymentError('Digiseller не вернул финальную ссылку оплаты', 502);
    }

    return {
      paymentUrl,
      directUrl: buildPayUrl(digisellerId, { unitCount, buyerEmail: cleanPurchaseEmail }),
      provider: 'oplata',
      paymentMode: cleanPaymentMode,
      paymentType: 'account_purchase',
      digisellerId,
      unitCount,
      amountRub,
      amountRubFormatted: formatRub(amountRub),
      currency: 'RUB',
      gameName: cleanGameName,
      purchaseEmail: cleanPurchaseEmail,
    };
  } catch (err) {
    if (err.statusCode) throw err;
    logger.error('Digiseller payment creation failed', {
      digisellerId,
      unitCount,
      amountRub,
      message: err.message,
    });
    throw createPaymentError('Не удалось подготовить ссылку на оплату', 502);
  }
}

async function enrichProductWithRub(product, preferredDigisellerId = null) {
  if (!product || !shouldFetchRubPrice(product)) return product;
  const mapping = preferredDigisellerId ? null : await getMapping(getProductKey(product)).catch(() => null);
  const digisellerId = preferredDigisellerId || mapping?.digiseller_id || config.digiseller.defaultProductId || null;
  if (!digisellerId) return product;
  product.digisellerId = digisellerId;
  product.digisellerPayUrl = buildPayUrl(digisellerId);
  const rub = await getRubPriceForProduct(product, digisellerId);
  if (rub) product.priceRub = rub;
  return product;
}

async function enrichProductsWithRub(products) {
  if (!Array.isArray(products) || products.length === 0) return products;
  const mappings = await getMappingsByProductIds(products.map(getProductKey));
  const defaultDigisellerId = config.digiseller.defaultProductId || null;
  if (mappings.size === 0 && !defaultDigisellerId) return products;
  const rateSamplesByProduct = new Map();
  const exactRequests = new Map();

  const getRub = async (product, digisellerId) => {
    const usdValue = getUsdPriceValue(product);
    if (!usdValue) return null;
    if (!rateSamplesByProduct.has(digisellerId)) {
      rateSamplesByProduct.set(digisellerId, getLatestRateSamples(digisellerId).catch(() => []));
    }
    const samples = await rateSamplesByProduct.get(digisellerId);
    const estimated = estimateRubFromSamples(samples, usdValue);
    if (estimated) return estimated;

    const key = `${digisellerId}:${usdValue.toFixed(2)}`;
    if (!exactRequests.has(key)) exactRequests.set(key, fetchRubPrice(digisellerId, usdValue));
    return exactRequests.get(key);
  };

  await Promise.all(
    products.map(async (product) => {
      if (!shouldFetchRubPrice(product)) return;
      const productId = getProductKey(product);
      const mapping = mappings.get(normalizeProductKey(productId));
      const digisellerId = mapping?.digiseller_id || defaultDigisellerId;
      if (!digisellerId) return;
      product.digisellerId = digisellerId;
      product.digisellerPayUrl = buildPayUrl(digisellerId);
      const rub = await getRub(product, digisellerId);
      if (rub) product.priceRub = rub;
    }),
  );
  return products;
}

function buildPriceTargets() {
  const targets = [];
  const addRange = (start, end, step) => {
    for (let value = start; value <= end; value += step) targets.push(value);
  };
  addRange(100, 1000, 100);
  addRange(1200, 2000, 200);
  addRange(2300, 2900, 300);
  targets.push(3000);
  addRange(3500, 10000, 500);
  targets.push(15000);
  return [...new Set(targets)].sort((a, b) => a - b);
}

async function probeTargetRub(digisellerId, targetRub, rateMode = getRateMode(RATE_MODE_OPLATA)) {
  const maxUnitCount = config.digiseller.maxUnitCount || DEFAULT_MAX_UNIT_COUNT;
  let unitCount = Math.min(maxUnitCount, Math.max(1, targetRub / 100));
  let quote = null;

  for (let i = 0; i < 4; i += 1) {
    unitCount = Math.round(unitCount * 100) / 100;
    quote = await fetchRubPrice(digisellerId, unitCount, {
      cacheResult: false,
      optionXml: rateMode.optionXml,
    });
    if (!quote?.amount) break;
    const ratio = targetRub / quote.amount;
    const next = Math.min(maxUnitCount, Math.max(1, unitCount * ratio));
    if (Math.abs(next - unitCount) < 0.01) break;
    unitCount = next;
  }

  if (!quote) return null;
  return {
    targetRub,
    label: targetRub > 10000 ? '10000+' : String(targetRub),
    requestedUsd: quote.requestedCount,
    amountRub: quote.amount || quote.value,
    effectiveRate: quote.effectiveRate,
    unitPriceRub: quote.unitPrice,
    rawResponse: quote.raw,
  };
}

async function refreshPriceRateTable({
  mode = RATE_MODE_OPLATA,
  digisellerId,
} = {}) {
  const rateMode = getRateMode(mode);
  const resolvedDigisellerId = digisellerId || rateMode.digisellerId;
  if (!resolvedDigisellerId) throw new Error('Digiseller product id is required');
  const started = new Date();
  const run = await pool.query(
    `INSERT INTO digiseller_price_rate_runs (digiseller_id, mode, option_xml, status, started_at)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING id, digiseller_id, mode, option_xml, status, started_at`,
    [resolvedDigisellerId, rateMode.id, rateMode.optionXml, started],
  );
  const runId = run.rows[0].id;

  try {
    const targets = buildPriceTargets();
    const samples = [];
    for (const targetRub of targets) {
      const sample = await probeTargetRub(resolvedDigisellerId, targetRub, rateMode);
      if (sample?.amountRub && sample?.effectiveRate) samples.push(sample);
    }

    for (const sample of samples) {
      await pool.query(
        `INSERT INTO digiseller_price_rate_samples
          (run_id, digiseller_id, mode, option_xml, target_rub, label, requested_usd, amount_rub, effective_rate, unit_price_rub, raw_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
        [
          runId,
          resolvedDigisellerId,
          rateMode.id,
          rateMode.optionXml,
          sample.targetRub,
          sample.label,
          sample.requestedUsd,
          sample.amountRub,
          sample.effectiveRate,
          sample.unitPriceRub,
          JSON.stringify(sample.rawResponse || {}),
        ],
      );
    }

    const rates = samples.map((sample) => Number(sample.effectiveRate)).filter(Number.isFinite);
    const minRate = rates.length ? Math.min(...rates) : null;
    const maxRate = rates.length ? Math.max(...rates) : null;
    const avgRate = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
    const finished = new Date();
    const updated = await pool.query(
      `UPDATE digiseller_price_rate_runs
       SET status = 'success',
           finished_at = $2,
           samples_count = $3,
           min_rate = $4,
           max_rate = $5,
           avg_rate = $6
       WHERE id = $1
       RETURNING *`,
      [runId, finished, samples.length, minRate, maxRate, avgRate],
    );
    cache.delete(`digiseller:rates:${rateMode.id}:${resolvedDigisellerId}`);
    return { mode: rateMode.id, run: updated.rows[0], samples };
  } catch (err) {
    await pool.query(
      `UPDATE digiseller_price_rate_runs
       SET status = 'failed', finished_at = NOW(), error = $2
       WHERE id = $1`,
      [runId, err.message],
    );
    throw err;
  }
}

async function getPriceRateState({
  mode = RATE_MODE_OPLATA,
  digisellerId,
  limit = 40,
} = {}) {
  const rateMode = getRateMode(mode);
  const resolvedDigisellerId = digisellerId || rateMode.digisellerId;
  const runResult = await pool.query(
    `SELECT *
     FROM digiseller_price_rate_runs
     WHERE digiseller_id = $1 AND mode = $2
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [resolvedDigisellerId, rateMode.id],
  );
  const samplesResult = await pool.query(
    `SELECT s.*
     FROM digiseller_price_rate_samples s
     JOIN digiseller_price_rate_runs r ON r.id = s.run_id
     WHERE s.digiseller_id = $1 AND s.mode = $2 AND r.status = 'success'
       AND r.id = (
         SELECT id
         FROM digiseller_price_rate_runs
         WHERE digiseller_id = $1 AND mode = $2 AND status = 'success'
         ORDER BY finished_at DESC NULLS LAST, id DESC
         LIMIT 1
       )
     ORDER BY s.target_rub ASC
     LIMIT $3`,
    [resolvedDigisellerId, rateMode.id, limit],
  );
  return {
    mode: rateMode.id,
    title: rateMode.title,
    digisellerId: resolvedDigisellerId,
    optionCategoryId: rateMode.optionCategoryId || null,
    optionValueId: rateMode.optionValueId || null,
    lastRun: runResult.rows[0] || null,
    samples: samplesResult.rows,
  };
}

async function listMappings({ page = 1, limit = 50, search = '' } = {}) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const offset = (Math.max(1, page) - 1) * safeLimit;

  const params = [safeLimit, offset];
  let where = '';
  if (search) {
    params.push(`%${search}%`);
    where = `WHERE product_id ILIKE $3 OR CAST(digiseller_id AS TEXT) ILIKE $3 OR note ILIKE $3`;
  }

  const { rows } = await pool.query(
    `SELECT product_id, digiseller_id, note, created_at, updated_at
     FROM digiseller_products
     ${where}
     ORDER BY updated_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  const countParams = search ? [`%${search}%`] : [];
  const countQuery = search
    ? `SELECT COUNT(*)::int AS total FROM digiseller_products
       WHERE product_id ILIKE $1 OR CAST(digiseller_id AS TEXT) ILIKE $1 OR note ILIKE $1`
    : `SELECT COUNT(*)::int AS total FROM digiseller_products`;
  const { rows: countRows } = await pool.query(countQuery, countParams);

  return { items: rows, total: countRows[0].total, page, limit: safeLimit };
}

async function upsertMapping({ productId, digisellerId, note }) {
  const { rows } = await pool.query(
    `INSERT INTO digiseller_products (product_id, digiseller_id, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (product_id)
     DO UPDATE SET digiseller_id = EXCLUDED.digiseller_id,
                   note = EXCLUDED.note,
                   updated_at = NOW()
     RETURNING product_id, digiseller_id, note, created_at, updated_at`,
    [productId, digisellerId, note || null],
  );
  return rows[0];
}

async function deleteMapping(productId) {
  const { rowCount } = await pool.query(
    `DELETE FROM digiseller_products WHERE product_id = $1`,
    [productId],
  );
  return rowCount > 0;
}

module.exports = {
  buildPayUrl,
  buildKeyActivationPayUrl,
  createKeyActivationPayment,
  isGameCurrencyProduct,
  getMapping,
  getMappingsByProductIds,
  fetchRubPrice,
  getRubPriceForProduct,
  getKeyActivationRubPriceForProduct,
  createPurchasePaymentUrl,
  enrichProductWithRub,
  enrichProductsWithRub,
  buildPriceTargets,
  refreshPriceRateTable,
  getPriceRateState,
  listMappings,
  upsertMapping,
  deleteMapping,
};

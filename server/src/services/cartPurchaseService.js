const axios = require('axios');
const { randomUUID } = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const OPLATA_BASE_URL = 'https://www.oplata.info';
const XBOX_GAME_NAME_OPTION = '4931969';
const XBOX_ACCOUNT_EMAIL_OPTION = '4931970';
const XBOX_ACCOUNT_PASSWORD_OPTION = '4931971';

const POST_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ru,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: OPLATA_BASE_URL,
  Referer: `${OPLATA_BASE_URL}/`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function createCartError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIp(value) {
  const ip = String(value || '').split(',')[0].trim();
  if (!ip) return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
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
      const m = text.match(new RegExp(`<${name}>\\s*([^<]*)\\s*<\\/${name}>`, 'i'));
      return m ? m[1] : null;
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

function getCartAddCurrency(typeCurrency) {
  const currency = String(typeCurrency || config.digiseller.cartCurrency || 'API_17432_RUB').toUpperCase();
  if (currency.includes('_RUB') || currency === 'RUR') return 'RUB';
  if (currency.includes('_USD')) return 'USD';
  if (currency.includes('_EUR')) return 'EUR';
  return currency || 'RUB';
}

async function createPurchaseOptions({ productId, options, unitCount, ip }) {
  if (!productId) return null;
  try {
    const response = await axios.post('https://api.digiseller.com/api/purchases/options', {
      product_id: Number(productId),
      options: options || [],
      unit_cnt: Math.max(1, Number(unitCount) || 1),
      lang: 'ru-RU',
      ip: normalizeIp(ip),
    }, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const payload = parseJsonOrXmlPayload(response.data);
    const retval = String(payload.retval ?? '');
    if (retval !== '0' || !payload.id_po) {
      logger.warn('Digiseller cart purchases/options failed', {
        productId,
        retval: payload.retval ?? null,
        retdesc: payload.retdesc || null,
      });
      return null;
    }
    return String(payload.id_po);
  } catch (err) {
    logger.error('Digiseller cart purchases/options error', {
      productId,
      message: err.message,
    });
    return null;
  }
}

async function postCartAdd({ productId, idPo, cartUid, productCnt, typeCurrency, purchaseEmail }) {
  const base = (config.digiseller.cartBaseUrl || 'https://shop.digiseller.ru').replace(/\/$/, '');
  const url = `${base}/xml/shop_cart_add.asp`;
  const body = new URLSearchParams({
    product_id: String(productId),
    product_cnt: String(Math.max(1, Number(productCnt) || 1)),
    typecurr: getCartAddCurrency(typeCurrency),
    email: purchaseEmail || '',
    lang: 'ru-RU',
    cart_uid: cartUid || '',
    id_po: idPo,
  });

  try {
    const response = await axios.post(url, body.toString(), {
      headers: POST_HEADERS,
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const payload = parseJsonOrXmlPayload(response.data);
    const cartErr = String(payload.cart_err_num ?? payload.cart_err ?? payload.retval ?? '');
    if ((cartErr !== '0' && cartErr !== '') || !payload.cart_uid) {
      logger.warn('Digiseller cart add failed', {
        productId,
        cartErr,
        retdesc: payload.retdesc || null,
      });
      return { ok: false, cartErr, retdesc: payload.retdesc || null };
    }
    return { ok: true, cartUid: String(payload.cart_uid) };
  } catch (err) {
    logger.error('Digiseller cart add error', { productId, message: err.message });
    return { ok: false, reason: err.message };
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
  url.searchParams.set('_ow', '0');
  url.searchParams.set('_ids_shop', String(sellerId));
  if (purchaseEmail) url.searchParams.set('email', purchaseEmail);
  return url.toString();
}

function getUsdPriceValue(product) {
  const candidates = [
    product?.gamePassPrice,
    product?.price?.value,
    product?.price?.listPrice,
    product?.price?.msrp,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

function buildItemsForOplata(products, { gameNames, accountEmail, accountPassword }) {
  const digisellerId = config.digiseller.defaultProductId;
  if (!digisellerId) throw createCartError('Digiseller product id is not configured', 500);
  if (!accountEmail) throw createCartError('Email аккаунта Xbox обязателен');
  if (!accountPassword) throw createCartError('Пароль аккаунта Xbox обязателен');

  return products.map((product, index) => {
    const usd = getUsdPriceValue(product);
    if (!usd) {
      throw createCartError(`Не удалось определить цену для "${product.title || product.id}"`, 400);
    }
    const gameName = normalizeText(gameNames?.[index] || product.title || product.name || product.id);
    return {
      productId: digisellerId,
      typeCurrency: config.digiseller.typeCurrency,
      unitCount: usd,
      productCnt: usd,
      productTitle: gameName,
      options: [
        { id: Number(XBOX_GAME_NAME_OPTION), value: { text: gameName } },
        { id: Number(XBOX_ACCOUNT_EMAIL_OPTION), value: { text: accountEmail } },
        { id: Number(XBOX_ACCOUNT_PASSWORD_OPTION), value: { text: accountPassword } },
      ],
    };
  });
}

function buildItemsForKeyActivation(products, { gameNames }) {
  const digisellerId = config.digiseller.keyActivationProductId;
  if (!digisellerId) throw createCartError('Key activation product id is not configured', 500);
  const optionCategoryId = config.digiseller.keyActivationOptionCategoryId;
  const optionValueId = config.digiseller.keyActivationOptionValueId;
  const gameNameOptionId = config.digiseller.keyActivationGameNameOptionId;
  if (!optionCategoryId || !optionValueId || !gameNameOptionId) {
    throw createCartError('Key activation options are not configured', 500);
  }

  return products.map((product, index) => {
    const usd = getUsdPriceValue(product);
    if (!usd) {
      throw createCartError(`Не удалось определить цену для "${product.title || product.id}"`, 400);
    }
    const gameName = normalizeText(gameNames?.[index] || product.title || product.name || product.id);
    return {
      productId: digisellerId,
      typeCurrency: config.digiseller.keyActivationTypeCurrency || config.digiseller.typeCurrency,
      unitCount: usd,
      productCnt: usd,
      productTitle: gameName,
      options: [
        { id: Number(optionCategoryId), value: { id: Number(optionValueId) } },
        { id: Number(gameNameOptionId), value: { text: gameName } },
      ],
    };
  });
}

async function buildCartPayment({
  paymentMode,
  products,
  gameNames,
  accountEmail,
  accountPassword,
  purchaseEmail,
  buyerIp,
}) {
  if (!Array.isArray(products) || products.length === 0) {
    throw createCartError('Корзина пуста', 400);
  }
  if (paymentMode !== 'oplata' && paymentMode !== 'key_activation') {
    throw createCartError('Этот способ оплаты не поддерживает корзину', 400);
  }

  const cleanEmail = normalizeText(purchaseEmail);
  const cleanAccountEmail = normalizeText(accountEmail);
  const cleanAccountPassword = String(accountPassword || '').trim();
  const cleanGameNames = (gameNames || []).map(normalizeText);

  const items = paymentMode === 'oplata'
    ? buildItemsForOplata(products, {
        gameNames: cleanGameNames,
        accountEmail: cleanAccountEmail,
        accountPassword: cleanAccountPassword,
      })
    : buildItemsForKeyActivation(products, { gameNames: cleanGameNames });

  let cartUid = '';
  const addedItems = [];

  for (const item of items) {
    const idPo = await createPurchaseOptions({
      productId: item.productId,
      options: item.options,
      unitCount: item.unitCount,
      ip: buyerIp,
    });
    if (!idPo) {
      throw createCartError(
        `Не удалось подготовить вариант покупки для "${item.productTitle}"`,
        502,
      );
    }
    const result = await postCartAdd({
      productId: item.productId,
      idPo,
      cartUid,
      productCnt: item.productCnt,
      typeCurrency: item.typeCurrency,
      purchaseEmail: cleanEmail,
    });
    if (!result.ok) {
      throw createCartError(
        result.retdesc
          || `Не удалось добавить "${item.productTitle}" в корзину`,
        502,
      );
    }
    cartUid = result.cartUid;
    addedItems.push({ title: item.productTitle, productId: item.productId });
  }

  if (!cartUid) throw createCartError('Не удалось создать корзину', 502);

  const paymentUrl = buildCartPayUrl(cartUid, { purchaseEmail: cleanEmail });
  if (!paymentUrl) throw createCartError('Не удалось построить ссылку оплаты корзины', 502);

  return {
    paymentUrl,
    cartUid,
    paymentMode,
    items: addedItems,
    purchaseEmail: cleanEmail || null,
  };
}

module.exports = {
  buildCartPayment,
};

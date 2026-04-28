const axios = require('axios');
const { randomUUID } = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { fetchRubPrice } = require('./digisellerService');
const { buildCartComboPurchase } = require('./topupCardService');

const OPLATA_BASE_URL = 'https://www.oplata.info';
const XBOX_GAME_NAME_OPTION = '4931969';
const XBOX_ACCOUNT_EMAIL_OPTION = '4931970';
const XBOX_ACCOUNT_PASSWORD_OPTION = '4931971';

const FORM_POST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'ru,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: OPLATA_BASE_URL,
  Pragma: 'no-cache',
  Referer: `${OPLATA_BASE_URL}/`,
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const CART_POST_HEADERS = {
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

function extractIdPoFromLocation(location) {
  if (!location) return null;
  try {
    const url = new URL(location, OPLATA_BASE_URL);
    const idPo = url.searchParams.get('id_po');
    return idPo ? String(idPo) : null;
  } catch {
    const m = String(location).match(/[?&]id_po=([^&]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

async function createIdPoForItem(item) {
  const digiuid = randomUUID().toUpperCase();
  const failPage = config.digiseller.failPageUrl
    || (config.clientOrigin ? `${config.clientOrigin.replace(/\/$/, '')}/cart` : '');
  const body = new URLSearchParams({
    Lang: 'ru-RU',
    ID_D: String(item.digisellerId),
    product_id: String(item.digisellerId),
    Agent: config.digiseller.sellerId || '',
    AgentN: '',
    FailPage: failPage,
    failpage: failPage,
    NoClearBuyerQueryString: 'NoClear',
    digiuid,
    Curr_add: '',
    TypeCurr: item.typeCurrency,
    _subcurr: '',
    _ow: '0',
    firstrun: '0',
    unit_cnt: String(item.unitCount),
    unit_amount: String(item.amountRub),
    product_cnt: String(item.unitCount),
    Email: item.purchaseEmail || '',
    ...item.optionFields,
  });

  try {
    const response = await axios.post(config.digiseller.payPostUrl, body.toString(), {
      headers: FORM_POST_HEADERS,
      timeout: 12000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    const location = response.headers.location;
    const idPo = extractIdPoFromLocation(location);
    if (!idPo) {
      logger.warn('Digiseller cart pay.asp returned no id_po', {
        digisellerId: item.digisellerId,
        status: response.status,
        location,
      });
      return null;
    }
    return idPo;
  } catch (err) {
    logger.error('Digiseller cart pay.asp error', {
      digisellerId: item.digisellerId,
      message: err.message,
      status: err.response?.status,
    });
    return null;
  }
}

async function postCartAdd({ digisellerId, idPo, cartUid, productCnt, typeCurrency, purchaseEmail, productTitle }) {
  const base = (config.digiseller.cartBaseUrl || 'https://shop.digiseller.ru').replace(/\/$/, '');
  const url = `${base}/xml/shop_cart_add.asp`;

  const safeProductCnt = 1;

  const body = new URLSearchParams({
    product_id: String(digisellerId),
    product_cnt: String(safeProductCnt),
    typecurr: getCartAddCurrency(typeCurrency),
    email: purchaseEmail || '',
    lang: 'ru-RU',
    cart_uid: cartUid || '',
    id_po: idPo,
  });

  logger.info('Digiseller cart add request FULL DEBUG', {
    digisellerId,
    productTitle,
    url,
    request: {
      product_id: String(digisellerId),
      product_cnt: String(safeProductCnt),
      originalProductCnt: productCnt,
      typecurr: getCartAddCurrency(typeCurrency),
      hasEmail: Boolean(purchaseEmail),
      cart_uid: cartUid || '',
      id_po: idPo,
    },
  });

  try {
    const response = await axios.post(url, body.toString(), {
      headers: CART_POST_HEADERS,
      timeout: 12000,
      validateStatus: (status) => status >= 200 && status < 500,
    });

    const payload = parseJsonOrXmlPayload(response.data);
    const cartErr = String(payload.cart_err_num ?? payload.cart_err ?? payload.retval ?? '');

    logger.info('Digiseller cart add response FULL DEBUG', {
      digisellerId,
      productTitle,
      httpStatus: response.status,
      contentType: response.headers?.['content-type'],
      payload,
      rawData: response.data,
      cartErr,
    });

    if ((cartErr !== '0' && cartErr !== '') || !payload.cart_uid) {
      logger.warn('Digiseller cart add failed FULL DEBUG', {
        digisellerId,
        productTitle,
        cartErr,
        retdesc: payload.retdesc || null,
        payload,
        rawData: response.data,
        request: {
          product_id: String(digisellerId),
          product_cnt: String(safeProductCnt),
          originalProductCnt: productCnt,
          typecurr: getCartAddCurrency(typeCurrency),
          hasEmail: Boolean(purchaseEmail),
          cart_uid: cartUid || '',
          id_po: idPo,
        },
      });

      return {
        ok: false,
        cartErr,
        retdesc: payload.retdesc || null,
        payload,
      };
    }

    return { ok: true, cartUid: String(payload.cart_uid) };
  } catch (err) {
    logger.error('Digiseller cart add error FULL DEBUG', {
      digisellerId,
      productTitle,
      message: err.message,
      status: err.response?.status,
      responseData: err.response?.data,
      stack: err.stack,
    });

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

async function buildItemsForOplata(products, { gameNames, accountEmail, accountPassword, purchaseEmail }) {
  const digisellerId = config.digiseller.defaultProductId;
  if (!digisellerId) throw createCartError('Digiseller product id is not configured', 500);
  if (!accountEmail) throw createCartError('Email аккаунта Xbox обязателен');
  if (!accountPassword) throw createCartError('Пароль аккаунта Xbox обязателен');

  const cartLines = [];
  let totalUsd = 0;
  let totalRub = 0;

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const usd = getUsdPriceValue(product);

    if (!usd) {
      throw createCartError(`Не удалось определить цену для "${product.title || product.id}"`, 400);
    }

    const gameName = normalizeText(gameNames?.[index] || product.title || product.name || product.id);

    const rubQuote = await fetchRubPrice(digisellerId, usd, {
      cacheResult: true,
    });

    const amountRub = Math.round(
      Number(rubQuote?.amount || rubQuote?.value || product.priceRub?.amount || product.priceRub?.value || 0)
    );

    if (!amountRub || !Number.isFinite(amountRub)) {
      throw createCartError(`Не удалось получить цену в рублях для "${gameName}"`, 502);
    }

    totalUsd += usd;
    totalRub += amountRub;

    cartLines.push(`${index + 1}. ${gameName} — ${usd}$ / ${amountRub}₽`);
  }

  totalUsd = Math.round(totalUsd * 100) / 100;

  const combinedGameName = [
    `Корзина Xbox игр`,
    ``,
    ...cartLines,
    ``,
    `Итого: ${totalUsd}$ / ${totalRub}₽`,
  ].join('\n');

  logger.info('Oplata cart combined item built', {
    digisellerId,
    productsCount: products.length,
    totalUsd,
    totalRub,
    games: cartLines,
  });

  return [
    {
      digisellerId,
      typeCurrency: config.digiseller.typeCurrency,
      unitCount: totalUsd,
      amountRub: totalRub,
      productCnt: 1,
      productTitle: `Корзина Xbox (${products.length} товаров)`,
      purchaseEmail: purchaseEmail || '',
      optionFields: {
        [`Option_text_${XBOX_GAME_NAME_OPTION}`]: combinedGameName,
        [`Option_text_${XBOX_ACCOUNT_EMAIL_OPTION}`]: accountEmail,
        [`Option_text_${XBOX_ACCOUNT_PASSWORD_OPTION}`]: accountPassword,
      },
      metaItems: products.map((product, index) => ({
        id: product.id,
        title: normalizeText(gameNames?.[index] || product.title || product.name || product.id),
        usd: getUsdPriceValue(product),
      })),
    },
  ];
}

async function buildItemsForKeyActivation(products, { gameNames, purchaseEmail }) {
  const digisellerId = config.digiseller.keyActivationProductId;
  if (!digisellerId) throw createCartError('Key activation product id is not configured', 500);

  const optionCategoryId = config.digiseller.keyActivationOptionCategoryId;
  const optionValueId = config.digiseller.keyActivationOptionValueId;
  const gameNameOptionId = config.digiseller.keyActivationGameNameOptionId;

  if (!optionCategoryId || !optionValueId || !gameNameOptionId) {
    throw createCartError('Key activation options are not configured', 500);
  }

  const optionXml = `<response><option O="${optionCategoryId}" V="${optionValueId}"/></response>`;

  const cartLines = [];
  let totalUsd = 0;
  let totalRub = 0;

  for (let index = 0; index < products.length; index += 1) {
    const product = products[index];
    const usd = getUsdPriceValue(product);

    if (!usd) {
      throw createCartError(`Не удалось определить цену для "${product.title || product.id}"`, 400);
    }

    const gameName = normalizeText(gameNames?.[index] || product.title || product.name || product.id);

    const rubQuote = await fetchRubPrice(digisellerId, usd, {
      cacheResult: true,
      optionXml,
    });

    const amountRub = Math.round(Number(rubQuote?.amount || rubQuote?.value || 0));

    if (!amountRub || !Number.isFinite(amountRub)) {
      throw createCartError(`Не удалось получить цену в рублях для "${gameName}"`, 502);
    }

    totalUsd += usd;
    totalRub += amountRub;

    cartLines.push(`${index + 1}. ${gameName} — ${usd}$ / ${amountRub}₽`);
  }

  totalUsd = Math.round(totalUsd * 100) / 100;

  const combinedGameName = [
    `Корзина ключей активации Xbox USA`,
    ``,
    ...cartLines,
    ``,
    `Итого: ${totalUsd}$ / ${totalRub}₽`,
  ].join('\n');

  logger.info('Key activation cart combined item built', {
    digisellerId,
    productsCount: products.length,
    totalUsd,
    totalRub,
    games: cartLines,
  });

  return [
    {
      digisellerId,
      typeCurrency: config.digiseller.keyActivationTypeCurrency || config.digiseller.typeCurrency,
      unitCount: totalUsd,
      amountRub: totalRub,
      productCnt: 1,
      productTitle: `Корзина ключей активации (${products.length} товаров)`,
      purchaseEmail: purchaseEmail || '',
      optionFields: {
        [`Option_radio_${optionCategoryId}`]: String(optionValueId),
        [`Option_text_${gameNameOptionId}`]: combinedGameName,
      },
      metaItems: products.map((product, index) => ({
        id: product.id,
        title: normalizeText(gameNames?.[index] || product.title || product.name || product.id),
        usd: getUsdPriceValue(product),
      })),
    },
  ];
}

function getTopupCartErrorMessage(result) {
  const title = result?.productTitle ? `"${result.productTitle}"` : 'товара';

  if (result?.reason === 'price_invalid') {
    return `Не удалось определить цену для ${title}`;
  }

  if (result?.reason === 'no_cards_in_stock') {
    return 'Карты пополнения временно недоступны';
  }

  if (result?.reason === 'cannot_cover_price') {
    return `Не удалось подобрать карты пополнения для ${title}`;
  }

  return `Карты пополнения недоступны для ${title}`;
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
  if (paymentMode !== 'oplata' && paymentMode !== 'key_activation' && paymentMode !== 'topup_cards') {
    throw createCartError('Этот способ оплаты не поддерживает корзину', 400);
  }

  const cleanEmail = normalizeText(purchaseEmail);
  const cleanAccountEmail = normalizeText(accountEmail);
  const cleanAccountPassword = String(accountPassword || '').trim();
  const cleanGameNames = (gameNames || []).map(normalizeText);

  if (paymentMode === 'topup_cards') {
    const combo = await buildCartComboPurchase(
      products.map((product, index) => ({
        productId: product.id,
        title: cleanGameNames[index] || product.title || product.name || product.id,
        priceUsd: getUsdPriceValue(product),
      })),
      {
        purchaseEmail: cleanEmail,
        buyerIp,
      },
    );

    if (!combo?.available) {
      throw createCartError(getTopupCartErrorMessage(combo), 400);
    }

    if (!combo.paymentUrl) {
      throw createCartError('Не удалось подготовить ссылку оплаты карт пополнения', 502);
    }

    return {
      paymentUrl: combo.paymentUrl,
      cartUid: combo.cartUid || null,
      paymentMode,
      items: combo.products || [],
      links: combo.links || [],
      cardsCount: combo.cardsCount || 0,
      totalUsd: combo.totalUsd || 0,
      totalRub: combo.totalRub ?? null,
      totalRubFormatted: combo.totalRubFormatted || null,
      substituted: Boolean(combo.substituted),
      cartBatch: Boolean(combo.cartUid),
      cartError: combo.cartError || null,
      purchaseEmail: cleanEmail || null,
    };
  }

  const items = paymentMode === 'oplata'
    ? await buildItemsForOplata(products, {
        gameNames: cleanGameNames,
        accountEmail: cleanAccountEmail,
        accountPassword: cleanAccountPassword,
        purchaseEmail: cleanEmail,
      })
    : await buildItemsForKeyActivation(products, {
        gameNames: cleanGameNames,
        purchaseEmail: cleanEmail,
      });

  let cartUid = '';
  const addedItems = [];

  for (const item of items) {
    const idPo = await createIdPoForItem(item);
    if (!idPo) {
      throw createCartError(
        `Не удалось подготовить вариант покупки для "${item.productTitle}"`,
        502,
      );
    }
    const result = await postCartAdd({
      digisellerId: item.digisellerId,
      idPo,
      cartUid,
      productCnt: item.productCnt,
      typeCurrency: item.typeCurrency,
      purchaseEmail: cleanEmail,
      productTitle: item.productTitle,
    });
    if (!result.ok) {
      const detail = result.retdesc ? ` (${result.retdesc})` : '';
      throw createCartError(
        `Не удалось добавить "${item.productTitle}" в корзину${detail}`,
        502,
      );
    }
    cartUid = result.cartUid;
    addedItems.push({
      title: item.productTitle,
      digisellerId: item.digisellerId,
      idPo,
      items: item.metaItems || [],
      amountRub: item.amountRub,
      totalUsd: item.unitCount,
    });
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

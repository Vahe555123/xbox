const { search } = require('../services/searchService');
const { getProductById, getProductsByIds } = require('../services/displayCatalogService');
const { mapProductDetail } = require('../mappers/productDetailMapper');
const { mapRelatedProducts } = require('../mappers/relatedProductMapper');
const { parseSearchParams } = require('../utils/queryParams');
const { AppError } = require('../utils/errorFormatter');
const {
  enrichProductWithRub,
  enrichProductsWithRub,
  createPurchasePaymentUrl,
  createKeyActivationPayment,
  buildKeyActivationPayUrl,
  getKeyActivationRubPriceForProduct,
  isGameCurrencyProduct,
} = require('../services/digisellerService');
const topupCardService = require('../services/topupCardService');

function assignKeyActivationUrl(product) {
  if (!product) return product;
  if (!isPaidReleasedProduct(product)) {
    product.keyActivationPayUrl = null;
    return product;
  }
  product.keyActivationPayUrl = buildKeyActivationPayUrl(product);
  return product;
}

function getProductUsdPrice(product) {
  const candidates = [product?.price?.value, product?.price?.listPrice, product?.price?.msrp];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

function getProductOriginalUsdPrice(product) {
  const current = getProductUsdPrice(product);
  const original = Number(product?.price?.original || product?.price?.msrp);
  if (!Number.isFinite(original) || original <= 0) return null;
  if (current && original <= current) return null;
  return Math.round(original * 100) / 100;
}

function isPaidReleasedProduct(product) {
  const status = product?.releaseInfo?.status;
  if (status === 'unreleased' || status === 'comingSoon') return false;
  if (product?.notAvailableSeparately) return false;
  const current = Number(product?.price?.value);
  if (Number.isFinite(current) && current <= 0) return false;
  return Boolean(getProductUsdPrice(product));
}

function getRequestIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded || req.ip || req.socket?.remoteAddress || '';
  return String(raw).startsWith('::ffff:') ? String(raw).slice(7) : raw;
}

async function assignTopupCombo(product) {
  if (!product) return product;
  if (isGameCurrencyProduct(product)) return product;
  if (!isPaidReleasedProduct(product)) return product;
  const usd = getProductUsdPrice(product);
  if (!usd) return product;
  try {
    const combo = await topupCardService.computeCombo(usd);
    if (combo?.available) product.topupCombo = combo;
    const originalUsd = getProductOriginalUsdPrice(product);
    if (originalUsd) {
      const originalCombo = await topupCardService.computeCombo(originalUsd);
      if (originalCombo?.available) product.topupComboOriginal = originalCombo;
    }
  } catch (e) {
    logger.warn('Topup combo computation failed', { productId: product.id, message: e.message });
  }
  return product;
}

function getRubValue(price) {
  const value = price?.value ?? price?.amount ?? price?.totalRub;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function buildRubPaymentPrice(id, title, price, extra = {}) {
  const value = getRubValue(price);
  const formatted = price?.formatted || price?.totalRubFormatted || null;
  const originalValue = getRubValue(extra.originalPrice);
  const originalFormatted = extra.originalPrice?.formatted || extra.originalPrice?.totalRubFormatted || null;
  const { originalPrice, ...rest } = extra;
  return {
    id,
    title,
    enabled: rest.enabled ?? Boolean(formatted || value),
    available: Boolean(formatted || value),
    value,
    formatted,
    originalValue,
    originalFormatted,
    currency: 'RUB',
    ...rest,
  };
}

function estimateOriginalRubPrice(currentRub, product) {
  const value = getRubValue(currentRub);
  const currentUsd = getProductUsdPrice(product);
  const originalUsd = getProductOriginalUsdPrice(product);
  if (!value || !currentUsd || !originalUsd) return null;
  const originalValue = Math.round(value * (originalUsd / currentUsd));
  return {
    value: originalValue,
    formatted: new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(originalValue),
  };
}

async function assignPaymentPrices(product) {
  if (!product) return product;

  let keyActivationRub = null;
  if (product.keyActivationPayUrl) {
    keyActivationRub = await getKeyActivationRubPriceForProduct(product).catch((e) => {
      logger.warn('Key activation RUB enrichment failed', {
        productId: product.id,
        message: e.message,
      });
      return null;
    });
  }

  product.paymentPrices = {
    oplata: buildRubPaymentPrice('oplata', 'Oplata.info', product.priceRub, {
      enabled: Boolean(product.digisellerId || product.digisellerPayUrl),
      originalPrice: estimateOriginalRubPrice(product.priceRub, product),
    }),
    key_activation: buildRubPaymentPrice('key_activation', 'Ключ активации', keyActivationRub, {
      enabled: Boolean(product.keyActivationPayUrl),
      originalPrice: estimateOriginalRubPrice(keyActivationRub, product),
    }),
    topup_cards: buildRubPaymentPrice('topup_cards', 'Карты пополнения', product.topupCombo, {
      enabled: Boolean(product.topupCombo?.available),
      originalPrice: product.topupComboOriginal,
      originalTotalUsd: product.topupComboOriginal?.totalUsd ?? null,
      originalPriceUsd: product.topupComboOriginal?.price ?? null,
      cardsCount: product.topupCombo?.cardsCount ?? null,
      totalUsd: product.topupCombo?.totalUsd ?? null,
      priceUsd: product.topupCombo?.price ?? null,
      substituted: Boolean(product.topupCombo?.substituted),
    }),
  };

  return product;
}

async function assignPurchaseOptions(product) {
  if (!product) return product;
  assignKeyActivationUrl(product);
  await assignTopupCombo(product);
  await assignPaymentPrices(product);
  return product;
}

async function assignPurchaseOptionsForProducts(products) {
  await Promise.all((products || []).map(assignPurchaseOptions));
  return products;
}
const {
  getPurchaseSettingsForCheckout,
  updatePurchaseSettings,
} = require('../services/authService');
const logger = require('../utils/logger');

async function searchXbox(req, res, next) {
  try {
    const params = parseSearchParams(req.query);

    logger.info('Search request', {
      query: params.query,
      sort: params.sort,
      hasFilters: Object.keys(params.filters).length > 0,
      hasEncodedCT: !!params.encodedCT,
    });

    const channelId = params.deals ? 'DynamicChannel.GameDeals' : '';

    const result = await search({
      query: params.query,
      page: params.page,
      sort: params.sort,
      filters: params.filters,
      priceRange: params.priceRange,
      languageMode: params.languageMode,
      freeOnly: params.freeOnly,
      encodedCT: params.encodedCT,
      channelId,
    });

    await enrichProductsWithRub(result.products).catch((e) =>
      logger.warn('RUB enrichment failed', { message: e.message }));
    await assignPurchaseOptionsForProducts(result.products);

    res.json({
      success: true,
      query: params.query || null,
      page: params.page,
      pageSize: result.products.length,
      total: result.totalItems,
      products: result.products,
      filters: result.filters,
      totalIsApproximate: result.totalIsApproximate,
      encodedCT: result.encodedCT,
      hasMorePages: result.hasMorePages,
      deals: params.deals || false,
    });
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || err.message;
      logger.error('Xbox API error', { status, message });
      return next(new AppError(`Xbox API error: ${message}`, status >= 500 ? 502 : status));
    }
    next(err);
  }
}

async function getProductDetail(req, res, next) {
  try {
    const { productId } = req.params;
    logger.info('Product detail request', { productId });

    const raw = await getProductById(productId);
    const product = mapProductDetail(raw);
    await enrichProductWithRub(product).catch((e) =>
      logger.warn('RUB detail enrichment failed', { productId: product.id, message: e.message }));
    product.digisellerId = product.digisellerId || null;
    product.digisellerPayUrl = product.digisellerPayUrl || null;
    product.priceRub = product.priceRub || null;
    await assignPurchaseOptions(product);

    res.json({
      success: true,
      product,
    });
  } catch (err) {
    if (err.statusCode === 404 || err.response?.status === 404) {
      return next(new AppError('Product not found', 404));
    }
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || err.message;
      logger.error('Display catalog error', { status, message });
      return next(new AppError(`Catalog error: ${message}`, status >= 500 ? 502 : status));
    }
    next(err);
  }
}

async function createProductPurchase(req, res, next) {
  try {
    const { productId } = req.params;
    const {
      accountEmail,
      accountPassword,
      purchaseEmail,
      paymentMode,
      gameName,
      saveToProfile,
    } = req.body || {};
    logger.info('Product purchase request', { productId });

    const raw = await getProductById(productId);
    const product = mapProductDetail(raw);
    await enrichProductWithRub(product).catch((e) =>
      logger.warn('RUB detail enrichment failed before purchase', { productId: product.id, message: e.message }));

    const savedSettings = req.user ? await getPurchaseSettingsForCheckout(req.user.id) : null;
    const finalAccountEmail = String(accountEmail || savedSettings?.xboxAccountEmail || '').trim();
    const finalAccountPassword = String(accountPassword || savedSettings?.xboxAccountPassword || '').trim();
    const finalPurchaseEmail = String(purchaseEmail || savedSettings?.purchaseEmail || req.user?.email || '').trim();
    const finalPaymentMode = paymentMode || savedSettings?.paymentMode || 'oplata';

    if (req.user && saveToProfile) {
      const saveFields = {
        purchaseEmail: finalPurchaseEmail,
        paymentMode: finalPaymentMode,
      };
      if (finalPaymentMode !== 'key_activation' && finalPaymentMode !== 'topup_cards') {
        saveFields.xboxAccountEmail = finalAccountEmail;
        saveFields.xboxAccountPassword = accountPassword || undefined;
      }
      await updatePurchaseSettings(req.user.id, saveFields).catch((e) =>
        logger.warn('Purchase settings save failed during checkout', {
          userId: req.user.id,
          message: e.message,
        }));
    }

    let payment;
    if (finalPaymentMode === 'key_activation') {
      if (!isPaidReleasedProduct(product)) {
        throw new AppError('Ключ активации недоступен для этого товара', 400);
      }
      payment = await createKeyActivationPayment(product, {
        gameName,
        purchaseEmail: finalPurchaseEmail,
      });
    } else if (finalPaymentMode === 'topup_cards') {
      if (isGameCurrencyProduct(product)) {
        throw new AppError('Карты пополнения недоступны для игровой валюты', 400);
      }
      if (!isPaidReleasedProduct(product)) {
        throw new AppError('Карты пополнения недоступны для этого товара', 400);
      }
      const usd = getProductUsdPrice(product);
      if (!usd) throw new AppError('Не удалось определить цену в USD для карт', 400);
      const combo = await topupCardService.buildComboPurchase(usd, {
        purchaseEmail: finalPurchaseEmail,
        buyerIp: getRequestIp(req),
      });
      if (!combo?.available) {
        throw new AppError('Комбинация карт недоступна: нет в наличии нужных номиналов', 502);
      }
      const primaryUrl = combo.paymentUrl || combo.links.find((l) => l.paymentUrl)?.paymentUrl || null;
      if (!primaryUrl) throw new AppError('Не удалось построить ссылку на оплату карт', 502);
      payment = {
        paymentUrl: primaryUrl,
        provider: 'oplata',
        paymentMode: 'topup_cards',
        paymentType: 'topup_cards',
        currency: 'RUB',
        priceUsd: combo.price,
        totalUsd: combo.totalUsd,
        totalRub: combo.totalRub,
        totalRubFormatted: combo.totalRubFormatted,
        cardsCount: combo.cardsCount,
        substituted: combo.substituted,
        cartUid: combo.cartUid || null,
        cartBatch: Boolean(combo.cartUid),
        links: combo.links,
        purchaseEmail: finalPurchaseEmail,
      };
    } else {
      payment = await createPurchasePaymentUrl(product, {
        gameName,
        accountEmail: finalAccountEmail,
        accountPassword: finalAccountPassword,
        purchaseEmail: finalPurchaseEmail,
        paymentMode: finalPaymentMode,
      });
    }

    res.json({
      success: true,
      paymentUrl: payment.paymentUrl,
      payment,
      product: {
        id: product.id,
        title: product.title,
        price: product.price || null,
        priceRub: product.priceRub || null,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return next(new AppError(err.message, err.statusCode));
    }
    if (err.statusCode === 404 || err.response?.status === 404) {
      return next(new AppError('Product not found', 404));
    }
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || err.message;
      logger.error('Purchase catalog error', { status, message });
      return next(new AppError(`Catalog error: ${message}`, status >= 500 ? 502 : status));
    }
    next(err);
  }
}

async function getRelatedProducts(req, res, next) {
  try {
    const { ids } = req.query;
    if (!ids) {
      return next(new AppError('Missing "ids" query parameter', 400));
    }

    const productIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
    if (productIds.length === 0) {
      return res.json({ success: true, products: [] });
    }
    if (productIds.length > 50) {
      return next(new AppError('Maximum 50 product IDs per request', 400));
    }

    // Accept optional relationMap as JSON in query
    let relationMap = {};
    if (req.query.relationMap) {
      try {
        relationMap = JSON.parse(req.query.relationMap);
      } catch {
        // ignore parse errors
      }
    }

    logger.info('Related products request', { count: productIds.length });

    const rawProducts = await getProductsByIds(productIds);
    const products = mapRelatedProducts(rawProducts, relationMap);

    await enrichProductsWithRub(products).catch((e) =>
      logger.warn('RUB enrichment failed', { message: e.message }));
    await assignPurchaseOptionsForProducts(products);

    res.json({
      success: true,
      products,
    });
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const message = err.response.data?.message || err.message;
      logger.error('Batch catalog error', { status, message });
      return next(new AppError(`Catalog error: ${message}`, status >= 500 ? 502 : status));
    }
    next(err);
  }
}

function getHealth(_req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}

module.exports = { searchXbox, getProductDetail, createProductPurchase, getRelatedProducts, getHealth };

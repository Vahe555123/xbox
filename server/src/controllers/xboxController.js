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
  isGameCurrencyProduct,
} = require('../services/digisellerService');
const topupCardService = require('../services/topupCardService');

function assignKeyActivationUrl(product) {
  if (!product) return product;
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

async function assignTopupCombo(product) {
  if (!product) return product;
  if (isGameCurrencyProduct(product)) return product;
  const usd = getProductUsdPrice(product);
  if (!usd) return product;
  try {
    const combo = await topupCardService.computeCombo(usd);
    if (combo?.available) product.topupCombo = combo;
  } catch (e) {
    logger.warn('Topup combo computation failed', { productId: product.id, message: e.message });
  }
  return product;
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
    (result.products || []).forEach(assignKeyActivationUrl);

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
    assignKeyActivationUrl(product);
    await assignTopupCombo(product);

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
      payment = await createKeyActivationPayment(product, {
        gameName,
        purchaseEmail: finalPurchaseEmail,
      });
    } else if (finalPaymentMode === 'topup_cards') {
      if (isGameCurrencyProduct(product)) {
        throw new AppError('Карты пополнения недоступны для игровой валюты', 400);
      }
      const usd = getProductUsdPrice(product);
      if (!usd) throw new AppError('Не удалось определить цену в USD для карт', 400);
      const combo = await topupCardService.buildComboPurchase(usd, {
        purchaseEmail: finalPurchaseEmail,
      });
      if (!combo?.available) {
        throw new AppError('Комбинация карт недоступна: нет в наличии нужных номиналов', 502);
      }
      const firstLink = combo.links.find((l) => l.paymentUrl)?.paymentUrl || null;
      if (!firstLink) throw new AppError('Не удалось построить ссылки на оплату карт', 502);
      payment = {
        paymentUrl: firstLink,
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
    products.forEach(assignKeyActivationUrl);

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

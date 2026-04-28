const { search } = require('../services/searchService');
const { getProductById, getProductsByIds } = require('../services/displayCatalogService');
const { getStorePageProductData } = require('../services/xboxStorePageService');
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
  getSpecialOfferInfo,
  isGameCurrencyProduct,
} = require('../services/digisellerService');
const topupCardService = require('../services/topupCardService');
const { buildCartPayment } = require('../services/cartPurchaseService');
const {
  buildBuyerEmailForPayment,
  notifyPurchaseCreated,
  resolvePurchaseDeliveryTarget,
} = require('../services/purchaseDeliveryService');
const { applyProductOverrides } = require('../services/productOverrideService');

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
  const gamePassPrice = Number(product?.gamePassPrice);
  if (Number.isFinite(gamePassPrice) && gamePassPrice > 0) {
    return Math.round(gamePassPrice * 100) / 100;
  }
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return null;
}

function getProductOriginalUsdPrice(product) {
  const current = getProductUsdPrice(product);
  const original = Number(product?.price?.original || product?.price?.msrp || product?.price?.value);
  if (!Number.isFinite(original) || original <= 0) return null;
  if (current && original <= current) return null;
  return Math.round(original * 100) / 100;
}

function isPaidReleasedProduct(product) {
  const status = product?.releaseInfo?.status;
  if (status === 'unreleased') return false;
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

  let specialOfferInfo = null;
  if (product.specialOfferUrl) {
    specialOfferInfo = await getSpecialOfferInfo(product.specialOfferUrl).catch((e) => {
      logger.warn('Special offer info fetch failed', {
        productId: product.id,
        message: e.message,
      });
      return null;
    });
    if (!specialOfferInfo) {
      product.specialOfferUrl = null;
    }
  }

  product.paymentPrices = {
    ...(specialOfferInfo && {
      special_offer: buildRubPaymentPrice('special_offer', 'Спецпредложение', specialOfferInfo, {
        enabled: true,
      }),
    }),
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
      countOnly: params.countOnly,
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
      dealsOnly: params.deals,
      countOnly: params.countOnly,
      encodedCT: params.encodedCT,
      channelId,
    });

    if (params.countOnly) {
      return res.json({
        success: true,
        total: result.totalItems,
        totalIsApproximate: result.totalIsApproximate,
        totalPending: false,
      });
    }

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
      totalPending: result.totalPending || false,
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
    await applyProductOverrides(product);
    const storePageProductDataPromise = getStorePageProductData({
      productId: product.id,
      storeUrl: product.officialStoreUrl,
    }).catch((e) => {
      logger.warn('Xbox store page related products failed', {
        productId: product.id,
        message: e.message,
      });
      return { relatedProducts: [], languageInfo: null };
    });
    await assignPurchaseOptions(product);
    const storePageProductData = await storePageProductDataPromise;
    if (storePageProductData.languageInfo) {
      Object.assign(product, storePageProductData.languageInfo);
    }
    if (storePageProductData.relatedProducts.length) {
      product.relatedProducts = storePageProductData.relatedProducts;
    }
    if (!product.categories?.length && storePageProductData.categories?.length) {
      product.categories = storePageProductData.categories;
    }
    if (Array.isArray(storePageProductData.bundleItems) && storePageProductData.bundleItems.length > 0) {
      product.bundleItems = storePageProductData.bundleItems;
    }
    if (Array.isArray(storePageProductData.compareEditionItems) && storePageProductData.compareEditionItems.length > 0) {
      product.compareEditionItems = storePageProductData.compareEditionItems;
    }
    if (!product.fullDescription && storePageProductData.description?.fullDescription) {
      product.fullDescription = storePageProductData.description.fullDescription;
      product.descriptionSource = storePageProductData.description.source || null;
    }
    if (!product.shortDescription && storePageProductData.description?.shortDescription) {
      product.shortDescription = storePageProductData.description.shortDescription;
    }

    logger.info('Product deal date debug', {
      productId: product.id,
      priceValue: product.price?.value ?? null,
      priceOriginal: product.price?.original ?? null,
      discountPercent: product.price?.discountPercent ?? null,
      dealEndDate: product.price?.dealEndDate ?? null,
      releaseStatus: product.releaseInfo?.status ?? null,
    });

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
    const finalPurchaseEmail = String(purchaseEmail || savedSettings?.purchaseEmail || '').trim();
    const deliveryTarget = await resolvePurchaseDeliveryTarget({
      user: req.user,
      purchaseEmail: finalPurchaseEmail,
      registrationEmail: req.user?.email,
    });
    const buyerEmailForPayment = buildBuyerEmailForPayment(deliveryTarget);
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
        purchaseEmail: buyerEmailForPayment,
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
        purchaseEmail: buyerEmailForPayment,
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
        purchaseEmail: finalPurchaseEmail || null,
      };
    } else {
      payment = await createPurchasePaymentUrl(product, {
        gameName,
        accountEmail: finalAccountEmail,
        accountPassword: finalAccountPassword,
        purchaseEmail: buyerEmailForPayment,
        paymentMode: finalPaymentMode,
      });
    }

    const delivery = await notifyPurchaseCreated({
      target: deliveryTarget,
      product,
      payment,
    }).catch((e) => {
      logger.warn('Purchase delivery notification failed', {
        productId: product.id,
        channel: deliveryTarget.type,
        message: e.message,
      });
      return { sent: false, channel: deliveryTarget.type, error: e.message };
    });

    res.json({
      success: true,
      paymentUrl: payment.paymentUrl,
      payment,
      delivery,
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
    sortProductsByRequestedIds(products, productIds);
    await applyProductOverrides(products);

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

function sortProductsByRequestedIds(products, requestedIds) {
  const order = new Map(
    requestedIds.map((id, index) => [String(id).toUpperCase(), index]),
  );
  products.sort((a, b) => {
    const aOrder = order.get(String(a?.id || '').toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(String(b?.id || '').toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

function safeProductForLog(product) {
  return {
    id: product?.id,
    title: product?.title || product?.name,
    price: product?.price,
    rubPrice: product?.rubPrice || product?.priceRub,
    productType: product?.productType,
    releaseDate: product?.releaseDate,
    isAvailable: product?.isAvailable,
    isPreorder: product?.isPreorder,
    isBundle: product?.isBundle,
    url: product?.url,
    skuId: product?.skuId,
    productId: product?.productId,
  };
}

function safeErrorForLog(err) {
  return {
    message: err?.message,
    statusCode: err?.statusCode,
    name: err?.name,
    stack: err?.stack,
    responseStatus: err?.response?.status,
    responseData: err?.response?.data,
  };
}



async function createCartPurchase(req, res, next) {
  const cartLogId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const {
      productIds,
      paymentMode,
      accountEmail,
      accountPassword,
      purchaseEmail,
      saveToProfile,
    } = req.body || {};

    logger.info('Cart purchase started', {
      cartLogId,
      userId: req.user?.id || null,
      productIdsCount: Array.isArray(productIds) ? productIds.length : null,
      productIds,
      paymentMode,
      hasAccountEmail: Boolean(accountEmail),
      hasAccountPassword: Boolean(accountPassword),
      hasPurchaseEmail: Boolean(purchaseEmail),
      saveToProfile: Boolean(saveToProfile),
      ip: getRequestIp(req),
    });

    if (!Array.isArray(productIds) || productIds.length === 0) {
      logger.warn('Cart purchase rejected: empty cart', {
        cartLogId,
        productIds,
      });

      throw new AppError('Корзина пуста', 400);
    }

    if (productIds.length > 30) {
      logger.warn('Cart purchase rejected: too many products', {
        cartLogId,
        count: productIds.length,
      });

      throw new AppError('Слишком много товаров в корзине (максимум 30)', 400);
    }

    const savedSettings = req.user
      ? await getPurchaseSettingsForCheckout(req.user.id)
      : null;

    logger.info('Cart purchase settings loaded', {
      cartLogId,
      userId: req.user?.id || null,
      hasSavedSettings: Boolean(savedSettings),
      savedPaymentMode: savedSettings?.paymentMode || null,
      hasSavedXboxEmail: Boolean(savedSettings?.xboxAccountEmail),
      hasSavedXboxPassword: Boolean(savedSettings?.xboxAccountPassword),
      hasSavedPurchaseEmail: Boolean(savedSettings?.purchaseEmail),
    });

    const finalAccountEmail = String(accountEmail || savedSettings?.xboxAccountEmail || '').trim();
    const finalAccountPassword = String(accountPassword || savedSettings?.xboxAccountPassword || '').trim();
    const finalPurchaseEmail = String(purchaseEmail || savedSettings?.purchaseEmail || '').trim();

    const deliveryTarget = await resolvePurchaseDeliveryTarget({
      user: req.user,
      purchaseEmail: finalPurchaseEmail,
      registrationEmail: req.user?.email,
    });

    const buyerEmailForPayment = buildBuyerEmailForPayment(deliveryTarget);
    const finalPaymentMode = paymentMode || savedSettings?.paymentMode || 'oplata';

    logger.info('Cart purchase final checkout params resolved', {
      cartLogId,
      userId: req.user?.id || null,
      finalPaymentMode,
      hasFinalAccountEmail: Boolean(finalAccountEmail),
      hasFinalAccountPassword: Boolean(finalAccountPassword),
      hasFinalPurchaseEmail: Boolean(finalPurchaseEmail),
      deliveryTargetType: deliveryTarget?.type,
      buyerEmailForPayment,
    });

    if (finalPaymentMode !== 'oplata' && finalPaymentMode !== 'key_activation' && finalPaymentMode !== 'topup_cards') {
      logger.warn('Cart purchase rejected: unsupported payment mode', {
        cartLogId,
        finalPaymentMode,
      });

      throw new AppError('Этот способ оплаты не поддерживает покупку корзиной', 400);
    }

    if (req.user && saveToProfile) {
      const saveFields = {
        purchaseEmail: finalPurchaseEmail,
        paymentMode: finalPaymentMode,
      };

      if (finalPaymentMode !== 'key_activation' && finalPaymentMode !== 'topup_cards') {
        saveFields.xboxAccountEmail = finalAccountEmail;
        saveFields.xboxAccountPassword = accountPassword || undefined;
      }

      logger.info('Cart purchase saving settings to profile', {
        cartLogId,
        userId: req.user.id,
        fields: {
          purchaseEmail: Boolean(saveFields.purchaseEmail),
          paymentMode: saveFields.paymentMode,
          xboxAccountEmail: Boolean(saveFields.xboxAccountEmail),
          xboxAccountPassword: Boolean(saveFields.xboxAccountPassword),
        },
      });

      await updatePurchaseSettings(req.user.id, saveFields).catch((e) =>
        logger.warn('Cart purchase settings save failed during checkout', {
          cartLogId,
          userId: req.user.id,
          error: safeErrorForLog(e),
        })
      );
    }

    logger.info('Cart purchase loading products by ids', {
      cartLogId,
      productIds,
    });

    const rawProducts = await getProductsByIds(productIds);

    logger.info('Cart purchase raw products loaded', {
      cartLogId,
      requestedCount: productIds.length,
      rawProductsCount: rawProducts?.length || 0,
      rawProducts: Array.isArray(rawProducts)
        ? rawProducts.map(safeProductForLog)
        : null,
    });

    const products = mapRelatedProducts(rawProducts, {});

    logger.info('Cart purchase products mapped', {
      cartLogId,
      mappedCount: products.length,
      products: products.map(safeProductForLog),
    });

    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => String(p.id)));
      const missingIds = productIds.filter((id) => !foundIds.has(String(id)));

      logger.warn('Cart purchase: some products not found', {
        cartLogId,
        requested: productIds.length,
        found: products.length,
        missingIds,
      });
    }

    if (products.length === 0) {
      logger.error('Cart purchase failed: products not loaded', {
        cartLogId,
        productIds,
      });

      throw new AppError('Не удалось загрузить товары корзины', 404);
    }

    logger.info('Cart purchase applying product overrides', {
      cartLogId,
      count: products.length,
    });

    await applyProductOverrides(products);

    logger.info('Cart purchase overrides applied', {
      cartLogId,
      products: products.map(safeProductForLog),
    });

    logger.info('Cart purchase enriching products with RUB', {
      cartLogId,
      count: products.length,
    });

    await enrichProductsWithRub(products).catch((e) => {
      logger.warn('Cart RUB enrichment failed', {
        cartLogId,
        error: safeErrorForLog(e),
      });
    });

    logger.info('Cart purchase RUB enrichment finished', {
      cartLogId,
      products: products.map(safeProductForLog),
    });

    if (finalPaymentMode === 'oplata' && (!finalAccountEmail || !finalAccountPassword)) {
      logger.warn('Cart purchase rejected: missing Xbox credentials', {
        cartLogId,
        finalPaymentMode,
        hasFinalAccountEmail: Boolean(finalAccountEmail),
        hasFinalAccountPassword: Boolean(finalAccountPassword),
      });

      throw new AppError('Email и пароль аккаунта Xbox обязательны', 400);
    }

    logger.info('Cart purchase validating products before payment build', {
      cartLogId,
      count: products.length,
    });

    for (const product of products) {
      const safeProduct = safeProductForLog(product);

      logger.info('Cart purchase validating product', {
        cartLogId,
        product: safeProduct,
        isPaidReleasedProduct: isPaidReleasedProduct(product),
        isGameCurrencyProduct: isGameCurrencyProduct(product),
      });

      if (!isPaidReleasedProduct(product)) {
        logger.warn('Cart purchase product rejected: not paid released product', {
          cartLogId,
          product: safeProduct,
        });

        throw new AppError(`Товар "${product.title || product.id}" недоступен для покупки`, 400);
      }

      if (finalPaymentMode === 'key_activation' && isGameCurrencyProduct(product)) {
        logger.warn('Cart purchase product rejected: key activation unavailable for currency product', {
          cartLogId,
          product: safeProduct,
        });

        throw new AppError(`Ключ активации недоступен для "${product.title || product.id}"`, 400);
      }

      if (finalPaymentMode === 'topup_cards' && isGameCurrencyProduct(product)) {
        logger.warn('Cart purchase product rejected: topup cards unavailable for currency product', {
          cartLogId,
          product: safeProduct,
        });

        throw new AppError(`Карты пополнения недоступны для "${product.title || product.id}"`, 400);
      }
    }

    logger.info('Cart purchase buildCartPayment started', {
      cartLogId,
      paymentMode: finalPaymentMode,
      productsCount: products.length,
      products: products.map(safeProductForLog),
      gameNames: products.map((p) => p.title || p.name),
      hasAccountEmail: Boolean(finalAccountEmail),
      hasAccountPassword: Boolean(finalAccountPassword),
      purchaseEmail: buyerEmailForPayment,
      buyerIp: getRequestIp(req),
    });

    let cart;

    try {
      cart = await buildCartPayment({
        paymentMode: finalPaymentMode,
        products,
        gameNames: products.map((p) => p.title || p.name),
        accountEmail: finalAccountEmail,
        accountPassword: finalAccountPassword,
        purchaseEmail: buyerEmailForPayment,
        buyerIp: getRequestIp(req),
      });

      logger.info('Cart purchase buildCartPayment success', {
        cartLogId,
        cartUid: cart?.cartUid,
        paymentUrl: cart?.paymentUrl,
        paymentMode: cart?.paymentMode,
        itemsCount: cart?.items?.length || 0,
        items: cart?.items,
      });
    } catch (e) {
      logger.error('Cart purchase buildCartPayment failed', {
        cartLogId,
        paymentMode: finalPaymentMode,
        productsCount: products.length,
        products: products.map(safeProductForLog),
        error: safeErrorForLog(e),
      });

      throw e;
    }

    const payment = {
      paymentUrl: cart.paymentUrl,
      provider: 'oplata',
      paymentMode: cart.paymentMode,
      paymentType: cart.paymentMode === 'topup_cards' ? 'topup_cards' : 'cart_batch',
      currency: 'RUB',
      cartUid: cart.cartUid || null,
      cartBatch: Boolean(cart.cartBatch || cart.cartUid),
      items: cart.items,
      links: cart.links || null,
      cardsCount: cart.cardsCount ?? null,
      totalUsd: cart.totalUsd ?? null,
      totalRub: cart.totalRub ?? null,
      totalRubFormatted: cart.totalRubFormatted ?? null,
      substituted: Boolean(cart.substituted),
      purchaseEmail: finalPurchaseEmail || null,
    };

    logger.info('Cart purchase payment object created', {
      cartLogId,
      cartUid: cart.cartUid,
      payment,
    });

    const delivery = await notifyPurchaseCreated({
      target: deliveryTarget,
      product: { id: 'cart', title: `Корзина (${products.length} товаров)` },
      payment,
    }).catch((e) => {
      logger.warn('Cart purchase delivery notification failed', {
        cartLogId,
        cartUid: cart.cartUid,
        error: safeErrorForLog(e),
      });

      return {
        sent: false,
        channel: deliveryTarget.type,
        error: e.message,
      };
    });

    logger.info('Cart purchase finished successfully', {
      cartLogId,
      cartUid: cart.cartUid,
      productsCount: products.length,
      delivery,
    });

    res.json({
      success: true,
      paymentUrl: cart.paymentUrl,
      payment,
      delivery,
      products: products.map((p) => ({ id: p.id, title: p.title })),
    });
  } catch (err) {
    logger.error('Cart purchase failed', {
      cartLogId,
      userId: req.user?.id || null,
      error: safeErrorForLog(err),
    });

    if (err.statusCode) {
      return next(new AppError(err.message, err.statusCode));
    }

    next(err);
  }
}

function getHealth(_req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}

module.exports = { searchXbox, getProductDetail, createProductPurchase, createCartPurchase, getRelatedProducts, getHealth };

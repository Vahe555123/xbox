const { search } = require('../services/searchService');
const { getProductById, getProductsByIds } = require('../services/displayCatalogService');
const { mapProductDetail } = require('../mappers/productDetailMapper');
const { mapRelatedProducts } = require('../mappers/relatedProductMapper');
const { parseSearchParams } = require('../utils/queryParams');
const { AppError } = require('../utils/errorFormatter');
const { getMapping, buildPayUrl } = require('../services/digisellerService');
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

    const mapping = await getMapping(product.id).catch(() => null);
    if (mapping) {
      product.digisellerId = mapping.digiseller_id;
      product.digisellerPayUrl = buildPayUrl(mapping.digiseller_id);
    } else {
      product.digisellerId = null;
      product.digisellerPayUrl = null;
    }

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

module.exports = { searchXbox, getProductDetail, getRelatedProducts, getHealth };

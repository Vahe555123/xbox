const config = require('../config');
const { createAxiosClient, withRetry, isRetryableRequestError } = require('../utils/axiosClient');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const client = createAxiosClient(config.xbox.catalogBaseUrl);
const inflight = new Map();
const DISPLAY_CATALOG_RETRY_OPTIONS = {
  retries: config.xbox.requestRetryCount,
  delay: config.axios.retryDelay,
};

function setDisplayCatalogCache(cacheKey, value) {
  cache.set(cacheKey, value, config.cache.ttl, config.cache.displayCatalogStaleTtl);
  return value;
}

function createInflightRequest(cacheKey, fetcher) {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await fetcher();
      return setDisplayCatalogCache(cacheKey, value);
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

function refreshInBackground(cacheKey, fetcher, logMeta) {
  if (inflight.has(cacheKey)) return;

  createInflightRequest(cacheKey, fetcher).catch((err) => {
    logger.warn('Display catalog background refresh failed', {
      ...logMeta,
      message: err.message,
    });
  });
}

async function getProductById(productId) {
  return getProductByIdForLanguage(productId, config.xbox.language);
}

async function getProductByIdForLanguage(productId, language = config.xbox.language) {
  const cacheKey = `dcat:product:${productId}`;
  const languageSuffix = language || config.xbox.language;
  const localizedCacheKey = languageSuffix === config.xbox.language
    ? cacheKey
    : `${cacheKey}:${languageSuffix}`;
  const cached = cache.get(localizedCacheKey);
  if (cached) {
    logger.debug('Cache hit for display catalog product', { productId, language: languageSuffix });
    return cached;
  }

  const stale = cache.getStale(localizedCacheKey);
  const fetcher = async () => {
    const response = await withRetry(() =>
      client.get(`/v7.0/products/${encodeURIComponent(productId)}`, {
        params: {
          market: config.xbox.market,
          languages: languageSuffix,
          fieldsTemplate: 'details',
        },
      }),
    DISPLAY_CATALOG_RETRY_OPTIONS);

    const product = response.data?.Product;
    if (!product) {
      const err = new Error('Product not found');
      err.statusCode = 404;
      throw err;
    }

    return product;
  };

  if (stale) {
    logger.warn('Serving stale display catalog product', { productId, language: languageSuffix });
    refreshInBackground(localizedCacheKey, fetcher, { productId, language: languageSuffix });
    return stale;
  }

  return createInflightRequest(localizedCacheKey, fetcher);
}

async function getProductsByIds(productIds, options = {}) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];
  const { allowPartial = false, context = '' } = options;

  // Display Catalog supports up to ~20 IDs per request via bigIds param
  const BATCH_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    chunks.push(productIds.slice(i, i + BATCH_SIZE));
  }

  const allProducts = [];
  for (const chunk of chunks) {
    const sortedChunk = [...chunk].sort();
    const cacheKey = `dcat:batch:${sortedChunk.join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug('Cache hit for batch products', { count: chunk.length });
      allProducts.push(...cached);
      continue;
    }

    const stale = cache.getStale(cacheKey);
    const logMeta = {
      count: sortedChunk.length,
      context: context || undefined,
    };
    const fetcher = async () => {
      const response = await withRetry(() =>
        client.get('/v7.0/products', {
          params: {
            bigIds: sortedChunk.join(','),
            market: config.xbox.market,
            languages: config.xbox.language,
            fieldsTemplate: 'details',
          },
        }),
      DISPLAY_CATALOG_RETRY_OPTIONS);

      return response.data?.Products || [];
    };

    if (stale) {
      logger.warn('Serving stale display catalog batch', logMeta);
      refreshInBackground(cacheKey, fetcher, logMeta);
      allProducts.push(...stale);
      continue;
    }

    try {
      const products = await createInflightRequest(cacheKey, fetcher);
      allProducts.push(...products);
    } catch (err) {
      if (allowPartial && isRetryableRequestError(err)) {
        logger.warn('Display catalog batch failed, returning partial result', {
          ...logMeta,
          message: err.message,
        });
        continue;
      }
      throw err;
    }
  }

  return allProducts;
}

module.exports = { getProductById, getProductByIdForLanguage, getProductsByIds };

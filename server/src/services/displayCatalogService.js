const config = require('../config');
const { createAxiosClient, withRetry } = require('../utils/axiosClient');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const client = createAxiosClient(config.xbox.catalogBaseUrl);

async function getProductById(productId) {
  const cacheKey = `dcat:product:${productId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug('Cache hit for display catalog product', { productId });
    return cached;
  }

  const response = await withRetry(() =>
    client.get(`/v7.0/products/${encodeURIComponent(productId)}`, {
      params: {
        market: config.xbox.market,
        languages: config.xbox.language,
        fieldsTemplate: 'details',
      },
    }),
  );

  const product = response.data?.Product;
  if (!product) {
    const err = new Error('Product not found');
    err.statusCode = 404;
    throw err;
  }

  cache.set(cacheKey, product);
  return product;
}

async function getProductsByIds(productIds) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];

  // Display Catalog supports up to ~20 IDs per request via bigIds param
  const BATCH_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    chunks.push(productIds.slice(i, i + BATCH_SIZE));
  }

  const allProducts = [];
  for (const chunk of chunks) {
    const cacheKey = `dcat:batch:${chunk.sort().join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.debug('Cache hit for batch products', { count: chunk.length });
      allProducts.push(...cached);
      continue;
    }

    const response = await withRetry(() =>
      client.get('/v7.0/products', {
        params: {
          bigIds: chunk.join(','),
          market: config.xbox.market,
          languages: config.xbox.language,
          fieldsTemplate: 'details',
        },
      }),
    );

    const products = response.data?.Products || [];
    cache.set(cacheKey, products);
    allProducts.push(...products);
  }

  return allProducts;
}

module.exports = { getProductById, getProductsByIds };

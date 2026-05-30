const crypto = require('crypto');
const config = require('../config');
const { createAxiosClient, withRetry } = require('../utils/axiosClient');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const client = createAxiosClient(config.xbox.emeraldBaseUrl);
const inflight = new Map();
const XBOX_RETRY_OPTIONS = {
  retries: config.xbox.requestRetryCount,
  delay: config.axios.retryDelay,
};

function makeCV() {
  return crypto.randomBytes(12).toString('base64') + '.0';
}

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'X-MS-API-Version': '1.1',
};

function createInflightRequest(cacheKey, fetcher, ttlSeconds, staleTtlSeconds) {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const value = await fetcher();
      cache.set(cacheKey, value, ttlSeconds, staleTtlSeconds);
      return value;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

function refreshInBackground(cacheKey, fetcher, ttlSeconds, staleTtlSeconds, logMeta) {
  if (inflight.has(cacheKey)) return;

  createInflightRequest(cacheKey, fetcher, ttlSeconds, staleTtlSeconds).catch((err) => {
    logger.warn('Catalog background refresh failed', {
      ...logMeta,
      message: err.message,
    });
  });
}

/**
 * Browse all games with optional filters and pagination.
 * This is the same API that powers https://www.xbox.com/en-US/games/browse
 * `channelId` is optional and can be used for special browse channels when needed.
 */
async function browseGames({ encodedFilters = '', encodedCT = '', returnFilters = true, channelId = '' } = {}) {
  const cacheKey = `browse:${channelId}:${encodedFilters}:${encodedCT}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug('Cache hit for browse', { encodedFilters: encodedFilters.substring(0, 30), channelId });
    return cached;
  }

  const ttlSeconds = getBrowseCacheTtlSeconds({ encodedCT, channelId });
  const staleTtlSeconds = getBrowseStaleCacheTtlSeconds({ encodedCT, channelId });
  const logMeta = {
    encodedCT: Boolean(encodedCT),
    hasFilters: Boolean(encodedFilters),
    channelId: channelId || '',
  };
  const fetcher = async () => {
    const response = await withRetry(() =>
      client.post(`/browse?locale=${config.xbox.locale}`, {
        Filters: encodedFilters,
        ReturnFilters: returnFilters,
        ChannelKeyToBeUsedInResponse: 'BROWSE',
        EncodedCT: encodedCT,
        ChannelId: channelId,
      }, {
        headers: { ...COMMON_HEADERS, 'MS-CV': makeCV() },
      }),
    XBOX_RETRY_OPTIONS);

    return normalizeResponse(response.data, 'BROWSE');
  };
  const stale = cache.getStale(cacheKey);

  if (stale) {
    logger.warn('Serving stale browse cache', logMeta);
    refreshInBackground(cacheKey, fetcher, ttlSeconds, staleTtlSeconds, logMeta);
    return stale;
  }

  return createInflightRequest(cacheKey, fetcher, ttlSeconds, staleTtlSeconds);
}

/**
 * Search for games by query.
 * Returns results matching the Xbox.com search behavior.
 */
async function searchGames({ query, encodedFilters = '', encodedCT = '', returnFilters = true } = {}) {
  const cacheKey = `search:${query}:${encodedFilters}:${encodedCT}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug('Cache hit for search', { query });
    return cached;
  }

  const fetcher = async () => {
    const response = await withRetry(() =>
      client.post(`/search/games?locale=${config.xbox.locale}`, {
        Query: query,
        Filters: encodedFilters,
        ReturnFilters: returnFilters,
        ChannelKeyToBeUsedInResponse: 'SEARCH',
        EncodedCT: encodedCT,
        ChannelId: 'games',
      }, {
        headers: { ...COMMON_HEADERS, 'MS-CV': makeCV() },
      }),
    XBOX_RETRY_OPTIONS);

    return normalizeResponse(response.data, 'SEARCH');
  };
  const stale = cache.getStale(cacheKey);
  const ttlSeconds = config.cache.ttl;
  const staleTtlSeconds = config.cache.staleTtl;
  const logMeta = {
    query: String(query || '').slice(0, 80),
    encodedCT: Boolean(encodedCT),
    hasFilters: Boolean(encodedFilters),
  };

  if (stale) {
    logger.warn('Serving stale search cache', logMeta);
    refreshInBackground(cacheKey, fetcher, ttlSeconds, staleTtlSeconds, logMeta);
    return stale;
  }

  return createInflightRequest(cacheKey, fetcher, ttlSeconds, staleTtlSeconds);
}

/**
 * Load more products for an existing browse or search session using the continuation token.
 */
async function loadMore({ encodedCT, encodedFilters = '', query = null, channelId = '' }) {
  if (query) {
    return searchGames({ query, encodedFilters, encodedCT, returnFilters: false });
  }
  return browseGames({ encodedFilters, encodedCT, returnFilters: false, channelId });
}

/**
 * Normalize the Emerald API response into a consistent format.
 */
function normalizeResponse(data, channelKey) {
  const channel = data.channels?.[channelKey] || {};
  const productSummaries = data.productSummaries || {};
  const availabilitySummaries = data.availabilitySummaries || {};
  const filters = data.filters || {};

  const productIds = (channel.products || []).map((p) => p.productId);
  const summaryByProductId = new Map(
    Object.values(productSummaries)
      .filter((summary) => summary?.productId)
      .map((summary) => [summary.productId, summary]),
  );
  const availabilityByProductId = new Map(
    Object.values(availabilitySummaries)
      .filter((availability) => availability?.productId)
      .map((availability) => [availability.productId, availability]),
  );

  const products = productIds
    .map((productId, index) => {
      const summary = summaryByProductId.get(productId) || productSummaries[String(index)];
      if (!summary) return null;
      return {
        summary,
        availability: availabilityByProductId.get(productId) || null,
      };
    })
    .filter(Boolean);

  return {
    products,
    productIds,
    totalItems: channel.totalItems || products.length,
    encodedCT: channel.encodedCT || null,
    filters,
  };
}

function getBrowseCacheTtlSeconds({ encodedCT, channelId }) {
  const isMainCatalogRequest = !encodedCT && !channelId;
  return isMainCatalogRequest ? config.cache.mainCatalogTtl : config.cache.ttl;
}

function getBrowseStaleCacheTtlSeconds({ encodedCT, channelId }) {
  const isMainCatalogRequest = !encodedCT && !channelId;
  return isMainCatalogRequest ? config.cache.mainCatalogStaleTtl : config.cache.staleTtl;
}

module.exports = { browseGames, searchGames, loadMore };

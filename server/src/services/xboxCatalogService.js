const crypto = require('crypto');
const config = require('../config');
const { createAxiosClient, withRetry } = require('../utils/axiosClient');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

const client = createAxiosClient(config.xbox.emeraldBaseUrl);

function makeCV() {
  return crypto.randomBytes(12).toString('base64') + '.0';
}

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'X-MS-API-Version': '1.1',
};

/**
 * Browse all games with optional filters and pagination.
 * This is the same API that powers https://www.xbox.com/en-US/games/browse
 * Pass channelId = 'DynamicChannel.GameDeals' to get only discounted games.
 */
async function browseGames({ encodedFilters = '', encodedCT = '', returnFilters = true, channelId = '' } = {}) {
  const cacheKey = `browse:${channelId}:${encodedFilters}:${encodedCT}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.debug('Cache hit for browse', { encodedFilters: encodedFilters.substring(0, 30), channelId });
    return cached;
  }

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
  );

  const result = normalizeResponse(response.data, 'BROWSE');
  cache.set(cacheKey, result);
  return result;
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
  );

  const result = normalizeResponse(response.data, 'SEARCH');
  cache.set(cacheKey, result);
  return result;
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

module.exports = { browseGames, searchGames, loadMore };

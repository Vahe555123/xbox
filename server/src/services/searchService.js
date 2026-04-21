const crypto = require('crypto');
const catalogService = require('./xboxCatalogService');
const { getProductsByIds } = require('./displayCatalogService');
const { mapProducts, enrichProductsWithCatalogDetails } = require('../mappers/productMapper');
const { mapFilters, encodeFilters } = require('../mappers/filtersMapper');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

/**
 * Main search/browse orchestrator.
 * - If query is provided, uses the search endpoint (exact Xbox.com search behavior)
 * - If no query, uses the browse endpoint (full catalog, 16K+ games)
 * - Supports filters and pagination via encodedCT
 */
const RUB_USD_RATE = Number(process.env.RUB_USD_RATE) || 100;
const SEARCH_RERANK_MAX_PAGES = Math.max(1, Number(process.env.SEARCH_RERANK_MAX_PAGES) || 4);
const SEARCH_RERANK_TOKEN_PREFIX = 'ranked-search:';
const SEARCH_RERANK_CACHE_TTL_SECONDS = 10 * 60;
const STRONG_MATCH_SCORE = 5000;
const SEARCH_NOISE_TOKENS = new Set([
  'a',
  'an',
  'and',
  'for',
  'game',
  'games',
  'of',
  'one',
  'pc',
  'series',
  'standard',
  'the',
  'tm',
  'windows',
  'x',
  'xbox',
  'xs',
  's',
]);

async function search({ query, page, sort, filters, priceRange, languageMode, freeOnly = false, encodedCT, channelId = '' }) {
  const encodedFilters = buildEncodedFilters(filters, sort);
  const priceFilterActive = isPriceRangeActive(priceRange);
  const postFilterActive = Boolean(freeOnly || (languageMode && languageMode !== 'all'));

  if (isRankedSearchToken(encodedCT)) {
    const buffered = await readRankedSearchBuffer(encodedCT);
    if (buffered) return buffered;
  }

  let raw;
  try {
    if (shouldUseSearchRerank({ query, sort, encodedCT })) {
      return await searchWithRelevanceRerank({
        query,
        encodedFilters,
        priceRange,
        priceFilterActive,
        languageMode,
        freeOnly,
        postFilterActive,
        channelId,
      });
    }

    raw = await fetchCatalogPage({ query, encodedFilters, encodedCT: encodedCT || '', returnFilters: !encodedCT, channelId });
  } catch (err) {
    logger.error('Catalog service error', { message: err.message, query });
    throw err;
  }

  let rawProducts = raw.products || [];
  let nextEncodedCT = raw.encodedCT;

  if (priceFilterActive) {
    let filteredProducts = applyPriceRange(mapProducts(rawProducts), priceRange);
    let attempts = 0;

    while (
      filteredProducts.length < config.xbox.pageSize
      && nextEncodedCT
      && attempts < 4
    ) {
      const nextRaw = await fetchCatalogPage({
        query,
        encodedFilters,
        encodedCT: nextEncodedCT,
        returnFilters: false,
        channelId,
      });

      rawProducts = [...rawProducts, ...(nextRaw.products || [])];
      nextEncodedCT = nextRaw.encodedCT;
      filteredProducts = applyPriceRange(mapProducts(rawProducts), priceRange);
      attempts += 1;
    }
  }

  const mappedProducts = mapProducts(rawProducts);
  const products = priceFilterActive
    ? applyPriceRange(mappedProducts, normalizePriceRange(priceRange))
    : mappedProducts;
  const enrichedProducts = applyPostFilters(await enrichProducts(products), { languageMode, freeOnly });
  const orderedProducts = query && query.trim()
    ? rankProductsBySearchRelevance(enrichedProducts, query)
    : enrichedProducts;
  const mappedFilters = raw.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;

  return {
    products: orderedProducts,
    totalItems: (priceFilterActive || postFilterActive) ? orderedProducts.length : raw.totalItems,
    totalIsApproximate: priceFilterActive || postFilterActive,
    encodedCT: nextEncodedCT,
    filters: mappedFilters,
    hasMorePages: !!nextEncodedCT,
  };
}

async function searchWithRelevanceRerank({
  query,
  encodedFilters,
  priceRange,
  priceFilterActive,
  languageMode,
  freeOnly,
  postFilterActive,
  channelId,
}) {
  const collectedRawProducts = [];
  let raw = null;
  let nextEncodedCT = '';
  let pagesFetched = 0;

  do {
    raw = await fetchCatalogPage({
      query,
      encodedFilters,
      encodedCT: nextEncodedCT,
      returnFilters: pagesFetched === 0,
      channelId,
    });

    collectedRawProducts.push(...(raw.products || []));
    nextEncodedCT = raw.encodedCT || '';
    pagesFetched += 1;

    if (!nextEncodedCT) break;
    if (getMeaningfulSearchTokens(query).length < 2) break;
    if (bestRawSearchScore(collectedRawProducts, query) >= STRONG_MATCH_SCORE) break;
  } while (pagesFetched < SEARCH_RERANK_MAX_PAGES);

  const mappedProducts = mapProducts(dedupeRawProducts(collectedRawProducts));
  const products = priceFilterActive
    ? applyPriceRange(mappedProducts, normalizePriceRange(priceRange))
    : mappedProducts;
  const enrichedProducts = applyPostFilters(await enrichProducts(products), { languageMode, freeOnly });
  const rankedProducts = rankProductsBySearchRelevance(enrichedProducts, query);
  const pageProducts = rankedProducts.slice(0, config.xbox.pageSize);
  const remainingProducts = rankedProducts.slice(config.xbox.pageSize);
  const mappedFilters = raw?.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;
  const bufferedToken = remainingProducts.length
    ? writeRankedSearchBuffer({
        products: remainingProducts,
        nextExternalEncodedCT: nextEncodedCT || null,
        totalItems: (priceFilterActive || postFilterActive) ? rankedProducts.length : raw?.totalItems,
        totalIsApproximate: priceFilterActive || postFilterActive,
      })
    : nextEncodedCT || null;

  return {
    products: pageProducts,
    totalItems: (priceFilterActive || postFilterActive) ? rankedProducts.length : raw?.totalItems,
    totalIsApproximate: priceFilterActive || postFilterActive,
    encodedCT: bufferedToken,
    filters: mappedFilters,
    hasMorePages: Boolean(bufferedToken),
  };
}

async function readRankedSearchBuffer(encodedCT) {
  const session = cache.get(getRankedSearchCacheKey(encodedCT));
  if (!session) {
    logger.warn('Ranked search buffer expired or missing', { encodedCT });
    return {
      products: [],
      totalItems: 0,
      totalIsApproximate: true,
      encodedCT: null,
      filters: null,
      hasMorePages: false,
    };
  }

  cache.delete(getRankedSearchCacheKey(encodedCT));
  const pageProducts = session.products.slice(0, config.xbox.pageSize);
  const remainingProducts = session.products.slice(config.xbox.pageSize);
  const nextToken = remainingProducts.length
    ? writeRankedSearchBuffer({
        ...session,
        products: remainingProducts,
      })
    : session.nextExternalEncodedCT || null;

  return {
    products: pageProducts,
    totalItems: session.totalItems,
    totalIsApproximate: session.totalIsApproximate,
    encodedCT: nextToken,
    filters: null,
    hasMorePages: Boolean(nextToken),
  };
}

function writeRankedSearchBuffer(session) {
  const token = `${SEARCH_RERANK_TOKEN_PREFIX}${crypto.randomUUID()}`;
  cache.set(getRankedSearchCacheKey(token), session, SEARCH_RERANK_CACHE_TTL_SECONDS);
  return token;
}

function getRankedSearchCacheKey(token) {
  return `search:rerank:${token}`;
}

function isRankedSearchToken(value) {
  return typeof value === 'string' && value.startsWith(SEARCH_RERANK_TOKEN_PREFIX);
}

function shouldUseSearchRerank({ query, sort, encodedCT }) {
  return Boolean(query && query.trim() && !sort && !encodedCT);
}

function dedupeRawProducts(rawProducts) {
  const seen = new Set();
  const deduped = [];

  for (const item of rawProducts || []) {
    const id = item?.summary?.productId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(item);
  }

  return deduped;
}

function bestRawSearchScore(rawProducts, query) {
  return Math.max(
    0,
    ...(rawProducts || []).map((item, index) => scoreSearchTitle(item?.summary?.title, query, index)),
  );
}

/**
 * Order search results so that titles which actually contain the user's
 * search term come first, regardless of what extra "related" products the
 * upstream API mixed in. Within each bucket we preserve the existing
 * relevance score ordering so exact matches still beat partial matches.
 */
function rankProductsBySearchRelevance(products, query) {
  const queryTokens = getMeaningfulSearchTokens(query);
  const normalizedQuery = normalizeSearchText(query);

  return [...products]
    .map((product, index) => ({
      product,
      index,
      matchesTitle: titleContainsQuery(product.title, queryTokens, normalizedQuery),
      score: scoreSearchTitle(product.title, query, index),
    }))
    .sort((a, b) => {
      if (a.matchesTitle !== b.matchesTitle) return a.matchesTitle ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(({ product }) => product);
}

function titleContainsQuery(title, queryTokens, normalizedQuery) {
  if (!normalizedQuery) return true;
  const normalizedTitle = normalizeSearchText(title);
  if (!normalizedTitle) return false;
  if (normalizedTitle.includes(normalizedQuery)) return true;
  if (!queryTokens || queryTokens.length === 0) return false;
  const titleTokens = getComparableTokenSet(title);
  return queryTokens.some((token) => titleTokens.has(toComparableToken(token)));
}

function scoreSearchTitle(title, query, originalIndex = 0) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedTitle || !normalizedQuery) return 0;

  const titleCore = getMeaningfulSearchTokens(title).join(' ');
  const queryCore = getMeaningfulSearchTokens(query).join(' ');
  const titleTokens = getComparableTokenSet(title);
  const queryTokens = getSearchTokens(query);
  const meaningfulTokens = getMeaningfulSearchTokens(query);
  const tokensToMatch = meaningfulTokens.length ? meaningfulTokens : queryTokens;
  const matchedCount = tokensToMatch.filter((token) => titleTokens.has(toComparableToken(token))).length;
  const missingCount = Math.max(0, tokensToMatch.length - matchedCount);
  const matchRatio = tokensToMatch.length ? matchedCount / tokensToMatch.length : 0;
  let score = 0;

  if (normalizedTitle === normalizedQuery) score += 10000;
  if (titleCore && titleCore === queryCore) score += 9000;
  if (queryCore && titleCore.includes(queryCore)) score += 5000;
  if (queryCore && normalizedTitle.includes(queryCore)) score += 3000;
  if (normalizedTitle.includes(normalizedQuery)) score += 2500;
  if (queryCore && (titleCore.startsWith(queryCore) || queryCore.startsWith(titleCore))) score += 1800;
  if (matchedCount === tokensToMatch.length && tokensToMatch.length > 0) score += 2200;

  score += matchRatio * 1800;
  score += matchedCount * 350;
  score += countOrderedMatches(tokensToMatch, getSearchTokens(title).map(toComparableToken)) * 120;
  score -= missingCount * 1200;
  score -= originalIndex * 0.01;

  return score;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/['’]/g, '')
    .replace(/[™®©]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\|/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getSearchTokens(value) {
  return normalizeSearchText(value).split(' ').filter(Boolean);
}

function getMeaningfulSearchTokens(value) {
  const tokens = getSearchTokens(value)
    .map(toComparableToken)
    .filter((token) => token && !SEARCH_NOISE_TOKENS.has(token));

  return tokens.filter((token, index) => tokens.indexOf(token) === index);
}

function getComparableTokenSet(value) {
  return new Set(getSearchTokens(value).flatMap((token) => {
    const comparable = toComparableToken(token);
    return comparable && comparable !== token ? [token, comparable] : [token];
  }).filter(Boolean));
}

function toComparableToken(token) {
  const value = String(token || '').toLowerCase();
  if (value.length > 3 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function countOrderedMatches(needles, haystack) {
  let lastIndex = -1;
  let count = 0;

  for (const token of needles) {
    const index = haystack.findIndex((value, i) => i > lastIndex && value === toComparableToken(token));
    if (index === -1) continue;
    lastIndex = index;
    count += 1;
  }

  return count;
}

function normalizePriceRange(priceRange) {
  if (priceRange?.currency !== 'RUB') return priceRange;
  return {
    min: Number.isFinite(priceRange.min) ? priceRange.min / RUB_USD_RATE : null,
    max: Number.isFinite(priceRange.max) ? priceRange.max / RUB_USD_RATE : null,
  };
}

function applyPostFilters(products, { languageMode, freeOnly }) {
  return products.filter((product) => {
    if (freeOnly && product.price?.value !== 0) return false;
    if (languageMode && languageMode !== 'all' && product.russianLanguageMode !== languageMode) return false;
    return true;
  });
}

async function enrichProducts(products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return products;

  try {
    const catalogProducts = await getProductsByIds(productIds);
    return enrichProductsWithCatalogDetails(products, catalogProducts);
  } catch (err) {
    logger.warn('Failed to enrich products with display catalog data', { message: err.message });
    return products;
  }
}

function fetchCatalogPage({ query, encodedFilters, encodedCT, returnFilters, channelId = '' }) {
  if (query && query.trim().length > 0) {
    return catalogService.searchGames({
      query: query.trim(),
      encodedFilters,
      encodedCT,
      returnFilters,
    });
  }

  return catalogService.browseGames({
    encodedFilters,
    encodedCT,
    returnFilters,
    channelId,
  });
}

function isPriceRangeActive(priceRange) {
  return Number.isFinite(priceRange?.min) || Number.isFinite(priceRange?.max);
}

function applyPriceRange(products, priceRange) {
  const min = Number.isFinite(priceRange?.min) ? priceRange.min : null;
  const max = Number.isFinite(priceRange?.max) ? priceRange.max : null;

  if (min === null && max === null) return products;

  return products.filter((product) => {
    const price = product.price?.value;
    if (!Number.isFinite(price)) return false;
    if (min !== null && price < min) return false;
    if (max !== null && price > max) return false;
    return true;
  });
}

function buildEncodedFilters(filters, sort) {
  const filterObj = {};
  const localFilterKeys = new Set(['LanguageMode', 'DealsOnly', 'FreeOnly']);

  if (filters && typeof filters === 'object') {
    for (const [key, values] of Object.entries(filters)) {
      if (localFilterKeys.has(key)) continue;
      if (values && (Array.isArray(values) ? values.length > 0 : true)) {
        filterObj[key] = values;
      }
    }
  }

  if (sort && sort !== 'DO_NOT_FILTER') {
    filterObj.orderby = [sort];
  }

  return encodeFilters(filterObj);
}

module.exports = { search };

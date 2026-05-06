const crypto = require('crypto');
const catalogService = require('./xboxCatalogService');
const { getProductsByIds } = require('./displayCatalogService');
const { mapProducts, enrichProductsWithCatalogDetails } = require('../mappers/productMapper');
const { mapFilters, encodeFilters } = require('../mappers/filtersMapper');
const { applyProductOverrides } = require('./productOverrideService');
const { getCachedLanguageInfo, getStorePageProductData } = require('./xboxStorePageService');
const config = require('../config');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

/**
 * Main search/browse orchestrator.
 * - If query is provided, uses the search endpoint (exact Xbox.com search behavior)
 * - If no query, uses the browse endpoint (full catalog, 16K+ games)
 * - Supports filters and pagination via encodedCT
 */
const SEARCH_RERANK_MAX_PAGES = Math.max(1, Number(process.env.SEARCH_RERANK_MAX_PAGES) || 4);
const LANGUAGE_FILTER_PREFETCH_MAX_PAGES = Math.max(1, Number(process.env.SEARCH_LANGUAGE_FILTER_MAX_PAGES) || 12);
const SEARCH_RERANK_TOKEN_PREFIX = 'ranked-search:';
const SEARCH_RERANK_CACHE_TTL_SECONDS = 10 * 60;
const DEFAULT_BROWSE_SORT = 'WishlistCountTotal desc';
const RATING_SORT = 'MostPopular desc';
const STRONG_MATCH_SCORE = 5000;
const SEARCH_NOISE_TOKENS = new Set([
  'a',
  'an',
  'and',
  'for',
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
const SEARCH_EXPANSION_NOISE_TOKENS = new Set([
  ...SEARCH_NOISE_TOKENS,
  'game',
  'games',
]);

async function search({
  query,
  page,
  sort,
  filters,
  languageMode,
  countOnly = false,
  encodedCT,
  channelId = '',
}) {
  const effectiveSort = resolveSort({ query, sort });
  const encodedFilters = buildEncodedFilters(filters, effectiveSort);
  const languageFilterActive = isLanguageFilterActive(languageMode);

  if (isRankedSearchToken(encodedCT)) {
    const buffered = await readRankedSearchBuffer(encodedCT);
    if (buffered) return buffered;
  }

  let raw;
  try {
    if (!countOnly && shouldUseBufferedRatingSort({ sort: effectiveSort, encodedCT })) {
      const initialRaw = await fetchCatalogPage({
        query,
        encodedFilters,
        encodedCT: '',
        returnFilters: true,
        channelId,
      });

      return searchWithBufferedRatingSort({
        raw: initialRaw,
        query,
        encodedFilters,
        channelId,
        languageMode,
      });
    }

    if (!countOnly && shouldUseSearchRerank({ query, sort: effectiveSort, encodedCT })) {
      return await searchWithRelevanceRerank({
        query,
        encodedFilters,
        languageMode,
        channelId,
      });
    }

    raw = await fetchCatalogPage({
      query,
      encodedFilters,
      encodedCT: encodedCT || '',
      returnFilters: !encodedCT,
      channelId,
    });
  } catch (err) {
    logger.error('Catalog service error', { message: err.message, query });
    throw err;
  }

  if (countOnly) {
    if (!languageFilterActive) {
      return {
        products: [],
        totalItems: Number.isFinite(raw?.totalItems) ? raw.totalItems : 0,
        totalIsApproximate: false,
        totalPending: false,
        encodedCT: null,
        filters: null,
        hasMorePages: false,
      };
    }

    return countFilteredSearchResults({
      raw,
      query,
      encodedFilters,
      channelId,
      languageMode,
    });
  }

  let rawProducts = raw.products || [];
  let nextEncodedCT = raw.encodedCT;

  if (languageFilterActive) {
    const collected = await collectRawProductsForLanguage({
      query,
      encodedFilters,
      rawProducts,
      nextEncodedCT,
      channelId,
      languageMode,
    });

    rawProducts = collected.rawProducts;
    nextEncodedCT = collected.nextEncodedCT;
  }

  const products = mapProducts(rawProducts);
  const enrichedProducts = applyPostFilters(await applyProductOverrides(await enrichProducts(products)), {
    languageMode,
  });
  const mappedFilters = raw.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;

  return {
    products: enrichedProducts,
    totalItems: languageFilterActive ? null : raw.totalItems,
    totalIsApproximate: languageFilterActive,
    totalPending: languageFilterActive,
    encodedCT: nextEncodedCT,
    filters: mappedFilters,
    hasMorePages: !!nextEncodedCT,
  };
}

async function searchWithRelevanceRerank({
  query,
  encodedFilters,
  languageMode,
  channelId,
}) {
  const collectedRawProducts = [];
  const queryVariants = getSearchQueryVariants(query);
  let raw = null;
  let nextEncodedCT = null;
  let bestScore = 0;

  for (const [index, searchQuery] of queryVariants.entries()) {
    const result = await collectSearchPagesForRerank({
      searchQuery,
      scoreQuery: query,
      encodedFilters,
      channelId,
      returnFilters: index === 0,
      maxPages: index === 0 && queryVariants.length > 1
        ? Math.max(1, Math.ceil(SEARCH_RERANK_MAX_PAGES / 2))
        : SEARCH_RERANK_MAX_PAGES,
    });

    collectedRawProducts.push(...result.rawProducts);
    bestScore = Math.max(bestScore, result.bestScore);

    if (index === 0) {
      raw = result.raw;
      nextEncodedCT = result.nextEncodedCT;
    }

    if (bestScore >= STRONG_MATCH_SCORE && !(index === 0 && queryVariants.length > 1)) break;
  }

  const mappedProducts = mapProducts(dedupeRawProducts(collectedRawProducts));
  const enrichedProducts = applyPostFilters(await applyProductOverrides(await enrichProducts(mappedProducts)), { languageMode });
  const rankedProducts = rankProductsBySearchRelevance(enrichedProducts, query);
  const pageProducts = rankedProducts.slice(0, config.xbox.pageSize);
  const remainingProducts = rankedProducts.slice(config.xbox.pageSize);
  const mappedFilters = raw?.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;
  const languageFilterActive = isLanguageFilterActive(languageMode);
  const bufferedToken = remainingProducts.length
    ? writeRankedSearchBuffer({
        products: remainingProducts,
        nextExternalEncodedCT: nextEncodedCT || null,
        totalItems: languageFilterActive ? null : raw?.totalItems,
        totalIsApproximate: languageFilterActive,
      })
    : nextEncodedCT || null;

  return {
    products: pageProducts,
    totalItems: languageFilterActive ? null : raw?.totalItems,
    totalIsApproximate: languageFilterActive,
    totalPending: languageFilterActive,
    encodedCT: bufferedToken,
    filters: mappedFilters,
    hasMorePages: Boolean(bufferedToken),
  };
}

async function collectSearchPagesForRerank({
  searchQuery,
  scoreQuery,
  encodedFilters,
  channelId,
  returnFilters,
  maxPages,
}) {
  const rawProducts = [];
  let raw = null;
  let nextEncodedCT = '';
  let pagesFetched = 0;
  let bestScore = 0;

  do {
    raw = await fetchCatalogPage({
      query: searchQuery,
      encodedFilters,
      encodedCT: nextEncodedCT,
      returnFilters: returnFilters && pagesFetched === 0,
      channelId,
    });

    rawProducts.push(...(raw.products || []));
    nextEncodedCT = raw.encodedCT || '';
    pagesFetched += 1;
    bestScore = Math.max(bestScore, bestRawSearchScore(rawProducts, scoreQuery));

    if (!nextEncodedCT) break;
    if (getMeaningfulSearchTokens(scoreQuery).length < 2) break;
    if (bestScore >= STRONG_MATCH_SCORE) break;
  } while (pagesFetched < maxPages);

  return {
    raw,
    rawProducts,
    nextEncodedCT: nextEncodedCT || null,
    bestScore,
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
    totalPending: false,
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

function getSearchQueryVariants(query) {
  const variants = [String(query || '').trim()].filter(Boolean);
  const comparableVariant = getMeaningfulSearchTokens(query).join(' ');
  const comparableTokens = getSearchTokens(query).map(toComparableToken).filter(Boolean);
  const hasExpansionNoise = comparableTokens.some((token) => SEARCH_EXPANSION_NOISE_TOKENS.has(token));
  const distinctiveTokens = getDistinctiveSearchTokens(query);
  const distinctiveVariant = distinctiveTokens.join(' ');
  const leadDistinctiveVariant = distinctiveTokens[0] || '';

  if (
    hasExpansionNoise
    && leadDistinctiveVariant
    && normalizeSearchText(leadDistinctiveVariant) !== normalizeSearchText(query)
  ) {
    variants.push(leadDistinctiveVariant);
  }
  if (
    distinctiveVariant
    && normalizeSearchText(distinctiveVariant) !== normalizeSearchText(query)
  ) {
    variants.push(distinctiveVariant);
  }
  if (
    comparableVariant
    && normalizeSearchText(comparableVariant) !== normalizeSearchText(query)
  ) {
    variants.push(comparableVariant);
  }

  return variants.filter((value, index) => (
    value && variants.findIndex((item) => normalizeSearchText(item) === normalizeSearchText(value)) === index
  ));
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

function rankProductsBySearchRelevance(products, query) {
  return [...products]
    .map((product, index) => ({
      product,
      score: scoreSearchTitle(product.title, query, index),
      index,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(({ product }) => product);
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
  const distinctiveTokens = getDistinctiveSearchTokens(query);
  const leadDistinctiveToken = distinctiveTokens[0] || null;
  const tokensToMatch = meaningfulTokens.length ? meaningfulTokens : queryTokens;
  const matchedCount = tokensToMatch.filter((token) => titleTokens.has(toComparableToken(token))).length;
  const distinctiveMatchedCount = distinctiveTokens.filter((token) => titleTokens.has(toComparableToken(token))).length;
  const hasLeadDistinctiveToken = leadDistinctiveToken
    ? titleTokens.has(toComparableToken(leadDistinctiveToken))
    : false;
  const missingCount = Math.max(0, tokensToMatch.length - matchedCount);
  const matchRatio = tokensToMatch.length ? matchedCount / tokensToMatch.length : 0;
  const hasAllQueryTokens = tokensToMatch.length > 0 && missingCount === 0;
  let score = 0;

  if (normalizedTitle === normalizedQuery) score += 10000;
  if (titleCore && titleCore === queryCore) score += 9000;
  if (queryCore && titleCore.includes(queryCore)) score += 5000;
  if (queryCore && normalizedTitle.includes(queryCore)) score += 3000;
  if (normalizedTitle.includes(normalizedQuery)) score += 2500;
  if (queryCore && (titleCore.startsWith(queryCore) || queryCore.startsWith(titleCore))) score += 1800;
  if (hasAllQueryTokens) score += 2200;
  if (tokensToMatch.length > 1 && hasAllQueryTokens) score += 12000;
  if (tokensToMatch.length > 1 && !hasAllQueryTokens) score -= missingCount * 3500;

  score += matchRatio * 1800;
  score += matchedCount * 350;
  if (leadDistinctiveToken) score += hasLeadDistinctiveToken ? 4000 : -2000;
  score += distinctiveMatchedCount * 2500;
  if (distinctiveTokens.length > 0 && distinctiveMatchedCount === 0) score -= 2500;
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

function getDistinctiveSearchTokens(value) {
  const tokens = getSearchTokens(value)
    .map(toComparableToken)
    .filter((token) => token && !SEARCH_EXPANSION_NOISE_TOKENS.has(token));

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

function resolveSort({ query, sort }) {
  if (sort && sort !== 'DO_NOT_FILTER') return sort;
  if (!query || !String(query).trim()) return DEFAULT_BROWSE_SORT;
  return sort;
}

function shouldUseBufferedRatingSort({ sort, encodedCT }) {
  return sort === RATING_SORT && !encodedCT;
}

function isLanguageFilterActive(languageMode) {
  return Boolean(languageMode && languageMode !== 'all');
}

function getLanguageFilterTargetCount() {
  return config.xbox.pageSize;
}

async function collectRawProductsForLanguage({
  query,
  encodedFilters,
  rawProducts,
  nextEncodedCT,
  channelId,
  languageMode,
}) {
  const targetCount = getLanguageFilterTargetCount();
  let collectedRawProducts = [...rawProducts];
  let collectedNextEncodedCT = nextEncodedCT;
  let attempts = 0;

  while (
    await countLanguageFilteredProducts(collectedRawProducts, languageMode) < targetCount
    && collectedNextEncodedCT
    && attempts < LANGUAGE_FILTER_PREFETCH_MAX_PAGES
  ) {
    const nextRaw = await fetchCatalogPage({
      query,
      encodedFilters,
      encodedCT: collectedNextEncodedCT,
      returnFilters: false,
      channelId,
    });

    collectedRawProducts = [...collectedRawProducts, ...(nextRaw.products || [])];
    collectedNextEncodedCT = nextRaw.encodedCT;
    attempts += 1;
  }

  return {
    rawProducts: collectedRawProducts,
    nextEncodedCT: collectedNextEncodedCT,
  };
}

async function collectAllCatalogPages({
  query,
  encodedFilters,
  rawProducts,
  nextEncodedCT,
  channelId,
}) {
  let collectedRawProducts = [...rawProducts];
  let collectedNextEncodedCT = nextEncodedCT;
  const seenTokens = new Set();

  while (collectedNextEncodedCT && !seenTokens.has(collectedNextEncodedCT)) {
    seenTokens.add(collectedNextEncodedCT);
    const nextRaw = await fetchCatalogPage({
      query,
      encodedFilters,
      encodedCT: collectedNextEncodedCT,
      returnFilters: false,
      channelId,
    });

    collectedRawProducts = [...collectedRawProducts, ...(nextRaw.products || [])];
    collectedNextEncodedCT = nextRaw.encodedCT;
  }

  return {
    rawProducts: collectedRawProducts,
    nextEncodedCT: collectedNextEncodedCT,
  };
}

async function countFilteredSearchResults({
  raw,
  query,
  encodedFilters,
  channelId,
  languageMode,
}) {
  const collected = await collectAllCatalogPages({
    query,
    encodedFilters,
    rawProducts: raw.products || [],
    nextEncodedCT: raw.encodedCT,
    channelId,
  });

  const mappedProducts = mapProducts(dedupeRawProducts(collected.rawProducts));
  const filteredProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(mappedProducts)),
    { languageMode },
  );

  return {
    products: [],
    totalItems: filteredProducts.length,
    totalIsApproximate: false,
    totalPending: false,
    encodedCT: null,
    filters: null,
    hasMorePages: false,
  };
}

async function searchWithBufferedRatingSort({
  raw,
  query,
  encodedFilters,
  channelId,
  languageMode,
}) {
  const collected = await collectAllCatalogPages({
    query,
    encodedFilters,
    rawProducts: raw.products || [],
    nextEncodedCT: raw.encodedCT,
    channelId,
  });

  const mappedProducts = mapProducts(dedupeRawProducts(collected.rawProducts));
  const filteredProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(mappedProducts)),
    { languageMode },
  );
  const rankedProducts = sortProductsByRating(filteredProducts);
  const pageProducts = rankedProducts.slice(0, config.xbox.pageSize);
  const remainingProducts = rankedProducts.slice(config.xbox.pageSize);
  const mappedFilters = raw.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;
  const bufferedToken = remainingProducts.length
    ? writeRankedSearchBuffer({
        products: remainingProducts,
        nextExternalEncodedCT: null,
        totalItems: rankedProducts.length,
        totalIsApproximate: false,
      })
    : null;

  return {
    products: pageProducts,
    totalItems: rankedProducts.length,
    totalIsApproximate: false,
    totalPending: false,
    encodedCT: bufferedToken,
    filters: mappedFilters,
    hasMorePages: Boolean(bufferedToken),
  };
}

function sortProductsByRating(products) {
  return [...products].sort((a, b) => {
    const aAverage = Number.isFinite(a?.rating?.average) ? a.rating.average : -1;
    const bAverage = Number.isFinite(b?.rating?.average) ? b.rating.average : -1;
    if (bAverage !== aAverage) return bAverage - aAverage;

    const aCount = Number.isFinite(a?.rating?.count) ? a.rating.count : -1;
    const bCount = Number.isFinite(b?.rating?.count) ? b.rating.count : -1;
    if (bCount !== aCount) return bCount - aCount;

    const aTitle = String(a?.title || '');
    const bTitle = String(b?.title || '');
    return aTitle.localeCompare(bTitle, 'en');
  });
}

async function countLanguageFilteredProducts(rawProducts, languageMode) {
  const mappedProducts = mapProducts(dedupeRawProducts(rawProducts));
  const filteredProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(mappedProducts)),
    { languageMode },
  );
  return filteredProducts.length;
}

function applyPostFilters(products, { languageMode }) {
  return products.filter((product) => {
    if (product.notAvailableSeparately) return false;
    if (languageMode && languageMode !== 'all' && product.russianLanguageMode !== languageMode) return false;
    return true;
  });
}

async function fetchStorePageLanguageMap(products) {
  const map = new Map();
  await Promise.allSettled(products.map(async (product) => {
    const id = String(product.id || '').toUpperCase();
    if (!id) return;
    const cached = getCachedLanguageInfo(id);
    if (cached) {
      map.set(id, cached);
      return;
    }
    if (!product.storeUrl) return;
    try {
      const data = await getStorePageProductData({ productId: id, storeUrl: product.storeUrl, languageOnly: true });
      if (data.languageInfo) map.set(id, data.languageInfo);
    } catch (err) {
      logger.debug('Store page language fetch failed for catalog product', { productId: id, message: err.message });
    }
  }));
  return map;
}

async function enrichProducts(products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return products;

  const [catalogProducts, storePageLangMap] = await Promise.all([
    getProductsByIds(productIds).catch((err) => {
      logger.warn('Failed to enrich products with display catalog data', { message: err.message });
      return [];
    }),
    fetchStorePageLanguageMap(products),
  ]);

  const enriched = enrichProductsWithCatalogDetails(products, catalogProducts);
  return enriched.map((product) => {
    const storeLang = storePageLangMap.get(String(product.id || '').toUpperCase());
    if (!storeLang) return product;
    return { ...product, ...storeLang };
  });
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

function buildEncodedFilters(filters, sort) {
  const filterObj = {};
  const localFilterKeys = new Set(['LanguageMode']);

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

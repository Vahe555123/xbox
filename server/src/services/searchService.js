const crypto = require('crypto');
const catalogService = require('./xboxCatalogService');
const { getProductsByIds } = require('./displayCatalogService');
const { mapProducts, enrichProductsWithCatalogDetails } = require('../mappers/productMapper');
const { mapRelatedProducts } = require('../mappers/relatedProductMapper');
const { mapFilters, encodeFilters } = require('../mappers/filtersMapper');
const { applyProductOverrides, listSearchableProductOverrides, listSpecialOfferProductIds } = require('./productOverrideService');
const collectionsService = require('./collectionsService');
const russianIndex = require('./russianLanguageIndexService');
const saleIndexService = require('./saleIndexService');
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
const SPECIAL_OFFERS_FILTER_KEY = 'SpecialOffers';
const SPECIAL_OFFERS_FILTER_VALUE = 'Available';
const RUSSIAN_INDEX_TOKEN_PREFIX = 'rulang:';
const SPECIAL_OFFERS_TOKEN_PREFIX = 'specialoffers:';
const COLLECTION_TOKEN_PREFIX = 'collection:';
const SALE_END_TOKEN_PREFIX = 'saleend:';
const VALID_LANGUAGE_MODES = new Set(['full_ru', 'ru_subtitles', 'no_ru', 'unknown']);
const KEYWORD_MATCH_TIER_OFFSET = 3;
const SEARCH_MATCH_TIERS = {
  EXACT: 0,
  PHRASE_PREFIX: 1,
  PHRASE_CONTAINS: 2,
  ALL_TOKENS: 3,
  SOME_TOKENS: 4,
  NONE: 5,
};
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
  collection,
  countOnly = false,
  encodedCT,
  channelId = '',
}) {
  const effectiveSort = resolveSort({ query, sort });
  const collectionSlug = typeof collection === 'string' ? collection.trim() : '';
  const encodedFilters = buildEncodedFilters(filters, effectiveSort);
  const languageModes = parseLanguageModes(languageMode);
  const languageFilterActive = languageModes.size > 0;
  const specialOffersOnly = isSpecialOfferFilterActive(filters);
  const freeOnly = isFreeFilterActive(filters);
  const saleEndBefore = getSaleEndBefore(filters);
  const onSaleOnly = isOnSaleFilterActive(filters);

  if (isRankedSearchToken(encodedCT)) {
    const buffered = await readRankedSearchBuffer(encodedCT);
    if (buffered) return buffered;
  }

  // Fast path: a Russian-language-only browse is served from the precomputed index.
  if (isRussianIndexToken(encodedCT)) {
    return serveCuratedIdsPage({
      ids: russianIndex.getServingIds(languageModes),
      offset: parseCuratedOffset(encodedCT, RUSSIAN_INDEX_TOKEN_PREFIX),
      tokenPrefix: RUSSIAN_INDEX_TOKEN_PREFIX,
      languageModes,
      specialOffersOnly: false,
      applyIndexMode: true,
      sort: effectiveSort,
    });
  }

  // Fast path: sale-end-date filter pagination — served from sale_products DB table.
  if (isSaleEndToken(encodedCT)) {
    const { date, offset } = parseSaleEndToken(encodedCT);
    const ids = await saleIndexService.getProductIdsByEndDay(date);
    return serveCuratedIdsPage({
      ids,
      offset,
      tokenPrefix: `${SALE_END_TOKEN_PREFIX}${date}:`,
      languageModes,
      sort: effectiveSort,
    });
  }

  // Fast path: the "Спецпредложения" filter serves only games with a configured
  // special offer (from product overrides), straight from that list.
  if (isSpecialOffersToken(encodedCT)) {
    return serveCuratedIdsPage({
      ids: await listSpecialOfferProductIds(),
      offset: parseCuratedOffset(encodedCT, SPECIAL_OFFERS_TOKEN_PREFIX),
      tokenPrefix: SPECIAL_OFFERS_TOKEN_PREFIX,
      languageModes,
    });
  }

  // Fast path: an admin-curated collection ("Подборка") serves only its games,
  // straight from the stored snapshot (falling back to a live fetch for any
  // game missing a snapshot). Local post-filters (язык/бесплатно/спец) still apply.
  if (isCollectionToken(encodedCT)) {
    const { slug, offset } = parseCollectionToken(encodedCT);
    const ids = await collectionsService.getCollectionProductIds(slug);
    return serveCuratedIdsPage({
      ids,
      offset,
      tokenPrefix: `${COLLECTION_TOKEN_PREFIX}${slug}:`,
      languageModes,
      specialOffersOnly,
      freeOnly,
      resolveProducts: resolveCollectionProducts,
    });
  }

  if (collectionSlug) {
    const ids = await collectionsService.getCollectionProductIds(collectionSlug);
    if (countOnly) return countCuratedResults(ids);
    return serveCuratedIdsPage({
      ids,
      offset: 0,
      tokenPrefix: `${COLLECTION_TOKEN_PREFIX}${collectionSlug}:`,
      languageModes,
      specialOffersOnly,
      freeOnly,
      includeFilters: true,
      resolveProducts: resolveCollectionProducts,
    });
  }

  const onlySpecialOffers = specialOffersOnly && !languageFilterActive && !query && !hasApiSideFilters(filters);
  if (onlySpecialOffers) {
    const ids = await listSpecialOfferProductIds();
    if (countOnly) return countCuratedResults(ids);
    return serveCuratedIdsPage({
      ids,
      offset: 0,
      tokenPrefix: SPECIAL_OFFERS_TOKEN_PREFIX,
      languageModes,
      includeFilters: true,
    });
  }

  const canUseRussianIndex = languageFilterActive
    && !query
    && !hasApiSideFilters(filters)
    && [...languageModes].every((mode) => russianIndex.isReadyForMode(mode));

  if (canUseRussianIndex) {
    const ids = russianIndex.getServingIds(languageModes);
    if (countOnly) return countCuratedResults(ids);
    return serveCuratedIdsPage({
      ids,
      offset: 0,
      tokenPrefix: RUSSIAN_INDEX_TOKEN_PREFIX,
      languageModes,
      specialOffersOnly,
      applyIndexMode: true,
      includeFilters: true,
      sort: effectiveSort,
    });
  }

  // Fast path: "Скидки до <date>" — served directly from sale_products DB table.
  // Allowed alongside Price:OnSale (all index entries are on sale).
  if (canUseSaleEndIndex(saleEndBefore, filters, query, languageFilterActive)) {
    const ids = await saleIndexService.getProductIdsByEndDay(saleEndBefore);
    if (countOnly) return countCuratedResults(ids);
    return serveCuratedIdsPage({
      ids,
      offset: 0,
      tokenPrefix: `${SALE_END_TOKEN_PREFIX}${saleEndBefore}:`,
      languageModes,
      includeFilters: true,
      sort: effectiveSort,
    });
  }

  // When onSaleOnly is active, strip Price:OnSale from the API request so Xbox
  // applies only the remaining price bucket filter (e.g. <$5). Xbox treats
  // multiple Price values as OR, so leaving OnSale in would widen results to
  // include ALL discounted games regardless of price. onSaleOnly is then
  // enforced locally by applyPostFilters.
  const browseFilters = onSaleOnly
    ? buildEncodedFilters(
        { ...filters, Price: (filters?.Price || []).filter((v) => v !== 'OnSale') },
        effectiveSort,
      )
    : encodedFilters;

  let raw;
  try {
    if (!countOnly && shouldUseSearchRerank({ query, sort: effectiveSort, encodedCT })) {
      return await searchWithRelevanceRerank({
        query,
        encodedFilters: browseFilters,
        languageMode,
        channelId,
        specialOffersOnly,
        freeOnly,
        saleEndBefore,
        onSaleOnly,
      });
    }

    raw = await fetchCatalogPage({
      query,
      encodedFilters: browseFilters,
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
      encodedFilters: browseFilters,
      channelId,
      languageMode,
      specialOffersOnly,
      freeOnly,
      saleEndBefore,
    });
  }

  let rawProducts = raw.products || [];
  let nextEncodedCT = raw.encodedCT;

  if (languageFilterActive) {
    const collected = await collectRawProductsForLanguage({
      query,
      encodedFilters: browseFilters,
      rawProducts,
      nextEncodedCT,
      channelId,
      languageMode,
      specialOffersOnly,
      freeOnly,
      saleEndBefore,
    });

    rawProducts = collected.rawProducts;
    nextEncodedCT = collected.nextEncodedCT;
  }

  const products = mapProducts(rawProducts);
  let enrichedProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(products)),
    { languageMode, specialOffersOnly, freeOnly, saleEndBefore, onSaleOnly },
  );

  // When free games crowd out paid games on a page (e.g. Price asc puts free games first),
  // accumulate paid games across multiple pages until we have a full page worth.
  // Trigger only when more than half the raw page was filtered — avoids extra requests
  // on normal sorts where nearly all products survive the filter.
  const PAGE_SIZE = config.xbox.pageSize;
  const initialRawCount = rawProducts.length;
  const MAX_SKIP_PAGES = 20;
  let skipAttempts = 0;
  while (
    !languageFilterActive
    && nextEncodedCT
    && skipAttempts < MAX_SKIP_PAGES
    && enrichedProducts.length < PAGE_SIZE
    && (skipAttempts > 0 || enrichedProducts.length * 2 < initialRawCount)
  ) {
    skipAttempts += 1;
    // eslint-disable-next-line no-await-in-loop
    const nextRaw = await fetchCatalogPage({
      query,
      encodedFilters: browseFilters,
      encodedCT: nextEncodedCT,
      returnFilters: false,
      channelId,
    });
    nextEncodedCT = nextRaw.encodedCT;
    // eslint-disable-next-line no-await-in-loop
    const nextEnriched = applyPostFilters(
      // eslint-disable-next-line no-await-in-loop
      await applyProductOverrides(await enrichProducts(mapProducts(nextRaw.products || []))),
      { languageMode, specialOffersOnly, freeOnly, saleEndBefore, onSaleOnly },
    );
    enrichedProducts = [...enrichedProducts, ...nextEnriched];
  }
  const extraKeywordProducts = query
    ? await loadOverrideKeywordProducts(query, enrichedProducts, { languageMode, specialOffersOnly, freeOnly, saleEndBefore, onSaleOnly })
    : [];
  const mappedFilters = raw.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;
  const mergedProducts = mergeProductsById(enrichedProducts, extraKeywordProducts);
  const totalItems = languageFilterActive
    ? null
    : Number.isFinite(raw?.totalItems)
      ? raw.totalItems + extraKeywordProducts.length
      : raw?.totalItems;

  return {
    products: mergedProducts,
    totalItems,
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
  specialOffersOnly,
  freeOnly,
  saleEndBefore = null,
  onSaleOnly = false,
}) {
  const collectedRawProducts = [];
  const queryVariants = getSearchQueryVariants(query);
  let raw = null;
  let nextEncodedCT = null;
  let bestMatchTier = SEARCH_MATCH_TIERS.NONE;

  for (const [index, searchQuery] of queryVariants.entries()) {
    const result = await collectSearchPagesForRerank({
      searchQuery,
      scoreQuery: query,
      encodedFilters,
      channelId,
      returnFilters: index === 0,
      maxPages: index === 0
        ? SEARCH_RERANK_MAX_PAGES
        : Math.max(1, Math.ceil(SEARCH_RERANK_MAX_PAGES / 2)),
    });

    collectedRawProducts.push(...result.rawProducts);
    bestMatchTier = Math.min(bestMatchTier, result.bestMatchTier);

    if (index === 0) {
      raw = result.raw;
      nextEncodedCT = result.nextEncodedCT;
    }

    if (bestMatchTier === SEARCH_MATCH_TIERS.EXACT) break;
  }

  const mappedProducts = mapProducts(dedupeRawProducts(collectedRawProducts));
  const enrichedProducts = applyPostFilters(await applyProductOverrides(await enrichProducts(mappedProducts)), {
    languageMode,
    specialOffersOnly,
    freeOnly,
    saleEndBefore,
    onSaleOnly,
  });
  const extraKeywordProducts = await loadOverrideKeywordProducts(query, enrichedProducts, {
    languageMode,
    specialOffersOnly,
    freeOnly,
    saleEndBefore,
    onSaleOnly,
  });
  const rankedProducts = rankProductsBySearchRelevance(
    mergeProductsById(enrichedProducts, extraKeywordProducts),
    query,
  );
  const pageProducts = rankedProducts.slice(0, config.xbox.pageSize);
  const remainingProducts = rankedProducts.slice(config.xbox.pageSize);
  const mappedFilters = raw?.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;
  const languageFilterActive = isLanguageFilterActive(languageMode);

  // When all Xbox API pages have been consumed (nextEncodedCT is null), we know
  // the exact post-filter count. Use it instead of the raw Xbox total, which
  // inflates the number by including free/unavailable products we hide.
  const allPagesFetched = !nextEncodedCT;
  const resolvedTotal = languageFilterActive
    ? null
    : allPagesFetched
      ? rankedProducts.length
      : Number.isFinite(raw?.totalItems)
        ? raw.totalItems + extraKeywordProducts.length
        : raw?.totalItems;

  const bufferedToken = remainingProducts.length
    ? writeRankedSearchBuffer({
        products: remainingProducts,
        nextExternalEncodedCT: nextEncodedCT || null,
        totalItems: resolvedTotal,
        totalIsApproximate: languageFilterActive,
      })
    : nextEncodedCT || null;

  return {
    products: pageProducts,
    totalItems: resolvedTotal,
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
  let bestMatchTier = SEARCH_MATCH_TIERS.NONE;

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
    bestMatchTier = Math.min(bestMatchTier, bestRawSearchMatchTier(rawProducts, scoreQuery));

    if (!nextEncodedCT) break;
    if (getMeaningfulSearchTokens(scoreQuery).length < 2) break;
    if (bestMatchTier === SEARCH_MATCH_TIERS.EXACT) break;
  } while (pagesFetched < maxPages);

  return {
    raw,
    rawProducts,
    nextEncodedCT: nextEncodedCT || null,
    bestMatchTier,
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

function bestRawSearchMatchTier(rawProducts, query) {
  return (rawProducts || []).reduce((bestTier, item) => (
    Math.min(bestTier, getSearchMatchTier(item?.summary?.title, query))
  ), SEARCH_MATCH_TIERS.NONE);
}

async function loadOverrideKeywordProducts(query, existingProducts, { languageMode, specialOffersOnly, freeOnly, saleEndBefore = null, onSaleOnly = false }) {
  const overrides = await listSearchableProductOverrides();
  if (!overrides.length) return [];

  const seenIds = new Set((existingProducts || []).map((product) => String(product?.id || '').toUpperCase()).filter(Boolean));
  const matchedOverrides = overrides
    .map((override) => {
      const keywordMatch = getBestKeywordMatch(override.searchKeywords, query);
      if (keywordMatch.tier === SEARCH_MATCH_TIERS.NONE) return null;
      return {
        productId: String(override.productId || '').toUpperCase(),
        tier: keywordMatch.tier,
        score: keywordMatch.score,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (b.score !== a.score) return b.score - a.score;
      return a.productId.localeCompare(b.productId);
    });

  const missingIds = matchedOverrides
    .map((item) => item.productId)
    .filter((productId) => !seenIds.has(productId));

  if (!missingIds.length) return [];

  const rawProducts = await getProductsByIds(missingIds, {
    allowPartial: true,
    context: 'search-keyword-overrides',
  }).catch((err) => {
    logger.warn('Failed to load override keyword products', {
      count: missingIds.length,
      message: err.message,
    });
    return [];
  });
  if (!rawProducts.length) return [];

  const mappedProducts = mapRelatedProducts(rawProducts, {});
  const enrichedProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(mappedProducts)),
    { languageMode, specialOffersOnly, freeOnly, saleEndBefore, onSaleOnly },
  );
  const productsById = new Map(
    enrichedProducts.map((product) => [String(product?.id || '').toUpperCase(), product]),
  );

  return matchedOverrides
    .map((item) => productsById.get(item.productId))
    .filter(Boolean);
}

function rankProductsBySearchRelevance(products, query) {
  return [...products]
    .map((product, index) => ({
      product,
      matchTier: getProductSearchMatchTier(product, query),
      score: getProductSearchScore(product, query, index),
      index,
    }))
    .sort((a, b) => {
      if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map(({ product }) => product);
}

function getProductSearchMatchTier(product, query) {
  const titleTier = getSearchMatchTier(product?.title, query);
  if (titleTier !== SEARCH_MATCH_TIERS.NONE) return titleTier;

  const keywordTier = getBestKeywordMatch(product?.searchKeywords, query).tier;
  if (keywordTier === SEARCH_MATCH_TIERS.NONE) return SEARCH_MATCH_TIERS.NONE;

  return keywordTier + KEYWORD_MATCH_TIER_OFFSET;
}

function getProductSearchScore(product, query, originalIndex = 0) {
  const titleTier = getSearchMatchTier(product?.title, query);
  if (titleTier !== SEARCH_MATCH_TIERS.NONE) {
    return scoreSearchTitle(product?.title, query, originalIndex);
  }

  const keywordMatch = getBestKeywordMatch(product?.searchKeywords, query);
  if (keywordMatch.tier === SEARCH_MATCH_TIERS.NONE) return 0;

  return keywordMatch.score - 1800 - originalIndex * 0.01;
}

function getBestKeywordMatch(searchKeywords, query) {
  const keywords = Array.isArray(searchKeywords)
    ? searchKeywords
    : [];

  return keywords.reduce((best, keyword) => {
    const tier = getSearchMatchTier(keyword, query);
    if (tier === SEARCH_MATCH_TIERS.NONE) return best;

    const score = scoreSearchTitle(keyword, query, 0);
    if (tier < best.tier) {
      return { tier, score };
    }
    if (tier === best.tier && score > best.score) {
      return { tier, score };
    }
    return best;
  }, { tier: SEARCH_MATCH_TIERS.NONE, score: 0 });
}

function getSearchMatchTier(title, query) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedTitle || !normalizedQuery) return SEARCH_MATCH_TIERS.NONE;

  const meaningfulTokens = getMeaningfulSearchTokens(query);
  const titleCore = getMeaningfulSearchTokens(title).join(' ');
  const queryCore = meaningfulTokens.join(' ');
  const queryTokens = getSearchTokens(query);
  const titleTokens = getComparableTokenSet(title);
  const tokensToMatch = meaningfulTokens.length ? meaningfulTokens : queryTokens;
  const matchedCount = tokensToMatch.filter((token) => titleTokens.has(toComparableToken(token))).length;
  const hasAllQueryTokens = tokensToMatch.length > 0 && matchedCount === tokensToMatch.length;

  if (normalizedTitle === normalizedQuery) return SEARCH_MATCH_TIERS.EXACT;
  if (titleCore && queryCore && titleCore === queryCore) return SEARCH_MATCH_TIERS.EXACT;
  if (queryCore && titleCore && titleCore.startsWith(queryCore)) return SEARCH_MATCH_TIERS.PHRASE_PREFIX;
  if (queryCore && titleCore && titleCore.includes(queryCore)) return SEARCH_MATCH_TIERS.PHRASE_CONTAINS;
  if (normalizedTitle.includes(normalizedQuery)) return SEARCH_MATCH_TIERS.PHRASE_CONTAINS;
  if (hasAllQueryTokens) return SEARCH_MATCH_TIERS.ALL_TOKENS;
  if (matchedCount > 0) return SEARCH_MATCH_TIERS.SOME_TOKENS;
  return SEARCH_MATCH_TIERS.NONE;
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
    .replace(/[^a-z0-9Ѐ-ӿ]+/gi, ' ')
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

function isLanguageFilterActive(languageMode) {
  return parseLanguageModes(languageMode).size > 0;
}

function parseLanguageModes(languageMode) {
  const modes = new Set();
  const source = Array.isArray(languageMode) ? languageMode : String(languageMode || '').split(',');
  for (const part of source) {
    const value = String(part || '').trim();
    if (VALID_LANGUAGE_MODES.has(value)) modes.add(value);
  }
  return modes;
}

function hasApiSideFilters(filters) {
  if (!filters || typeof filters !== 'object') return false;
  return Object.entries(filters).some(([key, values]) => {
    if (key === 'LanguageMode' || key === SPECIAL_OFFERS_FILTER_KEY) return false;
    return Array.isArray(values) ? values.length > 0 : Boolean(values);
  });
}

function resolveProductRussianMode(product) {
  // A manual admin override is authoritative.
  if (product.languageOverride && product.russianLanguageMode) return product.russianLanguageMode;
  const indexMode = russianIndex.getModeForProduct(product.id);
  if (indexMode) return indexMode;
  return product.russianLanguageMode || 'unknown';
}

function matchesLanguageModes(product, modes) {
  const mode = resolveProductRussianMode(product);
  if (modes.has('ru_subtitles') && (mode === 'ru_subtitles' || mode === 'full_ru')) return true;
  if (modes.has('full_ru') && mode === 'full_ru') return true;
  if (modes.has('no_ru') && (mode === 'no_ru' || mode === 'unknown')) return true;
  if (modes.has('unknown') && mode === 'unknown') return true;
  return false;
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
  specialOffersOnly,
  freeOnly,
  saleEndBefore = null,
}) {
  const targetCount = getLanguageFilterTargetCount();
  let collectedRawProducts = [...rawProducts];
  let collectedNextEncodedCT = nextEncodedCT;
  let attempts = 0;

  while (
    await countLanguageFilteredProducts(collectedRawProducts, languageMode, specialOffersOnly, freeOnly, saleEndBefore) < targetCount
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
  specialOffersOnly,
  freeOnly,
  saleEndBefore = null,
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
    { languageMode, specialOffersOnly, freeOnly, saleEndBefore },
  );
  const extraKeywordProducts = query
    ? await loadOverrideKeywordProducts(query, filteredProducts, { languageMode, specialOffersOnly, freeOnly, saleEndBefore })
    : [];
  const mergedProducts = mergeProductsById(filteredProducts, extraKeywordProducts);

  return {
    products: [],
    totalItems: mergedProducts.length,
    totalIsApproximate: false,
    totalPending: false,
    encodedCT: null,
    filters: null,
    hasMorePages: false,
  };
}

async function countLanguageFilteredProducts(rawProducts, languageMode, specialOffersOnly = false, freeOnly = false, saleEndBefore = null) {
  const mappedProducts = mapProducts(dedupeRawProducts(rawProducts));
  const filteredProducts = applyPostFilters(
    await applyProductOverrides(await enrichProducts(mappedProducts)),
    { languageMode, specialOffersOnly, freeOnly, saleEndBefore },
  );
  return filteredProducts.length;
}

function isRussianIndexToken(value) {
  return typeof value === 'string' && value.startsWith(RUSSIAN_INDEX_TOKEN_PREFIX);
}

function isSpecialOffersToken(value) {
  return typeof value === 'string' && value.startsWith(SPECIAL_OFFERS_TOKEN_PREFIX);
}

function isCollectionToken(value) {
  return typeof value === 'string' && value.startsWith(COLLECTION_TOKEN_PREFIX);
}

function isSaleEndToken(value) {
  return typeof value === 'string' && value.startsWith(SALE_END_TOKEN_PREFIX);
}

// Token format: saleend:<YYYY-MM-DD>:<offset>
function parseSaleEndToken(token) {
  const rest = String(token || '').slice(SALE_END_TOKEN_PREFIX.length);
  const idx = rest.lastIndexOf(':');
  if (idx < 0) return { date: rest, offset: 0 };
  const date = rest.slice(0, idx);
  const offset = parseInt(rest.slice(idx + 1), 10);
  return { date, offset: Number.isFinite(offset) && offset > 0 ? offset : 0 };
}

// Use the sale-products DB index when only SaleEndBefore (and optionally Price:OnSale) is active.
function canUseSaleEndIndex(saleEndBefore, filters, query, languageFilterActive) {
  if (!saleEndBefore || query || languageFilterActive) return false;
  for (const [key, values] of Object.entries(filters || {})) {
    if (key === 'SaleEndBefore' || key === 'LanguageMode') continue;
    if (key === 'Price' && Array.isArray(values) && values.every((v) => v === 'OnSale')) continue;
    if (Array.isArray(values) ? values.length > 0 : Boolean(values)) return false;
  }
  return true;
}

// Token format: collection:<slug>:<offset>
function parseCollectionToken(token) {
  const rest = String(token || '').slice(COLLECTION_TOKEN_PREFIX.length);
  const idx = rest.lastIndexOf(':');
  if (idx < 0) return { slug: rest, offset: 0 };
  const slug = rest.slice(0, idx);
  const offset = parseInt(rest.slice(idx + 1), 10);
  return { slug, offset: Number.isFinite(offset) && offset > 0 ? offset : 0 };
}

// Resolve collection product cards from the DB snapshot, falling back to a live
// catalog fetch for any IDs missing a snapshot. Returns mapped cards in input order.
async function resolveCollectionProducts(sliceIds) {
  const snapshots = await collectionsService.getSnapshotProducts(sliceIds).catch(() => new Map());
  const missing = sliceIds.filter((id) => !snapshots.has(String(id).toUpperCase()));
  let built = [];
  if (missing.length) {
    built = await collectionsService.buildCardsForIds(missing).catch(() => []);
  }
  const builtById = new Map(built.map((card) => [String(card.id).toUpperCase(), card]));
  const result = [];
  for (const id of sliceIds) {
    const key = String(id).toUpperCase();
    const card = snapshots.get(key) || builtById.get(key);
    if (card) result.push(card);
  }
  return result;
}

function parseCuratedOffset(token, prefix) {
  const parsed = parseInt(String(token || '').slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function countCuratedResults(ids) {
  return {
    products: [],
    totalItems: ids.length,
    totalIsApproximate: false,
    totalPending: false,
    encodedCT: null,
    filters: null,
    hasMorePages: false,
  };
}

function sortProductsLocally(products, sort) {
  const sorted = [...products];
  if (sort === 'Price asc') {
    sorted.sort((a, b) => (a.price?.value ?? Infinity) - (b.price?.value ?? Infinity));
  } else if (sort === 'Price desc') {
    sorted.sort((a, b) => (b.price?.value ?? -Infinity) - (a.price?.value ?? -Infinity));
  } else if (sort === 'Title Asc') {
    sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
  } else if (sort === 'Title Desc') {
    sorted.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'ru'));
  } else if (sort === 'ReleaseDate desc') {
    sorted.sort((a, b) => {
      const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
      const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
      return db - da;
    });
  } else if (sort === 'DiscountPercentage desc') {
    sorted.sort((a, b) => (b.price?.discountPercent ?? 0) - (a.price?.discountPercent ?? 0));
  }
  return sorted;
}

/**
 * Serve a page of products from a precomputed list of product IDs (Russian-language
 * index, or special-offer overrides). Paginated via an offset token. Fast: one
 * display-catalog batch per page, exact total.
 */
async function serveCuratedIdsPage({
  ids,
  offset = 0,
  tokenPrefix,
  languageModes,
  specialOffersOnly = false,
  freeOnly = false,
  applyIndexMode = false,
  includeFilters = false,
  resolveProducts = null,
  sort = null,
}) {
  const pageSize = config.xbox.pageSize;
  const slice = ids.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  const hasMore = nextOffset < ids.length;

  let products = [];
  if (slice.length) {
    let mapped;
    if (resolveProducts) {
      // Caller supplies pre-mapped cards (e.g. collection snapshot); overrides
      // are already applied at snapshot-build time.
      mapped = await resolveProducts(slice).catch((err) => {
        logger.warn('Curated ids resolve failed', { count: slice.length, message: err.message });
        return [];
      });
    } else {
      const rawProducts = await getProductsByIds(slice, { allowPartial: true, context: 'curated-ids-page' })
        .catch((err) => {
          logger.warn('Curated ids page fetch failed', { count: slice.length, message: err.message });
          return [];
        });
      mapped = mapRelatedProducts(rawProducts, {});
      await applyProductOverrides(mapped).catch(() => {});
    }
    if (applyIndexMode) {
      for (const product of mapped) {
        const mode = russianIndex.getModeForProduct(product.id);
        if (mode) {
          product.russianLanguageMode = mode;
          product.hasRussianLanguage = true;
        }
      }
    }
    const order = new Map(slice.map((id, index) => [String(id).toUpperCase(), index]));
    const filtered = applyPostFilters(mapped, {
      languageMode: languageModes ? [...languageModes].join(',') : '',
      specialOffersOnly,
      freeOnly,
    });
    if (sort && sort !== DEFAULT_BROWSE_SORT && sort !== 'MostPopular desc') {
      products = sortProductsLocally(filtered, sort);
    } else {
      products = filtered.sort((a, b) => (
        (order.get(String(a.id).toUpperCase()) ?? 0) - (order.get(String(b.id).toUpperCase()) ?? 0)
      ));
    }
  }

  let filters = null;
  if (includeFilters) {
    const filterRaw = await fetchCatalogPage({
      query: '',
      encodedFilters: '',
      encodedCT: '',
      returnFilters: true,
      channelId: '',
    }).catch(() => null);
    filters = filterRaw?.filters && Object.keys(filterRaw.filters).length > 0
      ? mapFilters(filterRaw.filters)
      : null;
  }

  return {
    products,
    totalItems: ids.length,
    totalIsApproximate: true,
    totalPending: false,
    encodedCT: hasMore ? `${tokenPrefix}${nextOffset}` : null,
    filters,
    hasMorePages: hasMore,
  };
}

function applyPostFilters(products, { languageMode, specialOffersOnly, freeOnly = false, saleEndBefore = null, onSaleOnly = false }) {
  const languageModes = parseLanguageModes(languageMode);
  return products.filter((product) => {
    if (product.notAvailableSeparately) return false;
    // Free games are hidden from the catalog by default, but shown when the
    // "Бесплатно" filter is active.
    if (product.price?.value === 0 && !freeOnly) return false;
    if (languageModes.size) {
      if (!matchesLanguageModes(product, languageModes)) return false;
      const pv = product.price?.value;
      if (pv == null || !Number.isFinite(pv)) return false;
    }
    // "Спецпредложения": only games that actually have a configured special offer.
    if (specialOffersOnly && !product.specialOfferUrl) return false;
    // "Скидки" (search mode only): keep games with regular discount OR Game Pass savings.
    if (onSaleOnly && !product.price?.discountPercent && !product.gamePassSavingsPercent) return false;
    // Sale end date: keep only games whose discount ends exactly on the chosen
    // date (Moscow time, UTC+3 — matches what the product card displays).
    if (saleEndBefore !== null) {
      const endDate = product.price?.dealEndDate;
      const endMs = endDate ? Date.parse(endDate) : NaN;
      const endDay = Number.isFinite(endMs)
        ? new Date(endMs + 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null;
      if (endDay !== saleEndBefore) return false;
    }
    return true;
  });
}

/**
 * Enrich browse/search products with display-catalog details and the precomputed
 * Russian-language index. The index (built in the background) is authoritative for
 * the "Полностью на русском" vs "Русские субтитры" distinction, so we never need a
 * slow per-product xbox.com store-page fetch on the hot path.
 */
async function enrichProducts(products) {
  const productIds = products.map((product) => product.id).filter(Boolean);
  if (!productIds.length) return products;

  const catalogProducts = await getProductsByIds(productIds).catch((err) => {
    logger.warn('Failed to enrich products with display catalog data', { message: err.message });
    return [];
  });

  const enriched = enrichProductsWithCatalogDetails(products, catalogProducts);
  return enriched.map(applyIndexLanguageMode);
}

function applyIndexLanguageMode(product) {
  const mode = russianIndex.getModeForProduct(product.id);
  if (mode === 'full_ru' || mode === 'ru_subtitles') {
    return { ...product, russianLanguageMode: mode, hasRussianLanguage: true };
  }
  if (mode === 'no_ru') {
    if (product.russianLanguageMode === 'unknown') {
      // Catalog has no language data — keep 'unknown' so catalog and detail page match.
      return { ...product, hasRussianLanguage: false };
    }
    return { ...product, russianLanguageMode: 'no_ru', hasRussianLanguage: false };
  }
  // Not classified by the index yet — the display-catalog language list is
  // unreliable (it reports Russian for almost everything), so show "unknown"
  // instead of a wrong "Русские субтитры" badge.
  return { ...product, russianLanguageMode: 'unknown', hasRussianLanguage: false };
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
  const localFilterKeys = new Set(['LanguageMode', SPECIAL_OFFERS_FILTER_KEY, 'SaleEndBefore']);

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

function isSpecialOfferFilterActive(filters) {
  return Boolean(filters?.[SPECIAL_OFFERS_FILTER_KEY]?.includes(SPECIAL_OFFERS_FILTER_VALUE));
}

function isFreeFilterActive(filters) {
  return Boolean(filters?.Price?.includes('Free'));
}

function isOnSaleFilterActive(filters) {
  return Boolean(filters?.Price?.includes('OnSale'));
}

function getSaleEndBefore(filters) {
  const v = filters?.SaleEndBefore?.[0];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function mergeProductsById(...groups) {
  const seen = new Set();
  const result = [];

  for (const group of groups) {
    for (const product of group || []) {
      const id = String(product?.id || '').toUpperCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push(product);
    }
  }

  return result;
}

module.exports = { search };

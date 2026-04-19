const catalogService = require('./xboxCatalogService');
const { mapProducts } = require('../mappers/productMapper');
const { mapFilters, encodeFilters } = require('../mappers/filtersMapper');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Main search/browse orchestrator.
 * - If query is provided, uses the search endpoint (exact Xbox.com search behavior)
 * - If no query, uses the browse endpoint (full catalog, 16K+ games)
 * - Supports filters and pagination via encodedCT
 */
async function search({ query, page, sort, filters, priceRange, encodedCT, channelId = '' }) {
  const encodedFilters = buildEncodedFilters(filters, sort);
  const priceFilterActive = isPriceRangeActive(priceRange);

  let raw;
  try {
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

  const products = priceFilterActive
    ? applyPriceRange(mapProducts(rawProducts), priceRange)
    : mapProducts(rawProducts);
  const mappedFilters = raw.filters && Object.keys(raw.filters).length > 0
    ? mapFilters(raw.filters)
    : null;

  return {
    products,
    totalItems: priceFilterActive ? products.length : raw.totalItems,
    totalIsApproximate: priceFilterActive,
    encodedCT: nextEncodedCT,
    filters: mappedFilters,
    hasMorePages: !!nextEncodedCT,
  };
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

  if (filters && typeof filters === 'object') {
    for (const [key, values] of Object.entries(filters)) {
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

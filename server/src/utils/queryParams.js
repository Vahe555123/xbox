function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSearchParams(query) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const sort = typeof query.sort === 'string' ? query.sort.trim() : '';
  const encodedCT = typeof query.encodedCT === 'string' ? query.encodedCT.trim() : '';
  const minPrice = parseOptionalNumber(query.minPrice);
  const maxPrice = parseOptionalNumber(query.maxPrice);
  const priceCurrency = String(query.priceCurrency || 'USD').toUpperCase() === 'RUB' ? 'RUB' : 'USD';
  const languageMode = typeof query.languageMode === 'string' ? query.languageMode.trim() : '';

  let filters = {};
  if (query.filters) {
    try {
      filters = typeof query.filters === 'string' ? JSON.parse(query.filters) : query.filters;
    } catch {
      filters = {};
    }
  }

  // Also accept individual filter params like ?Genre=Shooter,Action&PlayWith=PC
  const FILTER_KEYS = [
    'PlayWith', 'Accessibility', 'Price', 'Genre', 'MaturityRating',
    'Multiplayer', 'TechnicalFeatures', 'SupportedLanguages',
    'IncludedInSubscription', 'HandheldCompatibility',
  ];

  for (const key of FILTER_KEYS) {
    if (query[key] && !filters[key]) {
      const val = query[key];
      filters[key] = typeof val === 'string' ? val.split(',').map((v) => v.trim()).filter(Boolean) : val;
    }
  }

  const deals = query.deals === 'true' || query.deals === '1';
  const freeOnly = query.freeOnly === 'true' || query.freeOnly === '1';
  const countOnly = query.countOnly === 'true' || query.countOnly === '1';

  return {
    query: q,
    page,
    sort,
    filters,
    priceRange: { min: minPrice, max: maxPrice, currency: priceCurrency },
    languageMode,
    encodedCT,
    deals,
    freeOnly,
    countOnly,
  };
}

module.exports = { parseSearchParams };

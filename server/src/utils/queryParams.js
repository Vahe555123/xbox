function parseFilterValues(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || '').split(','))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSearchParams(query) {
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const sort = typeof query.sort === 'string' ? query.sort.trim() : '';
  const encodedCT = typeof query.encodedCT === 'string' ? query.encodedCT.trim() : '';
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
    'IncludedInSubscription', 'HandheldCompatibility', 'SpecialOffers',
  ];

  for (const key of FILTER_KEYS) {
    if (query[key] && !filters[key]) {
      const values = parseFilterValues(query[key]);
      if (values.length > 0) {
        filters[key] = values;
      }
    }
  }

  const countOnly = query.countOnly === 'true' || query.countOnly === '1';

  return {
    query: q,
    page,
    sort,
    filters,
    languageMode,
    encodedCT,
    countOnly,
  };
}

module.exports = { parseSearchParams };

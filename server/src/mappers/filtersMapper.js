/**
 * Maps the raw Emerald API filters to a normalized format.
 * The API returns filters under a key like "Browse" with categories:
 * orderby, PlayWith, Accessibility, Price, Genre, MaturityRating,
 * Multiplayer, TechnicalFeatures, SupportedLanguages, IncludedInSubscription, HandheldCompatibility
 */
function mapFilters(rawFilters) {
  if (!rawFilters || typeof rawFilters !== 'object') {
    return getDefaultFilters();
  }

  const filterSource = rawFilters.Browse || rawFilters.Search || rawFilters;

  const result = {};
  for (const [key, filter] of Object.entries(filterSource)) {
    if (!filter || typeof filter !== 'object') continue;

    result[key] = {
      id: filter.id || key,
      title: filter.title || key,
      isMultiSelect: filter.isMultiSelect ?? (key !== 'orderby'),
      truncatedDisplayCount: filter.truncatedDisplayCount || null,
      hasAllChoice: filter.hasAllChoice || false,
      allChoiceId: filter.allChoiceId || null,
      choices: (filter.choices || []).map((choice) => ({
        id: choice.id,
        title: choice.title || choice.id,
        isLabelOnly: choice.isLabelOnly || false,
      })),
    };
  }

  return result;
}

function getDefaultFilters() {
  return {
    orderby: {
      id: 'orderby',
      title: 'Sort by',
      isMultiSelect: false,
      choices: [
        { id: 'DO_NOT_FILTER', title: 'Relevance' },
        { id: 'ReleaseDate desc', title: 'Release date: newest-oldest' },
        { id: 'WishlistCountTotal desc', title: 'Popular' },
        { id: 'MostPopular desc', title: 'Top rated' },
        { id: 'Price asc', title: 'Price: low-high' },
        { id: 'Price desc', title: 'Price: high-low' },
        { id: 'Title Asc', title: 'Title: A-Z' },
        { id: 'Title Desc', title: 'Title: Z-A' },
      ],
    },
  };
}

/**
 * Encode filter selections to base64 format expected by the Emerald API.
 * Input: { Genre: ['Shooter', 'Action'], PlayWith: ['PC'] }
 * Output: base64 encoded JSON
 */
function encodeFilters(filterSelections) {
  if (!filterSelections || Object.keys(filterSelections).length === 0) {
    return '';
  }

  const encoded = {};
  for (const [key, values] of Object.entries(filterSelections)) {
    if (!values || (Array.isArray(values) && values.length === 0)) continue;

    const choices = Array.isArray(values) ? values : [values];
    encoded[key] = {
      id: key,
      choices: choices.map((v) => ({ id: v })),
    };
  }

  if (Object.keys(encoded).length === 0) return '';
  return Buffer.from(JSON.stringify(encoded)).toString('base64');
}

module.exports = { mapFilters, encodeFilters, getDefaultFilters };

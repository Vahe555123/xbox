const config = require('../config');
const { createAxiosClient, withRetry } = require('../utils/axiosClient');
const cache = require('../utils/cache');

const client = createAxiosClient('https://www.xbox.com');
const LANGUAGE_CACHE_TTL = 12 * 3600;
const STORE_PAGE_CACHE_TTL = 12 * 3600;
const DESCRIPTION_CACHE_TTL = 12 * 3600;
const inflight = new Map();

const RELATED_CHANNELS = [
  { prefix: 'PRODUCTADDONS', relationshipType: 'ProductAddOns', limit: 24 },
  { prefix: 'MORELIKE', relationshipType: 'MoreLike', limit: 25 },
];

async function getStorePageRelatedProducts({ productId, storeUrl }) {
  const data = await getStorePageProductData({ productId, storeUrl });
  return data.relatedProducts;
}

async function getStorePageProductData({ productId, storeUrl, languageOnly = false }) {
  if (!productId || !storeUrl) return { relatedProducts: [], languageInfo: null };
  const normalizedProductId = String(productId).toUpperCase();
  const fullCacheKey = `xbox-store-page-product:${normalizedProductId}`;
  const cachedFull = cache.get(fullCacheKey);
  if (cachedFull) return cachedFull;

  if (languageOnly) {
    const cachedLang = cache.get(`xbox-store-language:${normalizedProductId}`);
    if (cachedLang) {
      return { relatedProducts: [], languageInfo: cachedLang };
    }
  }

  const inflightKey = `${languageOnly ? 'lang' : 'full'}:${normalizedProductId}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const promise = (async () => {
    const state = await fetchStoreStateForLocale(storeUrl, config.xbox.language || 'en-US');
    const channelData = state?.core2?.channels?.channelData || {};
    const productSummaries = state?.core2?.products?.productSummaries || {};
    const productSummary = getCaseInsensitiveValue(productSummaries, normalizedProductId);
    const languageInfo = extractStoreLanguageInfo(productSummary);

    if (languageInfo) {
      cache.set(`xbox-store-language:${normalizedProductId}`, languageInfo, LANGUAGE_CACHE_TTL);
    }

    if (languageOnly) {
      return { relatedProducts: [], languageInfo };
    }

    const products = [];
    const seen = new Set([normalizedProductId]);

    for (const channel of RELATED_CHANNELS) {
      const channelProducts = getChannelProductIds(channelData, channel.prefix, normalizedProductId)
        .filter((id) => {
          const normalizedId = String(id).toUpperCase();
          if (seen.has(normalizedId)) return false;
          seen.add(normalizedId);
          return true;
        })
        .slice(0, channel.limit)
        .map((id) => ({
          productId: id,
          relationshipType: channel.relationshipType,
        }));

      products.push(...channelProducts);
    }

    const data = {
      relatedProducts: products,
      languageInfo,
      categories: extractStoreCategories(productSummary),
      description: extractStoreDescriptionWithSource(productSummary, config.xbox.language || 'en-US'),
      bundleItems: extractBundleItems(channelData, productSummaries, normalizedProductId),
      compareEditionItems: extractCompareEditionItems(channelData, productSummaries, normalizedProductId),
    };
    cache.set(fullCacheKey, data, STORE_PAGE_CACHE_TTL);
    return data;
  })().finally(() => {
    inflight.delete(inflightKey);
  });

  inflight.set(inflightKey, promise);
  return promise;
}

async function getStoreLocalizedDescription({
  productId,
  storeUrl,
  locale = 'ru-UA',
  fallbackLocale = config.xbox.language || 'en-US',
} = {}) {
  if (!productId || !storeUrl) {
    return { fullDescription: null, shortDescription: null, source: null };
  }

  const normalizedProductId = String(productId).toUpperCase();
  const cacheKey = `xbox-store-description:${normalizedProductId}:${locale}:${fallbackLocale}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const inflightKey = `description:${normalizedProductId}:${locale}:${fallbackLocale}`;
  if (inflight.has(inflightKey)) return inflight.get(inflightKey);

  const promise = (async () => {
    const localizedState = await fetchStoreStateForLocale(storeUrl, locale).catch(() => null);
    const localizedSummary = getCaseInsensitiveValue(
      localizedState?.core2?.products?.productSummaries || {},
      normalizedProductId,
    );
    const localizedDescription = extractStoreDescriptionWithSource(localizedSummary, locale);

    if (localizedDescription.fullDescription || localizedDescription.shortDescription) {
      cache.set(cacheKey, localizedDescription, DESCRIPTION_CACHE_TTL);
      return localizedDescription;
    }

    if (!fallbackLocale || fallbackLocale === locale) {
      const emptyDescription = { fullDescription: null, shortDescription: null, source: null };
      cache.set(cacheKey, emptyDescription, DESCRIPTION_CACHE_TTL);
      return emptyDescription;
    }

    const fallbackState = await fetchStoreStateForLocale(storeUrl, fallbackLocale).catch(() => null);
    const fallbackSummary = getCaseInsensitiveValue(
      fallbackState?.core2?.products?.productSummaries || {},
      normalizedProductId,
    );
    const fallbackDescription = extractStoreDescriptionWithSource(fallbackSummary, fallbackLocale);
    const result = (fallbackDescription.fullDescription || fallbackDescription.shortDescription)
      ? fallbackDescription
      : { fullDescription: null, shortDescription: null, source: null };

    cache.set(cacheKey, result, DESCRIPTION_CACHE_TTL);
    return result;
  })().finally(() => {
    inflight.delete(inflightKey);
  });

  inflight.set(inflightKey, promise);
  return promise;
}

function toXboxRequestPath(storeUrl) {
  try {
    const url = new URL(storeUrl);
    if (url.origin === 'https://www.xbox.com') return `${url.pathname}${url.search}`;
  } catch {
    // Fall through and let axios handle the original value.
  }
  return storeUrl;
}

async function fetchStoreStateForLocale(storeUrl, locale = 'en-US') {
  const response = await withRetry(() =>
    client.get(toXboxRequestPathForLocale(storeUrl, locale), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': locale,
      },
    }),
  );
  return extractPreloadedState(String(response.data || ''));
}

function toXboxRequestPathForLocale(storeUrl, locale) {
  const path = toXboxRequestPath(storeUrl);
  return path.replace(/^\/(?:[a-z]{2}-[a-z]{2})\//i, `/${locale}/`);
}

function extractStoreDescription(productSummary) {
  if (!productSummary || typeof productSummary !== 'object') {
    return { fullDescription: null, shortDescription: null };
  }

  const fullDescription = firstNonEmptyString([
    productSummary.productDescription,
    productSummary.longDescription,
    productSummary.description,
  ]);

  const shortDescription = firstNonEmptyString([
    productSummary.shortDescription,
    productSummary.tagline,
  ]);

  return { fullDescription, shortDescription };
}

function extractStoreDescriptionWithSource(productSummary, source) {
  const description = extractStoreDescription(productSummary);
  if (description.fullDescription || description.shortDescription) {
    return { ...description, source };
  }
  return { ...description, source: null };
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getChannelProductIds(channelData, prefix, productId) {
  const expectedKey = `${prefix}_${productId}`;
  const channelKey = Object.keys(channelData).find((key) => key.toUpperCase() === expectedKey);
  const channel = channelKey ? channelData[channelKey] : null;
  const products = channel?.data?.products;
  if (!Array.isArray(products)) return [];
  return products
    .map((product) => product?.productId)
    .filter(Boolean);
}

function extractBundleItems(channelData, productSummaries, productId) {
  const bundleIds = getChannelProductIds(channelData, 'INTHISBUNDLE', productId);
  if (!bundleIds.length) return [];
  return bundleIds.map((id) => {
    const summary = getCaseInsensitiveValue(productSummaries, id);
    return {
      productId: id,
      title: summary?.title || id,
      image: extractSummaryImage(summary),
      detailPath: `/game/${id}`,
    };
  });
}

function extractCompareEditionItems(channelData, productSummaries, productId) {
  const editionIds = getChannelProductIds(channelData, 'COMPAREEDITIONS', productId)
    .filter((id) => String(id || '').toUpperCase() !== String(productId || '').toUpperCase());
  if (!editionIds.length) return [];
  return editionIds.map((id) => {
    const summary = getCaseInsensitiveValue(productSummaries, id);
    return {
      productId: id,
      title: summary?.title || id,
      image: extractSummaryImage(summary),
      detailPath: `/game/${id}`,
    };
  });
}

function extractSummaryImage(summary) {
  const images = summary?.images;
  if (!Array.isArray(images) || !images.length) return null;
  const preferred = images.find((image) => /FeaturePromotionalSquareArt/i.test(String(image?.imagePurpose || image?.purpose || '')))
    || images.find((image) => /BoxArt|Tile/i.test(String(image?.imagePurpose || image?.purpose || '')))
    || images.find((image) => /Poster|BrandedKeyArt|SuperHero/i.test(String(image?.imagePurpose || image?.purpose || '')))
    || images[0];
  const uri = preferred?.url || preferred?.uri || null;
  if (!uri) return null;
  return String(uri).startsWith('//') ? `https:${uri}` : uri;
}

function getCaseInsensitiveValue(source, key) {
  if (!source || !key) return null;
  const normalizedKey = String(key).toUpperCase();
  const actualKey = Object.keys(source).find((itemKey) => itemKey.toUpperCase() === normalizedKey);
  return actualKey ? source[actualKey] : null;
}

function extractStoreCategories(productSummary) {
  if (!productSummary) return [];
  const cats = productSummary.categories;
  if (Array.isArray(cats)) return cats.filter(Boolean);
  return [];
}

function extractStoreLanguageInfo(productSummary) {
  const languagesSupported = productSummary?.languagesSupported;
  if (!languagesSupported || typeof languagesSupported !== 'object' || Object.keys(languagesSupported).length === 0) {
    return buildStoreLanguageInfo('unknown', []);
  }

  const russianEntry = Object.entries(languagesSupported).find(([code, language]) => (
    isRussianLanguageCode(code)
    || /russian/i.test(String(language?.languageDisplayName || ''))
  ));

  if (!russianEntry) {
    return buildStoreLanguageInfo('no_ru', []);
  }

  const [code, language] = russianEntry;
  const hasAudio = Boolean(language?.isAudioSupported);
  const hasInterface = Boolean(language?.isInterfaceSupported);
  const hasSubtitles = Boolean(language?.areSubtitlesSupported);
  const hasAnyRussian = hasAudio || hasInterface || hasSubtitles;
  const mode = hasAudio ? 'full_ru' : hasAnyRussian ? 'ru_subtitles' : 'no_ru';
  return buildStoreLanguageInfo(mode, [code]);
}

function buildStoreLanguageInfo(mode, supportedLanguages) {
  return {
    supportedLanguages,
    packageLanguages: [],
    hasRussianLanguage: mode !== 'no_ru' && mode !== 'unknown',
    russianLanguageMode: mode,
    languageSource: 'xbox-store-page',
  };
}

function isRussianLanguageCode(code) {
  return /^ru(?:-|$)/i.test(String(code || '').trim());
}

function extractPreloadedState(html) {
  const marker = 'window.__PRELOADED_STATE__';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  const jsonStart = html.indexOf('{', markerIndex);
  if (jsonStart < 0) return null;

  const json = readBalancedJsonObject(html, jsonStart);
  if (!json) return null;

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readBalancedJsonObject(source, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }

  return null;
}

function getCachedLanguageInfo(productId) {
  const normalizedProductId = String(productId || '').toUpperCase();
  if (!normalizedProductId) return null;
  return cache.get(`xbox-store-language:${normalizedProductId}`) || null;
}

module.exports = {
  getStorePageProductData,
  getStoreLocalizedDescription,
  getStorePageRelatedProducts,
  extractPreloadedState,
  extractStoreLanguageInfo,
  getCachedLanguageInfo,
};

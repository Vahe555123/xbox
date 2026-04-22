const config = require('../config');
const { createAxiosClient, withRetry } = require('../utils/axiosClient');
const cache = require('../utils/cache');

const client = createAxiosClient('https://www.xbox.com');

const RELATED_CHANNELS = [
  { prefix: 'PRODUCTADDONS', relationshipType: 'ProductAddOns', limit: 24 },
  { prefix: 'MORELIKE', relationshipType: 'MoreLike', limit: 25 },
];

async function getStorePageRelatedProducts({ productId, storeUrl }) {
  const data = await getStorePageProductData({ productId, storeUrl });
  return data.relatedProducts;
}

async function getStorePageProductData({ productId, storeUrl }) {
  if (!productId || !storeUrl) return { relatedProducts: [], languageInfo: null };
  const normalizedProductId = String(productId).toUpperCase();
  const cacheKey = `xbox-store-page-product:${normalizedProductId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const response = await withRetry(() =>
    client.get(toXboxRequestPath(storeUrl), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': config.xbox.language,
      },
    }),
  );

  const state = extractPreloadedState(String(response.data || ''));
  const channelData = state?.core2?.channels?.channelData || {};
  const productSummaries = state?.core2?.products?.productSummaries || {};
  const productSummary = getCaseInsensitiveValue(productSummaries, normalizedProductId);
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
    languageInfo: extractStoreLanguageInfo(productSummary),
  };
  cache.set(cacheKey, data);
  return data;
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

function getCaseInsensitiveValue(source, key) {
  if (!source || !key) return null;
  const normalizedKey = String(key).toUpperCase();
  const actualKey = Object.keys(source).find((itemKey) => itemKey.toUpperCase() === normalizedKey);
  return actualKey ? source[actualKey] : null;
}

function extractStoreLanguageInfo(productSummary) {
  const languagesSupported = productSummary?.languagesSupported;
  if (!languagesSupported || typeof languagesSupported !== 'object') return null;

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
    hasRussianLanguage: mode !== 'no_ru',
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

module.exports = {
  getStorePageProductData,
  getStorePageRelatedProducts,
  extractPreloadedState,
  extractStoreLanguageInfo,
};

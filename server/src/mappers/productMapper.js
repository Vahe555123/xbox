const config = require('../config');
const {
  getCatalogProductPriceInfo,
  extractCatalogPassInfo,
} = require('./productDetailMapper');

const PLATFORM_MAP = {
  XboxSeriesX: 'Xbox Series X|S',
  XboxOne: 'Xbox One',
  PC: 'PC',
  XCloud: 'Cloud Gaming',
  Handheld: 'Handheld',
  MobileDevice: 'Mobile',
  Hub: 'Hub',
  HoloLens: 'HoloLens',
};

const BADGE_TYPE_MAP = {
  1: 'In Game Pass',
  2: 'Optimized for Series X|S',
  3: 'Smart Delivery',
  4: 'Cross-Gen',
  5: 'Xbox Play Anywhere',
  6: 'Cloud Enabled',
  7: 'Free to Play',
  8: 'Console Keyboard & Mouse',
  9: 'PC',
  10: 'Xbox Touch',
};

const GAME_PASS_IDS = new Set([
  'CFQ7TTC0KHS0', // Game Pass Ultimate
  'CFQ7TTC0P85B', // Game Pass Premium
  'CFQ7TTC0K5DJ', // Game Pass Essential
  'CFQ7TTC0K6L8', // Game Pass for Console
  'CFQ7TTC0KGQ8', // PC Game Pass
]);

const EA_PLAY_IDS = new Set(['CFQ7TTC0K5DH']);
const UBISOFT_PLUS_IDS = new Set(['CFQ7TTC0QH5H']);
const RUSSIAN_LANGUAGE_CODES = new Set(['ru', 'ru-ru']);
const RUSSIAN_LANGUAGE_MODE = {
  FULL: 'full_ru',
  SUBTITLES: 'ru_subtitles',
  NONE: 'no_ru',
};

function mapProduct({ summary, availability }) {
  if (!summary) return null;

  const releaseDate = normalizeReleaseDate(summary.releaseDate);
  const releaseInfo = buildReleaseInfo(summary, availability, releaseDate);
  const subscriptions = extractSubscriptions(summary);
  const basePrice = extractPrice(summary, availability, subscriptions);
  const price = releaseInfo.status === 'unreleased'
    ? {
        value: null,
        formatted: 'Not released yet',
        currency: null,
        original: null,
        status: 'unreleased',
      }
    : basePrice;
  const image = extractImage(summary.images);
  const platforms = (summary.availableOn || []).map((p) => PLATFORM_MAP[p] || p);
  const tags = extractTags(summary);
  const gamePassSavingsPercent = null;

  return {
    id: summary.productId,
    title: summary.title || 'Unknown',
    description: summary.shortDescription || summary.description || null,
    price,
    image: image?.url || null,
    images: summary.images || null,
    detailPath: `/game/${summary.productId}`,
    storeUrl: `https://www.xbox.com/${config.xbox.locale}/games/store/${encodeSlug(summary.title)}/${summary.productId}`,
    platforms,
    tags,
    subscriptions,
    subscriptionLabels: buildSubscriptionLabels(subscriptions),
    gamePassSavingsPercent,
    supportedLanguages: [],
    packageLanguages: [],
    hasRussianLanguage: false,
    russianLanguageMode: RUSSIAN_LANGUAGE_MODE.NONE,
    genre: summary.categories || [],
    publisher: summary.publisherName || null,
    developer: summary.developerName || null,
    releaseDate,
    releaseInfo,
    rating: {
      average: summary.averageRating || null,
      count: summary.ratingCount || null,
    },
    contentRating: summary.contentRating
      ? {
          board: summary.contentRating.boardName,
          rating: summary.contentRating.rating,
          description: summary.contentRating.description,
          imageUri: summary.contentRating.imageUri,
        }
      : null,
    productKind: summary.productKind || null,
  };
}

function extractPrice(summary, availability, subscriptions = extractSubscriptions(summary)) {
  const purchaseablePrices = Array.isArray(summary?.specificPrices?.purchaseable)
    ? summary.specificPrices.purchaseable
    : [];
  const priceData = pickBestPrice(purchaseablePrices, subscriptions) || pickAvailabilityPrice(availability);

  if (!priceData) {
    return { value: null, formatted: 'Price not available', currency: null, original: null, status: 'unavailable' };
  }

  const value = priceData.listPrice ?? priceData.msrp ?? null;
  const original = priceData.msrp ?? null;
  const currency = priceData.currency || priceData.currencyCode || 'USD';
  const isOnSale = priceData.discountPercentage > 0 || (original !== null && value !== null && value < original);
  const computedDiscountPercent = isOnSale && original && value !== null && Number(original) > 0
    ? Math.round(((Number(original) - Number(value)) / Number(original)) * 100)
    : null;

  let formatted;
  if (value === 0) {
    formatted = 'Free';
  } else if (value !== null) {
    formatted = formatCurrency(value, currency);
  } else {
    formatted = 'Price not available';
  }

  return {
    value,
    formatted,
    currency,
    original: isOnSale ? original : null,
    originalFormatted: isOnSale && original ? formatCurrency(original, currency) : null,
    discountPercent: priceData.discountPercentage || computedDiscountPercent,
    status: 'available',
  };
}

function pickAvailabilityPrice(availability) {
  if (!availability?.price) return null;
  const actions = availability.price.availabilityActions || availability.actions || [];
  return actions.includes('Purchase') ? availability.price : null;
}

function pickBestPrice(prices, subscriptions = {}) {
  const candidates = prices
    .filter((price) => price && price.listPrice != null)
    .filter((price) => {
      const actions = price.availabilityActions || [];
      return actions.length === 0 || actions.includes('Purchase');
    });

  if (!candidates.length) return null;

  const publicCandidates = candidates.filter((price) => !isSubscriptionOnlyPrice(price, subscriptions));
  const pool = publicCandidates.length ? publicCandidates : candidates;

  return pool.reduce((best, price) => (
    Number(price.listPrice) < Number(best.listPrice) ? price : best
  ), pool[0]);
}

function buildReleaseInfo(summary, availability, releaseDate) {
  if (releaseDate && new Date(releaseDate).getTime() > Date.now()) {
    return {
      status: 'comingSoon',
      label: `Coming ${formatDateLabel(releaseDate)}`,
      releaseDate,
    };
  }

  const pendingRating = [
    summary?.contentRating?.rating,
    summary?.contentRating?.description,
    summary?.contentRating?.ratingDescription,
  ].some((value) => /rating pending/i.test(String(value || '')));
  const purchaseableCount = Number(summary?.specificPrices?.totalPurchaseablePricesCount || 0);
  const hasPurchaseAvailability = Boolean(availability?.actions?.includes('Purchase'));

  if (!releaseDate && pendingRating && purchaseableCount === 0 && !hasPurchaseAvailability) {
    return {
      status: 'unreleased',
      label: 'Not released yet',
      releaseDate: null,
    };
  }

  return {
    status: releaseDate ? 'released' : 'unknown',
    label: releaseDate ? `Released ${formatDateLabel(releaseDate)}` : null,
    releaseDate,
  };
}

function normalizeReleaseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year >= 9998 || year <= 1753) return null;
  return value;
}

function formatDateLabel(value) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function extractImage(images) {
  if (!images) return null;
  return images.boxArt || images.poster || images.superHeroArt || null;
}

function extractTags(summary) {
  const tags = [];
  if (summary.badges) {
    for (const badge of summary.badges) {
      const label = BADGE_TYPE_MAP[badge.type];
      if (label) tags.push(label);
    }
  }
  if (summary.specificPrices) {
    const hasDiscount = Object.values(summary.specificPrices).some(
      (p) => p.discountPercentage > 0,
    );
    if (hasDiscount) tags.push('Sale');
  }
  return tags;
}

function getPriceEntries(specificPrices) {
  if (!specificPrices || typeof specificPrices !== 'object') return [];
  return Object.values(specificPrices).flatMap((value) => (Array.isArray(value) ? value : []));
}

function extractSubscriptions(summary) {
  const passIds = new Set(summary.includedWithPassesProductIds || []);
  const badgeTypes = new Set((summary.badges || []).map((badge) => badge.type));

  return {
    gamePass: badgeTypes.has(1) || [...passIds].some((id) => GAME_PASS_IDS.has(id)),
    eaPlay: [...passIds].some((id) => EA_PLAY_IDS.has(id)),
    ubisoftPlus: [...passIds].some((id) => UBISOFT_PLUS_IDS.has(id)),
  };
}

function buildSubscriptionLabels(subscriptions) {
  const labels = [];
  if (subscriptions?.gamePass) labels.push('Game Pass');
  if (subscriptions?.eaPlay) labels.push('EA Play');
  if (subscriptions?.ubisoftPlus) labels.push('Ubisoft+');
  return labels;
}

function extractGamePassSavingsPercent(summary, subscriptions = extractSubscriptions(summary)) {
  const subscriptionDiscounts = getPriceEntries(summary.specificPrices)
    .filter((price) => Number(price?.discountPercentage) > 0)
    .filter((price) => isGamePassPrice(price) || (subscriptions.gamePass && isSubscriptionPrice(price)));

  if (!subscriptionDiscounts.length) return null;

  return Math.round(Math.max(
    ...subscriptionDiscounts.map((price) => Number(price.discountPercentage) || 0),
  ));
}

function isGamePassPrice(price) {
  const eligibility = price?.eligibilityInfo || {};
  const haystack = [
    eligibility.eligibility,
    eligibility.type,
    eligibility.name,
    eligibility.description,
    price?.name,
    price?.displayName,
  ].filter(Boolean).join(' ');

  if (/game\s*pass|xgpu|xgp|ultimate/i.test(haystack)) return true;
  return eligibility.eligibility && eligibility.eligibility !== 'None' && /subscription|member/i.test(haystack);
}

function isSubscriptionPrice(price) {
  const eligibility = price?.eligibilityInfo || {};
  return Boolean(
    price?.hasXPriceOffer
    || (eligibility.eligibility && eligibility.eligibility !== 'None')
    || /subscription|member/i.test(JSON.stringify(eligibility)),
  );
}

function isSubscriptionOnlyPrice(price, subscriptions = {}) {
  const eligibility = price?.eligibilityInfo || {};
  const haystack = [
    eligibility.eligibility,
    eligibility.type,
    eligibility.name,
    eligibility.description,
    price?.name,
    price?.displayName,
  ].filter(Boolean).join(' ');

  return Boolean(
    isGamePassPrice(price)
    || (eligibility.eligibility && eligibility.eligibility !== 'None')
    || /subscription|member/i.test(haystack)
    || (subscriptions.gamePass && /game\s*pass|xgpu|xgp|ultimate/i.test(JSON.stringify(price || {})))
  );
}

function extractLanguageInfo(product) {
  const supportedCodes = new Set();
  const packageCodes = new Set();

  for (const entry of product?.DisplaySkuAvailabilities || []) {
    const sku = entry?.Sku || {};

    for (const marketProperties of sku.MarketProperties || []) {
      for (const code of marketProperties.SupportedLanguages || []) {
        addLanguageCode(supportedCodes, code);
      }
    }

    for (const pkg of sku.Properties?.Packages || []) {
      for (const code of pkg.Languages || []) {
        addLanguageCode(packageCodes, code);
      }
    }
  }

  const supportedLanguages = [...supportedCodes].sort();
  const packageLanguages = [...packageCodes].sort();
  const hasRussian = hasRussianLanguage(supportedLanguages) || hasRussianLanguage(packageLanguages);
  const hasRussianPackage = hasRussianLanguage(packageLanguages);

  return {
    supportedLanguages,
    packageLanguages,
    hasRussianLanguage: hasRussian,
    russianLanguageMode: hasRussianPackage
      ? RUSSIAN_LANGUAGE_MODE.FULL
      : hasRussian
        ? RUSSIAN_LANGUAGE_MODE.SUBTITLES
        : RUSSIAN_LANGUAGE_MODE.NONE,
  };
}

function addLanguageCode(codes, code) {
  if (!code) return;
  codes.add(String(code).trim().toLowerCase());
}

function hasRussianLanguage(codes) {
  return codes.some((code) => RUSSIAN_LANGUAGE_CODES.has(code) || code.startsWith('ru-'));
}

function enrichProductsWithCatalogDetails(products, catalogProducts) {
  const byId = new Map(
    (catalogProducts || [])
      .filter((product) => product?.ProductId)
      .map((product) => [product.ProductId, product]),
  );

  return products.map((product) => {
    const catalogProduct = byId.get(product.id);
    if (!catalogProduct) return product;

    const languageInfo = extractLanguageInfo(catalogProduct);
    const catalogPriceInfo = getCatalogProductPriceInfo(catalogProduct);
    const catalogPassInfo = extractCatalogPassInfo(catalogProduct);
    const gamePassSavingsPercent = catalogPriceInfo.gamePassSavingsPercent ?? null;
    const subscriptions = mergeSubscriptions(product.subscriptions, catalogPassInfo.subscriptions);
    const subscriptionLabels = mergeSubscriptionLabels(product.subscriptionLabels, catalogPassInfo.subscriptionLabels);
    const notAvailableSeparately = !catalogPriceInfo.price
      && product.releaseInfo?.status !== 'unreleased'
      && product.releaseInfo?.status !== 'comingSoon';

    return {
      ...product,
      ...languageInfo,
      notAvailableSeparately,
      price: gamePassSavingsPercent && catalogPriceInfo.price ? catalogPriceInfo.price : product.price,
      subscriptions,
      subscriptionLabels,
      gamePassSavingsPercent,
      gamePassSavingsAmount: catalogPriceInfo.gamePassSavingsAmount ?? product.gamePassSavingsAmount ?? null,
      gamePassSavingsFormatted: catalogPriceInfo.gamePassSavingsFormatted ?? product.gamePassSavingsFormatted ?? null,
      gamePassPrice: catalogPriceInfo.gamePassPrice ?? product.gamePassPrice ?? null,
      gamePassPriceFormatted: catalogPriceInfo.gamePassPriceFormatted ?? product.gamePassPriceFormatted ?? null,
    };
  });
}

function mergeSubscriptions(primary = {}, secondary = {}) {
  return {
    gamePass: Boolean(primary.gamePass || secondary.gamePass),
    eaPlay: Boolean(primary.eaPlay || secondary.eaPlay),
    ubisoftPlus: Boolean(primary.ubisoftPlus || secondary.ubisoftPlus),
  };
}

const GAME_PASS_TIER_LABELS = new Set([
  'Game Pass',
  'Ultimate',
  'Premium',
  'Essential',
  'PC Game Pass',
]);

function mergeSubscriptionLabels(primary = [], secondary = []) {
  const merged = [...primary, ...secondary]
    .filter(Boolean)
    .filter((label, index, labels) => labels.indexOf(label) === index);

  return collapseGamePassLabels(merged);
}

function collapseGamePassLabels(labels) {
  const result = [];
  let gamePassInserted = false;
  for (const label of labels) {
    if (GAME_PASS_TIER_LABELS.has(label)) {
      if (gamePassInserted) continue;
      result.push('Game Pass');
      gamePassInserted = true;
      continue;
    }
    result.push(label);
  }
  return result;
}

function encodeSlug(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
}

function formatCurrency(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function mapProducts(products) {
  return products.map(mapProduct).filter(Boolean);
}

module.exports = { mapProduct, mapProducts, enrichProductsWithCatalogDetails };

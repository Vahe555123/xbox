const {
  extractCatalogPassInfo,
  getCatalogProductPriceInfo,
} = require('./productDetailMapper');

const RUSSIAN_LANGUAGE_CODES = new Set(['ru', 'ru-ru']);

function absUri(uri) {
  if (!uri) return null;
  if (String(uri).startsWith('//')) return `https:${uri}`;
  return uri;
}

function findImage(images, purpose) {
  if (!Array.isArray(images)) return null;
  const img = images.find((i) => i.ImagePurpose === purpose);
  return img ? absUri(img.Uri) : null;
}

function addLanguageCode(codes, code) {
  if (!code) return;
  codes.add(String(code).trim().toLowerCase());
}

function hasRussianLanguage(codes) {
  return codes.some((code) => RUSSIAN_LANGUAGE_CODES.has(code) || code.startsWith('ru-'));
}

function extractLanguageInfo(displaySkuAvailabilities) {
  const supportedCodes = new Set();
  const packageCodes = new Set();

  for (const entry of displaySkuAvailabilities || []) {
    const sku = entry?.Sku || {};

    for (const marketProperties of sku.MarketProperties || []) {
      for (const language of marketProperties.SupportedLanguages || []) {
        addLanguageCode(supportedCodes, language);
      }
    }

    for (const pkg of sku.Properties?.Packages || []) {
      for (const language of pkg.Languages || []) {
        addLanguageCode(packageCodes, language);
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
    russianLanguageMode: hasRussianPackage ? 'full_ru' : hasRussian ? 'ru_subtitles' : 'no_ru',
  };
}

function mapRelatedProductCard(raw, relationshipType) {
  const lp = raw.LocalizedProperties?.[0] || {};
  const mp = raw.MarketProperties?.[0] || {};
  const props = raw.Properties || {};
  const images = lp.Images || [];
  const catalogPriceInfo = getCatalogProductPriceInfo(raw);
  const catalogPassInfo = extractCatalogPassInfo(raw);
  const languageInfo = extractLanguageInfo(raw.DisplaySkuAvailabilities);

  // Pick best image: Poster > BoxArt > BrandedKeyArt > SuperHeroArt > first available
  const image =
    findImage(images, 'Poster') ||
    findImage(images, 'BoxArt') ||
    findImage(images, 'BrandedKeyArt') ||
    findImage(images, 'SuperHeroArt') ||
    findImage(images, 'TitledHeroArt') ||
    findImage(images, 'FeaturePromotionalSquareArt') ||
    (images[0] ? absUri(images[0].Uri) : null);

  // Hero image for wider cards
  const heroImage =
    findImage(images, 'SuperHeroArt') ||
    findImage(images, 'TitledHeroArt') ||
    findImage(images, 'BrandedKeyArt') ||
    image;

  // Rating from AllTime usage data
  const usage = mp.UsageData || [];
  const allTime = usage.find((u) => u.AggregateTimeSpan === 'AllTime');
  const averageRating = allTime?.AverageRating ?? null;
  const ratingCount = allTime?.RatingCount ?? null;

  // Categories / genres
  const categories = props.Categories || [];

  // Detect Game Pass from merchandizing tags
  const merchTags = raw.MerchandizingTags || [];
  const isGamePass = merchTags.some((t) =>
    /gamepass|game\s*pass/i.test(typeof t === 'string' ? t : ''),
  );
  const releaseDate = mp.OriginalReleaseDate || null;
  const isFuture = releaseDate && new Date(releaseDate).getTime() > Date.now();
  const price = isFuture
    ? {
        value: null,
        formatted: 'Not released yet',
        currency: null,
        original: null,
        originalFormatted: null,
        discountPercent: null,
        status: 'unreleased',
      }
    : catalogPriceInfo.price;

  return {
    id: raw.ProductId,
    title: lp.ProductTitle || raw.ProductId,
    developerName: lp.DeveloperName || null,
    publisherName: lp.PublisherName || null,
    productKind: raw.ProductKind || null,
    relationshipType: relationshipType || null,
    image,
    heroImage,
    images: { boxArt: image, poster: image, superHeroArt: heroImage },
    detailPath: `/game/${raw.ProductId}`,
    categories,
    price,
    rating: {
      average: averageRating,
      count: ratingCount,
    },
    subscriptions: catalogPassInfo.subscriptions,
    subscriptionLabels: catalogPassInfo.subscriptionLabels,
    gamePassSavingsPercent: catalogPriceInfo.gamePassSavingsPercent ?? null,
    gamePassSavingsAmount: catalogPriceInfo.gamePassSavingsAmount ?? null,
    gamePassSavingsFormatted: catalogPriceInfo.gamePassSavingsFormatted ?? null,
    releaseInfo: {
      status: isFuture ? 'comingSoon' : releaseDate ? 'released' : 'unknown',
      releaseDate,
      label: null,
    },
    ...languageInfo,
    isGamePass,
    releaseDate,
  };
}

function mapRelatedProducts(rawProducts, relationMap) {
  return rawProducts.map((raw) => {
    const relType = relationMap?.[raw.ProductId] || null;
    return mapRelatedProductCard(raw, relType);
  });
}

module.exports = { mapRelatedProducts, mapRelatedProductCard };

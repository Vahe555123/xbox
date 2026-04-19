function absUri(uri) {
  if (!uri) return null;
  if (String(uri).startsWith('//')) return `https:${uri}`;
  return uri;
}

function formatMoney(value, currency) {
  if (value === null || value === undefined) return null;
  const c = currency || 'USD';
  if (value === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(value);
  } catch {
    return `$${Number(value).toFixed(2)}`;
  }
}

function findImage(images, purpose) {
  if (!Array.isArray(images)) return null;
  const img = images.find((i) => i.ImagePurpose === purpose);
  return img ? absUri(img.Uri) : null;
}

function mapRelatedProductCard(raw, relationshipType) {
  const lp = raw.LocalizedProperties?.[0] || {};
  const mp = raw.MarketProperties?.[0] || {};
  const props = raw.Properties || {};
  const images = lp.Images || [];

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

  // Extract price from first SKU availability
  let listPrice = null;
  let msrp = null;
  let currency = 'USD';
  let formattedListPrice = null;
  let formattedMsrp = null;
  let isFree = false;
  let hasDiscount = false;
  let discountPercent = null;

  const skus = raw.DisplaySkuAvailabilities || [];
  for (const sku of skus) {
    for (const av of sku.Availabilities || []) {
      const price = av.OrderManagementData?.Price;
      if (price && price.ListPrice != null) {
        listPrice = price.ListPrice;
        msrp = price.MSRP ?? null;
        currency = price.CurrencyCode || 'USD';
        break;
      }
    }
    if (listPrice !== null) break;
  }

  if (listPrice !== null) {
    isFree = listPrice === 0;
    formattedListPrice = formatMoney(listPrice, currency);
    if (msrp != null && msrp > listPrice && listPrice > 0) {
      hasDiscount = true;
      formattedMsrp = formatMoney(msrp, currency);
      discountPercent = Math.round(((msrp - listPrice) / msrp) * 100);
    }
  }

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

  return {
    id: raw.ProductId,
    title: lp.ProductTitle || raw.ProductId,
    developerName: lp.DeveloperName || null,
    publisherName: lp.PublisherName || null,
    productKind: raw.ProductKind || null,
    relationshipType: relationshipType || null,
    image,
    heroImage,
    categories,
    price: {
      listPrice,
      msrp,
      currency,
      formattedListPrice,
      formattedMsrp,
      isFree,
      hasDiscount,
      discountPercent,
    },
    rating: {
      average: averageRating,
      count: ratingCount,
    },
    isGamePass,
    releaseDate: mp.OriginalReleaseDate || null,
  };
}

function mapRelatedProducts(rawProducts, relationMap) {
  return rawProducts.map((raw) => {
    const relType = relationMap?.[raw.ProductId] || null;
    return mapRelatedProductCard(raw, relType);
  });
}

module.exports = { mapRelatedProducts, mapRelatedProductCard };

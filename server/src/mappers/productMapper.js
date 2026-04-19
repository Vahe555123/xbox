const config = require('../config');

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

function mapProduct({ summary, availability }) {
  if (!summary) return null;

  const releaseDate = normalizeReleaseDate(summary.releaseDate);
  const releaseInfo = buildReleaseInfo(summary, availability, releaseDate);
  const basePrice = extractPrice(summary, availability);
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

function extractPrice(summary, availability) {
  const purchaseablePrices = Array.isArray(summary?.specificPrices?.purchaseable)
    ? summary.specificPrices.purchaseable
    : [];
  const priceData = pickBestPrice(purchaseablePrices) || pickAvailabilityPrice(availability);

  if (!priceData) {
    return { value: null, formatted: 'Price not available', currency: null, original: null, status: 'unavailable' };
  }

  const value = priceData.listPrice ?? priceData.msrp ?? null;
  const original = priceData.msrp ?? null;
  const currency = priceData.currency || priceData.currencyCode || 'USD';
  const isOnSale = priceData.discountPercentage > 0 || (original !== null && value !== null && value < original);

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
    discountPercent: priceData.discountPercentage || null,
    status: 'available',
  };
}

function pickAvailabilityPrice(availability) {
  if (!availability?.price) return null;
  const actions = availability.price.availabilityActions || availability.actions || [];
  return actions.includes('Purchase') ? availability.price : null;
}

function pickBestPrice(prices) {
  const candidates = prices
    .filter((price) => price && price.listPrice != null)
    .filter((price) => {
      const actions = price.availabilityActions || [];
      return actions.length === 0 || actions.includes('Purchase');
    });

  if (!candidates.length) return null;
  return candidates.reduce((best, price) => (
    Number(price.listPrice) < Number(best.listPrice) ? price : best
  ), candidates[0]);
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
  return images.poster || images.boxArt || images.superHeroArt || null;
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

module.exports = { mapProduct, mapProducts };

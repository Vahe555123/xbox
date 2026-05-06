export function hasValidReleaseDate(value) {
  if (!value) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const year = date.getUTCFullYear();
  return year < 9998 && year > 1753;
}

function hasKnownStorePrice(price) {
  const numericValue = Number(price?.value);
  return Number.isFinite(numericValue) && numericValue > 0;
}

export function getStorePriceLabel(price, releaseInfo, isUnavailablePrice) {
  if (isUnavailablePrice) return null;
  if (price?.value === 0) return 'Бесплатно';

  if (
    price?.status === 'unreleased'
    || releaseInfo?.status === 'unreleased'
    || releaseInfo?.status === 'comingSoon'
  ) {
    const hasKnownPrice = hasKnownStorePrice(price);
    const hasKnownReleaseDate = hasValidReleaseDate(releaseInfo?.releaseDate);

    if (!hasKnownPrice && !hasKnownReleaseDate) return null;
    return 'Еще не вышла';
  }

  return price?.formatted || releaseInfo?.label || null;
}

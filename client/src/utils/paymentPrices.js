export const PAYMENT_PRICE_ORDER = ['oplata', 'key_activation', 'topup_cards'];

const PAYMENT_PRICE_TITLES = {
  oplata: 'Oplata.info',
  key_activation: 'Ключ активации',
  topup_cards: 'Карты пополнения',
};

const PAYMENT_PRICE_SHORT_TITLES = {
  oplata: 'Oplata',
  key_activation: 'Ключ',
  topup_cards: 'Карты',
};

export function formatRub(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  try {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${Math.round(numeric)} ₽`;
  }
}

export function formatCardCount(count) {
  const numeric = Number(count);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const rounded = Math.round(numeric);
  const mod10 = rounded % 10;
  const mod100 = rounded % 100;
  if (mod10 === 1 && mod100 !== 11) return `${rounded} карта`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${rounded} карты`;
  return `${rounded} карт`;
}

function normalizePaymentPrice(modeId, price) {
  if (!price) return null;
  const value = price.value ?? price.amount ?? price.totalRub ?? null;
  const formatted = price.formatted || price.totalRubFormatted || formatRub(value);
  return {
    ...price,
    id: price.id || modeId,
    title: price.title || PAYMENT_PRICE_TITLES[modeId] || modeId,
    shortTitle: PAYMENT_PRICE_SHORT_TITLES[modeId] || price.title || modeId,
    formatted,
    value,
    enabled: price.enabled !== false,
    available: Boolean(price.available || formatted || value),
  };
}

function fallbackPaymentPrice(product, modeId) {
  if (modeId === 'oplata' && product?.priceRub?.formatted) {
    return normalizePaymentPrice(modeId, {
      id: modeId,
      title: PAYMENT_PRICE_TITLES[modeId],
      available: true,
      enabled: true,
      ...product.priceRub,
    });
  }

  if (modeId === 'topup_cards' && product?.topupCombo?.available) {
    const combo = product.topupCombo;
    const hasProportional = Number.isFinite(Number(combo.proportionalRub));
    const value = hasProportional ? Number(combo.proportionalRub) : combo.totalRub;
    const formatted = hasProportional
      ? (combo.proportionalRubFormatted || formatRub(combo.proportionalRub))
      : combo.totalRubFormatted;
    return normalizePaymentPrice(modeId, {
      id: modeId,
      title: PAYMENT_PRICE_TITLES[modeId],
      available: Boolean(formatted || value),
      enabled: true,
      value,
      formatted,
      cardsCount: combo.cardsCount,
      totalUsd: combo.totalUsd,
      priceUsd: combo.price,
      substituted: combo.substituted,
      cardsTotalRub: combo.totalRub ?? null,
      cardsTotalRubFormatted: combo.totalRubFormatted ?? null,
      leftoverUsd: combo.leftoverUsd ?? null,
      leftoverUsdFormatted: combo.leftoverUsdFormatted ?? null,
    });
  }

  return null;
}

export function getPaymentPrice(product, modeId) {
  const fromMap = normalizePaymentPrice(modeId, product?.paymentPrices?.[modeId]);
  return fromMap || fallbackPaymentPrice(product, modeId);
}

export function getPaymentPriceEntries(product, { includeUnavailable = false } = {}) {
  return PAYMENT_PRICE_ORDER
    .map((modeId) => getPaymentPrice(product, modeId))
    .filter((price) => price && price.enabled && (includeUnavailable || price.available));
}

export function getPaymentPriceText(price, fallback = 'Цена будет рассчитана') {
  if (!price) return fallback;
  return price.formatted || formatRub(price.value) || fallback;
}

export function getPaymentPriceMeta(price) {
  if (!price) return null;
  if (price.id === 'topup_cards') {
    const cards = formatCardCount(price.cardsCount);
    if (cards) return `за ${cards}`;
  }
  return null;
}

export function getPaymentPriceLine(price, fallback) {
  const text = getPaymentPriceText(price, fallback);
  if (!text) return fallback || null;
  const meta = getPaymentPriceMeta(price);
  return meta ? `${text} · ${meta}` : text;
}

function formatLeftoverUsdDisplay(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return (Math.round(numeric * 100) / 100).toFixed(2);
}

export function getTopupCardsBreakdown(price) {
  if (!price || price.id !== 'topup_cards') return null;
  const cardsRub = price.cardsTotalRubFormatted || formatRub(price.cardsTotalRub);
  const leftover = price.leftoverUsdFormatted || formatLeftoverUsdDisplay(price.leftoverUsd);
  if (!cardsRub && leftover == null) return null;
  const parts = [];
  if (cardsRub) parts.push(cardsRub);
  if (leftover != null) parts.push(`${leftover}$ на баланс`);
  return parts.join(' / ');
}

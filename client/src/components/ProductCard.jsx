import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import FavoriteHeartButton from './FavoriteHeartButton';
import {
  formatRub,
  getPaymentOriginalPriceText,
  getPaymentPriceEntries,
  getPaymentPriceLine,
} from '../utils/paymentPrices';

const CATALOG_PAYMENT_TITLES = {
  oplata: 'ПОКУПКА НА АККАУНТ',
  key_activation: 'КЛЮЧ НА ИГРУ',
  topup_cards: 'КОДОМ ПОПОЛНЕНИЯ БАЛАНСА',
};

const GAME_PASS_LABELS = new Set([
  'game pass',
  'pc game pass',
  'ultimate',
  'premium',
  'essential',
  'core',
  'standard',
]);

export default function ProductCard({ product }) {
  const [imgError, setImgError] = useState(false);
  const {
    title,
    price,
    priceRub,
    image,
    detailPath,
    releaseInfo,
    subscriptionLabels = [],
    hasRussianLanguage,
    russianLanguageMode,
    gamePassSavingsPercent,
  } = product;
  const to = detailPath || `/game/${product.id}`;
  const priceStatus = price?.status || 'unknown';
  const discountPercent = price?.discountPercent > 0
    ? Math.round(price.discountPercent)
    : null;
  const gamePassSavingsBadgePercent = Number(gamePassSavingsPercent) > 0
    ? Math.round(Number(gamePassSavingsPercent))
    : null;
  const hasRubPrice = Boolean(priceRub?.formatted);
  const isUnavailablePrice = priceStatus === 'unavailable' || price?.formatted === 'Price not available';
  const storePriceLabel = getStorePriceLabel(price, releaseInfo, isUnavailablePrice);
  const shouldShowStorePrice = Boolean(storePriceLabel);
  const fallbackPriceLabel = hasRubPrice ? null : 'Цена недоступна';
  const paymentPriceEntries = getPaymentPriceEntries(product, { includeUnavailable: true });
  const catalogSubscriptionLabels = getCatalogSubscriptionLabels(subscriptionLabels);
  const languageBadge = getLanguageBadge(russianLanguageMode, hasRussianLanguage);
  const hasStorePriceRow = Boolean(
    (price?.original && price.original > price.value)
    || shouldShowStorePrice
    || (!paymentPriceEntries.length && fallbackPriceLabel)
  );

  const imageUrl = image
    ? `${image}?w=330&h=330`
    : null;

  return (
    <article className="product-card">
      <div className="product-card-inner">
        <div className="product-image-wrap">
          <Link to={to} className="product-image-link">
            {imageUrl && !imgError ? (
              <img
                src={imageUrl}
                alt={title}
                loading="lazy"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="product-image-placeholder">
                <span>No Image</span>
              </div>
            )}
            <span className={`product-language-badge product-language-badge--${languageBadge.mode}`}>
              {languageBadge.label}
            </span>
          </Link>
          <FavoriteHeartButton product={product} />
        </div>

        <Link to={to} className="product-card-body-link">
          <div className="product-info">
          <h3 className="product-title">{title}</h3>

          {catalogSubscriptionLabels.length > 0 && (
            <div className="product-subscriptions">
              {catalogSubscriptionLabels.map((label) => (
                <span key={label} className={getSubscriptionChipClass(label)}>{label}</span>
              ))}
            </div>
          )}

          <div className="product-price">
            {hasStorePriceRow && (
              <div className="product-price-store">
                {discountPercent && <span className="price-discount-badge">-{discountPercent}%</span>}
                {price?.original && price.original > price.value && (
                  <span className="price-original">{price.originalFormatted}</span>
                )}
                {shouldShowStorePrice && (
                  <span className={`price-current ${price?.value === 0 ? 'free' : ''} price-status-${priceStatus}`}>
                    {storePriceLabel}
                  </span>
                )}
                {!shouldShowStorePrice && !paymentPriceEntries.length && fallbackPriceLabel && (
                  <span className={`price-current price-status-${priceStatus}`}>{fallbackPriceLabel}</span>
                )}
                {gamePassSavingsBadgePercent && (
                  <span className="price-gamepass-badge price-gamepass-badge--after">
                    {getGamePassSavingsText(gamePassSavingsBadgePercent)}
                  </span>
                )}
              </div>
            )}

            {paymentPriceEntries.length > 0 && (
              <div className="payment-price-list payment-price-list--card">
                {paymentPriceEntries.map((paymentPrice) => (
                  <div className="payment-price-row payment-price-row--card" key={paymentPrice.id}>
                    <span className="payment-price-title">{getCatalogPaymentTitle(paymentPrice)}</span>
                    <PaymentPriceAmount price={paymentPrice} variant="catalog" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </Link>
      </div>
    </article>
  );
}

function PaymentPriceAmount({ price, fallback, variant }) {
  const display = variant === 'catalog'
    ? getCatalogPaymentPriceDisplay(price, fallback)
    : {
        current: getPaymentPriceLine(price, fallback),
        original: getPaymentOriginalPriceText(price),
        meta: null,
      };

  return (
    <strong className="payment-price-amount">
      <span className="payment-price-current">{display.current}</span>
      {display.original && <span className="payment-price-original">{display.original}</span>}
      {display.meta && <span className="payment-price-balance">({display.meta})</span>}
    </strong>
  );
}

function getCatalogPaymentPriceDisplay(price, fallback) {
  if (price?.id !== 'topup_cards') {
    return {
      current: getPaymentPriceLine(price, fallback),
      original: getPaymentOriginalPriceText(price),
      meta: null,
    };
  }

  const totalRub = Number(price.value);
  const totalUsd = Number(price.totalUsd);
  const priceUsd = Number(price.priceUsd);
  if (!Number.isFinite(totalRub) || !Number.isFinite(totalUsd) || !Number.isFinite(priceUsd) || totalRub <= 0 || totalUsd <= 0 || priceUsd <= 0) {
    return {
      current: getPaymentPriceLine(price, fallback),
      original: null,
      meta: null,
    };
  }

  const effectiveRub = Math.ceil((totalRub / totalUsd) * priceUsd);
  const balanceUsd = Math.max(0, Math.round((totalUsd - priceUsd) * 100) / 100);

  return {
    current: formatRub(effectiveRub),
    original: getTopupEffectiveOriginalText(price, effectiveRub),
    meta: balanceUsd <= 0.01 ? null : `${formatRub(totalRub)} / ${formatUsdBalance(balanceUsd)} на баланс`,
  };
}

function getTopupEffectiveOriginalText(price, currentEffectiveRub) {
  const totalRub = Number(price?.originalValue);
  const totalUsd = Number(price?.originalTotalUsd);
  const priceUsd = Number(price?.originalPriceUsd);

  if (!Number.isFinite(totalRub) || !Number.isFinite(totalUsd) || !Number.isFinite(priceUsd) || totalRub <= 0 || totalUsd <= 0 || priceUsd <= 0) {
    return null;
  }

  const effectiveRub = Math.ceil((totalRub / totalUsd) * priceUsd);
  if (Number.isFinite(currentEffectiveRub) && effectiveRub <= currentEffectiveRub) return null;
  return formatRub(effectiveRub);
}

function formatUsdBalance(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return `${rounded.toFixed(2)}$`;
}

function getCatalogPaymentTitle(price) {
  return CATALOG_PAYMENT_TITLES[price?.id] || String(price?.shortTitle || price?.title || '').toUpperCase();
}

function getGamePassSavingsText(percent) {
  return `Сэкономь ${Math.round(Number(percent) || 0)}% с Game Pass`;
}

function getCatalogSubscriptionLabels(labels) {
  const normalizedLabels = (labels || []).filter(Boolean);
  const hasGamePass = normalizedLabels.some((label) => isGamePassSubscriptionLabel(label));
  const rest = normalizedLabels.filter((label) => !isGamePassSubscriptionLabel(label));
  return hasGamePass ? ['Game Pass', ...rest] : rest;
}

function getSubscriptionChipClass(label) {
  const normalized = String(label || '').toLowerCase();
  const modifiers = [];
  if (normalized.includes('ea play')) modifiers.push('subscription-chip--ea-play');
  if (normalized.includes('ubisoft')) modifiers.push('subscription-chip--ubisoft-plus');
  return ['subscription-chip', ...modifiers].join(' ');
}

function isGamePassSubscriptionLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return GAME_PASS_LABELS.has(normalized) || normalized.includes('game pass');
}

function getLanguageBadge(mode, hasRussian) {
  if (mode === 'unknown') return { mode: 'unknown', label: 'Язык не указан' };
  if (mode === 'full_ru') return { mode: 'full-ru', label: 'Полностью на русском' };
  if (mode === 'ru_subtitles' || hasRussian) return { mode: 'ru-subtitles', label: 'Русские субтитры' };
  return { mode: 'no-ru', label: 'Без русского' };
}

function getStorePriceLabel(price, releaseInfo, isUnavailablePrice) {
  if (isUnavailablePrice) return null;
  if (price?.value === 0) return 'Бесплатно';
  if (price?.status === 'unreleased' || releaseInfo?.status === 'unreleased') return 'Еще не вышла';
  return price?.formatted || releaseInfo?.label || null;
}

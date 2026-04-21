import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import FavoriteHeartButton from './FavoriteHeartButton';
import {
  getPaymentOriginalPriceText,
  getPaymentPriceEntries,
  getPaymentPriceLine,
  getTopupCardsBreakdown,
} from '../utils/paymentPrices';

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
            {hasRussianLanguage && (
              <span className="product-language-badge">Русский язык</span>
            )}
          </Link>
          <FavoriteHeartButton product={product} />
        </div>

        <Link to={to} className="product-card-body-link">
          <div className="product-info">
          <h3 className="product-title">{title}</h3>

          {subscriptionLabels.length > 0 && (
            <div className="product-subscriptions">
              {subscriptionLabels.map((label) => (
                <span key={label} className={getSubscriptionChipClass(label)}>{label}</span>
              ))}
            </div>
          )}

          <div className="product-price">
            {hasStorePriceRow && (
              <div className="product-price-store">
                {discountPercent && <span className="price-discount-badge">-{discountPercent}%</span>}
                {gamePassSavingsBadgePercent && (
                  <span className="price-gamepass-badge price-gamepass-badge--before">
                    {getGamePassSavingsText(gamePassSavingsBadgePercent)}
                  </span>
                )}
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
                  <div className="payment-price-row" key={paymentPrice.id}>
                    <span>{paymentPrice.shortTitle}</span>
                    <PaymentPriceAmount price={paymentPrice} />
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

function PaymentPriceAmount({ price, fallback }) {
  const originalPriceText = getPaymentOriginalPriceText(price);
  const breakdown = getTopupCardsBreakdown(price);
  return (
    <strong className="payment-price-amount">
      <span className="payment-price-current">{getPaymentPriceLine(price, fallback)}</span>
      {breakdown && <span className="payment-price-breakdown"> ({breakdown})</span>}
      {originalPriceText && <span className="payment-price-original">{originalPriceText}</span>}
    </strong>
  );
}

function getGamePassSavingsText(percent) {
  return `Сэкономь ${Math.round(Number(percent) || 0)}% с Game Pass`;
}

function getSubscriptionChipClass(label) {
  const normalized = String(label || '').toLowerCase();
  const modifiers = [];
  if (normalized.includes('ea play')) modifiers.push('subscription-chip--ea-play');
  if (normalized.includes('ubisoft')) modifiers.push('subscription-chip--ubisoft-plus');
  return ['subscription-chip', ...modifiers].join(' ');
}

function getStorePriceLabel(price, releaseInfo, isUnavailablePrice) {
  if (isUnavailablePrice) return null;
  if (price?.value === 0) return 'Бесплатно';
  if (price?.status === 'unreleased' || releaseInfo?.status === 'unreleased') return 'Еще не вышла';
  return price?.formatted || releaseInfo?.label || null;
}

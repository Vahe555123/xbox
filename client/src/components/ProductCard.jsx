import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import FavoriteHeartButton from './FavoriteHeartButton';

export default function ProductCard({ product }) {
  const [imgError, setImgError] = useState(false);
  const {
    title,
    price,
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
            {(discountPercent || gamePassSavingsPercent) && (
              <div className="product-image-flags">
                {discountPercent && (
                  <span className="product-image-flag product-image-flag-sale">
                    -{discountPercent}%
                  </span>
                )}
                {gamePassSavingsPercent && (
                  <span className="product-image-flag product-image-flag-gamepass">
                    Сэкономь {Math.round(gamePassSavingsPercent)}% с Game Pass
                  </span>
                )}
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
                <span key={label} className="subscription-chip">{label}</span>
              ))}
            </div>
          )}

          <div className="product-price">
            {price?.original && price.original > price.value && (
              <span className="price-original">{price.originalFormatted}</span>
            )}
            <span className={`price-current ${price?.value === 0 ? 'free' : ''} price-status-${priceStatus}`}>
              {price?.formatted || releaseInfo?.label || 'Price N/A'}
            </span>
          </div>
        </div>
        </Link>
      </div>
    </article>
  );
}

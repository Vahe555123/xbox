import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function RelatedProductCard({ product }) {
  const [imgError, setImgError] = useState(false);

  const {
    id,
    title,
    developerName,
    publisherName,
    image,
    price,
    priceRub,
    rating,
    isGamePass,
    categories,
    productKind,
  } = product;

  const imageUrl = !imgError && image ? `${image}?w=330&h=440` : null;

  const renderPrice = () => {
    if (!price) return null;

    if (price.isFree) {
      return (
        <div className="rp-price-row">
          <span className="rp-price-current rp-price-free">Бесплатно</span>
          {priceRub?.formatted && <span className="rp-price-rub">{priceRub.formatted}</span>}
        </div>
      );
    }

    return (
      <div className="rp-price-row">
        {price.hasDiscount && price.formattedMsrp && (
          <span className="rp-price-original">{price.formattedMsrp}</span>
        )}
        {price.formattedListPrice && (
          <span className="rp-price-current">{price.formattedListPrice}</span>
        )}
        {priceRub?.formatted && <span className="rp-price-rub">{priceRub.formatted}</span>}
        {price.hasDiscount && price.discountPercent > 0 && (
          <span className="rp-price-discount">-{price.discountPercent}%</span>
        )}
      </div>
    );
  };

  const renderRating = () => {
    if (!rating?.average || rating.average === 0) return null;
    return (
      <div className="rp-rating">
        <span className="rp-star">&#9733;</span>
        <span>{rating.average.toFixed(1)}</span>
        {rating.count > 0 && (
          <span className="rp-rating-count">({rating.count.toLocaleString()})</span>
        )}
      </div>
    );
  };

  return (
    <article className="rp-card">
      <Link to={`/game/${id}`} className="rp-card-link">
        <div className="rp-card-image-wrap">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={title}
              loading="lazy"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="rp-card-image-placeholder">
              <span>{title?.[0] || '?'}</span>
            </div>
          )}
          <div className="rp-card-badges">
            {isGamePass && <span className="rp-badge rp-badge-gamepass">Game Pass</span>}
            {price?.isFree && <span className="rp-badge rp-badge-free">Бесплатно</span>}
            {price?.hasDiscount && price.discountPercent > 0 && (
              <span className="rp-badge rp-badge-sale">-{price.discountPercent}%</span>
            )}
          </div>
        </div>

        <div className="rp-card-body">
          <h4 className="rp-card-title">{title}</h4>
          <p className="rp-card-publisher">{developerName || publisherName || ''}</p>

          {categories?.length > 0 && (
            <div className="rp-card-genres">
              {categories.slice(0, 2).map((c) => (
                <span key={c} className="rp-genre-tag">{c}</span>
              ))}
            </div>
          )}

          <div className="rp-card-footer">
            {renderRating()}
            {renderPrice()}
          </div>
        </div>
      </Link>
    </article>
  );
}

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import FavoriteHeartButton from './FavoriteHeartButton';

export default function ProductCard({ product }) {
  const [imgError, setImgError] = useState(false);
  const { title, price, image, detailPath, platforms, tags, publisher, rating, genre, releaseInfo } = product;
  const to = detailPath || `/game/${product.id}`;
  const priceStatus = price?.status || 'unknown';

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
            {tags?.length > 0 && (
              <div className="product-badges">
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className={`badge badge-${tag.toLowerCase().replace(/\s+/g, '-')}`}>
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </Link>
          <FavoriteHeartButton product={product} />
        </div>

        <Link to={to} className="product-card-body-link">
          <div className="product-info">
          <h3 className="product-title">{title}</h3>

          {publisher && <p className="product-publisher">{publisher}</p>}

          <div className="product-meta">
            {platforms?.length > 0 && (
              <div className="product-platforms">
                {platforms.map((p) => (
                  <span key={p} className="platform-tag">{p}</span>
                ))}
              </div>
            )}

            {rating?.average && (
              <div className="product-rating">
                <span className="star">&#9733;</span>
                <span>{rating.average.toFixed(1)}</span>
              </div>
            )}
          </div>

          {genre?.length > 0 && (
            <div className="product-genres">
              {genre.slice(0, 3).map((g) => (
                <span key={g} className="genre-tag">{g}</span>
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
            {price?.discountPercent > 0 && (
              <span className="price-discount">-{Math.round(price.discountPercent)}%</span>
            )}
          </div>
        </div>
        </Link>
      </div>
    </article>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext';
import FavoriteHeartButton from '../components/FavoriteHeartButton';

export default function FavoritesPage() {
  const { items, count } = useFavorites();

  return (
    <div className="favorites-page">
      <h1 className="favorites-title">Твои сохранённые игры</h1>

      <div className="favorites-count-bar">
        В избранном <strong>{count}</strong> {count === 1 ? 'товар' : 'товаров'}
      </div>

      {count === 0 ? (
        <div className="favorites-empty">
          <p>Пока ничего нет в избранном.</p>
          <Link to="/" className="favorites-back-link">Перейти в каталог</Link>
        </div>
      ) : (
        <div className="product-grid favorites-grid">
          {items.map((p) => (
            <article key={p.id} className="product-card favorite-card">
              <div className="product-card-inner">
                <div className="product-image-wrap">
                  <Link to={p.detailPath} className="product-image-link">
                    {p.image ? (
                      <img
                        src={`${p.image}?w=330&h=330`}
                        alt={p.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className="product-image-placeholder">
                        <span>No Image</span>
                      </div>
                    )}
                  </Link>
                  <FavoriteHeartButton product={p} />
                </div>
                <Link to={p.detailPath} className="product-card-body-link">
                  <div className="product-info">
                    <h3 className="product-title">{p.title}</h3>
                    {p.publisher && <p className="product-publisher">{p.publisher}</p>}
                    <div className="product-meta">
                      {p.platforms?.length > 0 && (
                        <div className="product-platforms">
                          {p.platforms.map((pl) => (
                            <span key={pl} className="platform-tag">{pl}</span>
                          ))}
                        </div>
                      )}
                      {p.rating?.average != null && (
                        <div className="product-rating">
                          <span className="star">&#9733;</span>
                          <span>{Number(p.rating.average).toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                    {p.genre?.length > 0 && (
                      <div className="product-genres">
                        {p.genre.slice(0, 3).map((g) => (
                          <span key={g} className="genre-tag">{g}</span>
                        ))}
                      </div>
                    )}
                    <div className="product-price">
                      {p.price?.original && p.price.original > p.price.value && (
                        <span className="price-original">{p.price.originalFormatted}</span>
                      )}
                      <span className={`price-current ${p.price?.value === 0 ? 'free' : ''}`}>
                        {p.price?.formatted || '—'}
                      </span>
                      {p.price?.discountPercent > 0 && (
                        <span className="price-discount">-{Math.round(p.price.discountPercent)}%</span>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { useFavorites } from '../context/FavoritesContext';

export default function FavoriteHeartButton({ product, className = '' }) {
  const { isFavorite, toggle } = useFavorites();
  if (!product?.id) return null;
  const active = isFavorite(product.id);

  return (
    <button
      type="button"
      className={`favorite-heart ${active ? 'favorite-heart--active' : ''} ${className}`.trim()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(product);
      }}
      aria-label={active ? 'Remove from favorites' : 'Add to favorites'}
      aria-pressed={active}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
        {active ? (
          <path
            fill="currentColor"
            d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 15.25 15.25 0 0 1-3.574-3.004A8.34 8.34 0 0 1 3 10.5c0-1.84.63-3.54 1.69-4.87A6.74 6.74 0 0 1 9.75 3c1.26 0 2.44.3 3.47.84.69.37 1.29.9 1.79 1.5.5-.61 1.1-1.13 1.79-1.5A6.74 6.74 0 0 1 14.25 3c1.84 0 3.54.63 4.87 1.69A6.74 6.74 0 0 1 21 10.5c0 2.62-1.38 4.98-3.51 6.9a15.25 15.25 0 0 1-3.57 3.004l-.022.012-.007.003-.002.001-.002.001Z"
          />
        ) : (
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
          />
        )}
      </svg>
    </button>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext';
import ProductGrid from '../components/ProductGrid';

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
        <div className="favorites-grid">
          <ProductGrid products={items} />
        </div>
      )}
    </div>
  );
}

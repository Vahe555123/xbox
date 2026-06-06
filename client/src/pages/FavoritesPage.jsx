import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext';
import ProductGrid from '../components/ProductGrid';

const SORT_OPTIONS = [
  { value: 'default',     label: 'По умолчанию' },
  { value: 'title_asc',   label: 'Название А→Я' },
  { value: 'title_desc',  label: 'Название Я→А' },
  { value: 'price_asc',   label: 'Цена: по возрастанию' },
  { value: 'price_desc',  label: 'Цена: по убыванию' },
];

export default function FavoritesPage() {
  const { items, count } = useFavorites();
  const [sort, setSort] = useState('default');
  const [onlySale, setOnlySale] = useState(false);

  const displayed = useMemo(() => {
    let list = onlySale
      ? items.filter((p) => (p.price?.discountPercent ?? 0) > 0)
      : [...items];

    switch (sort) {
      case 'title_asc':
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
        break;
      case 'title_desc':
        list.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'ru'));
        break;
      case 'price_asc':
        list.sort((a, b) => (a.price?.value ?? 0) - (b.price?.value ?? 0));
        break;
      case 'price_desc':
        list.sort((a, b) => (b.price?.value ?? 0) - (a.price?.value ?? 0));
        break;
      default:
        break;
    }

    return list;
  }, [items, sort, onlySale]);

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
        <>
          <div className="favorites-toolbar">
            <label className="favorites-sale-toggle">
              <input
                type="checkbox"
                checked={onlySale}
                onChange={(e) => setOnlySale(e.target.checked)}
              />
              Только со скидкой
            </label>

            <select
              className="favorites-sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {displayed.length === 0 ? (
            <div className="favorites-empty">
              <p>Нет игр со скидкой в избранном.</p>
            </div>
          ) : (
            <div className="favorites-grid">
              <ProductGrid products={displayed} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

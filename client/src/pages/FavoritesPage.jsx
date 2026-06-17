import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function getSortPrice(p) {
  const v = Number(p?.priceRub?.amount ?? p?.price?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export default function FavoritesPage() {
  const { items, count, isFavorite } = useFavorites();
  const [sort, setSort] = useState('default');
  const [onlySale, setOnlySale] = useState(false);

  // Freeze items on first real hydration so removed items stay visible until reload
  const [frozenItems, setFrozenItems] = useState([]);
  const frozenRef = useRef(false);

  useEffect(() => {
    if (!frozenRef.current && items.length > 0 && items.some((p) => p.title && p.title !== p.id)) {
      setFrozenItems(items);
      frozenRef.current = true;
    }
  }, [items]);

  const displayItems = frozenItems.length > 0 ? frozenItems : items;

  // Items unfavorited this session but still showing (pending page reload)
  const pendingRemoval = useMemo(
    () => frozenItems.filter((p) => !isFavorite(p.id)),
    [frozenItems, isFavorite],
  );

  const displayed = useMemo(() => {
    let list = onlySale
      ? displayItems.filter((p) => (p.price?.discountPercent ?? 0) > 0)
      : [...displayItems];

    switch (sort) {
      case 'title_asc':
        list.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
        break;
      case 'title_desc':
        list.sort((a, b) => (b.title || '').localeCompare(a.title || '', 'ru'));
        break;
      case 'price_asc':
        list.sort((a, b) => {
          const av = getSortPrice(a);
          const bv = getSortPrice(b);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return av - bv;
        });
        break;
      case 'price_desc':
        list.sort((a, b) => {
          const av = getSortPrice(a);
          const bv = getSortPrice(b);
          if (av === null && bv === null) return 0;
          if (av === null) return -1;
          if (bv === null) return 1;
          return bv - av;
        });
        break;
      default:
        break;
    }

    return list;
  }, [displayItems, sort, onlySale]);

  return (
    <div className="favorites-page">
      {pendingRemoval.length > 0 && (
        <div className="favorites-removal-notice">
          {pendingRemoval.length === 1
            ? `«${pendingRemoval[0].title}» удалена из избранного.`
            : `${pendingRemoval.length} игр удалено из избранного.`}
          {' '}Исчезнет из списка после перезагрузки страницы.
        </div>
      )}

      <div className="favorites-count-bar">
        В избранном <strong>{count}</strong> {count === 1 ? 'товар' : 'товаров'}
      </div>

      {count === 0 && displayed.length === 0 ? (
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

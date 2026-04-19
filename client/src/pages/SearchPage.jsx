import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ProductGrid from '../components/ProductGrid';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ErrorMessage from '../components/ErrorMessage';

export default function SearchPage({ searchState, dealsMode = false }) {
  const navigate = useNavigate();

  const {
    query,
    products,
    total,
    hasMorePages,
    loadMore,
    loading,
    loadingMore,
    error,
    initialLoaded,
  } = searchState;

  const infiniteScrollRef = useRef(null);

  useEffect(() => {
    const node = infiniteScrollRef.current;
    if (!node || !hasMorePages || loading || loadingMore) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMore();
        }
      },
      {
        root: null,
        rootMargin: '700px 0px',
        threshold: 0,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMorePages, loadMore, loading, loadingMore, products.length]);

  return (
    <div className="search-page">
      {error && <ErrorMessage message={error} />}

      {loading && !loadingMore && <Spinner />}

      {!loading && !error && initialLoaded && products.length === 0 && (
        <EmptyState query={query} />
      )}

      {initialLoaded && products.length > 0 && (
        <div className="search-layout">
          <div className="search-results">
            <div className="results-toolbar">
              <p className="results-count">
                {dealsMode ? (
                  <>
                    <span className="results-deals-badge">🔥 Скидки</span>
                    {' '}— {total.toLocaleString()} игр со скидкой
                  </>
                ) : query ? (
                  <>Показано {products.length} из {total.toLocaleString()} по запросу <strong>"{query}"</strong></>
                ) : (
                  <>Каталог игр ({total.toLocaleString()} товаров)</>
                )}
              </p>
              {dealsMode && (
                <button
                  className="results-deals-clear"
                  onClick={() => navigate('/')}
                  type="button"
                >
                  ✕ Показать все игры
                </button>
              )}
            </div>

            <ProductGrid products={products} />

            {hasMorePages && (
              <div className="infinite-load-sentinel" ref={infiniteScrollRef} aria-live="polite">
                {loadingMore ? (
                  <>
                    <span className="infinite-loader" aria-hidden="true" />
                    Загружаем ещё товары...
                  </>
                ) : (
                  'Прокрутите ниже, чтобы загрузить ещё'
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

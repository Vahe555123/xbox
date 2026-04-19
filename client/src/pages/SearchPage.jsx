import React, { useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSearch } from '../hooks/useSearch';
import FilterPanel from '../components/FilterPanel';
import ProductGrid from '../components/ProductGrid';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import ErrorMessage from '../components/ErrorMessage';

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dealsMode = searchParams.get('deals') === 'true';

  const {
    query,
    setQuery,
    sort,
    filters: activeFilters,
    priceRange,
    applyFilters,
    clearFilters,
    products,
    total,
    filterOptions,
    hasMorePages,
    loadMore,
    loading,
    loadingMore,
    error,
    initialLoaded,
  } = useSearch({ dealsMode });

  const sortFilter = filterOptions?.orderby || null;
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
      <FilterPanel
        filters={filterOptions}
        activeFilters={activeFilters}
        onApply={applyFilters}
        onClear={clearFilters}
        query={query}
        onQueryChange={setQuery}
        sort={sort}
        sortFilter={sortFilter}
        total={total}
        priceRange={priceRange}
      />

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
                  <>Showing {products.length} of {total.toLocaleString()} results for <strong>"{query}"</strong></>
                ) : (
                  <>Browse all games ({total.toLocaleString()} games)</>
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

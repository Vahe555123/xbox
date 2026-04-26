import { useState, useEffect, useCallback, useRef } from 'react';
import { searchProducts } from '../services/api';

export function useSearch({ dealsMode = false } = {}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('');
  const [filters, setFilters] = useState({});
  const [priceRange, setPriceRange] = useState({ min: '', max: '', currency: 'USD' });

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [encodedCT, setEncodedCT] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [hasMorePages, setHasMorePages] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const abortRef = useRef(null);
  const loadMoreLockRef = useRef(false);

  const doSearch = useCallback(async (q, srt, flt, prices, ct, append) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await searchProducts({
        q: q?.trim() || undefined,
        sort: srt || undefined,
        filters: flt,
        priceRange: prices,
        encodedCT: ct || undefined,
        deals: dealsMode || undefined,
      });

      if (controller.signal.aborted) return;

      if (append) {
        setProducts((prev) => [...prev, ...result.products]);
      } else {
        setProducts(result.products);
      }
      setTotal(result.total || 0);

      setEncodedCT(result.encodedCT || null);
      setHasMorePages(result.hasMorePages || false);

      if (result.filters) {
        setFilterOptions(result.filters);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err.response?.data?.error?.message || err.message || 'Something went wrong';
      setError(msg);
      if (!append) {
        setProducts([]);
        setTotal(0);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [dealsMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setEncodedCT(null);
      doSearch(query, sort, filters, priceRange, null, false);
      if (!initialLoaded) setInitialLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, filters, priceRange, dealsMode, doSearch]);

  const loadMore = useCallback(() => {
    if (encodedCT && !loading && !loadingMore && !loadMoreLockRef.current) {
      loadMoreLockRef.current = true;
      doSearch(query, sort, filters, priceRange, encodedCT, true)
        .finally(() => {
          loadMoreLockRef.current = false;
        });
    }
  }, [encodedCT, loading, loadingMore, query, sort, filters, priceRange, doSearch]);

  const updateFilter = useCallback((key, valueId) => {
    setFilters((prev) => {
      const next = { ...prev };
      const current = next[key] || [];

      if (current.includes(valueId)) {
        const filtered = current.filter((v) => v !== valueId);
        if (filtered.length === 0) {
          delete next[key];
        } else {
          next[key] = filtered;
        }
      } else {
        next[key] = [...current, valueId];
      }

      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSort('');
    setPriceRange({ min: '', max: '', currency: 'USD' });
  }, [dealsMode]);

  const applyFilters = useCallback(({ filters: nextFilters, sort: nextSort, priceRange: nextPriceRange }) => {
    setFilters(nextFilters || {});
    setSort(nextSort || '');
    setPriceRange({
      min: nextPriceRange?.min || '',
      max: nextPriceRange?.max || '',
      currency: nextPriceRange?.currency || 'USD',
    });
    setEncodedCT(null);
  }, []);

  return {
    query,
    setQuery,
    sort,
    setSort,
    filters,
    priceRange,
    updateFilter,
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
  };
}

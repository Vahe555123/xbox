import { useState, useEffect, useCallback, useRef } from 'react';
import { searchProducts } from '../services/api';

const EMPTY_PRICE_RANGE = { min: '', max: '', currency: 'USD' };

function normalizeFiltersState(filters) {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function normalizePriceRangeState(priceRange) {
  return {
    min: priceRange?.min ?? '',
    max: priceRange?.max ?? '',
    currency: priceRange?.currency || 'USD',
  };
}

function serializeSearchState({ query, sort, filters, priceRange }) {
  return JSON.stringify({
    query: query || '',
    sort: sort || '',
    filters: normalizeFiltersState(filters),
    priceRange: normalizePriceRangeState(priceRange),
  });
}

export function useSearch({
  dealsMode = false,
  enabled = true,
  initialQuery = '',
  initialSort = '',
  initialFilters = {},
  initialPriceRange = EMPTY_PRICE_RANGE,
} = {}) {
  const [query, setQuery] = useState(initialQuery || '');
  const [sort, setSort] = useState(initialSort || '');
  const [filters, setFilters] = useState(() => normalizeFiltersState(initialFilters));
  const [priceRange, setPriceRange] = useState(() => normalizePriceRangeState(initialPriceRange));

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPending, setTotalPending] = useState(false);
  const [encodedCT, setEncodedCT] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);
  const [hasMorePages, setHasMorePages] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const abortRef = useRef(null);
  const countAbortRef = useRef(null);
  const loadMoreLockRef = useRef(false);
  const latestStateRef = useRef(
    serializeSearchState({
      query: initialQuery,
      sort: initialSort,
      filters: initialFilters,
      priceRange: initialPriceRange,
    }),
  );

  const cancelExactCount = useCallback(() => {
    if (countAbortRef.current) {
      countAbortRef.current.abort();
      countAbortRef.current = null;
    }
  }, []);

  const fetchExactTotal = useCallback(async (q, srt, flt, prices) => {
    cancelExactCount();
    const controller = new AbortController();
    countAbortRef.current = controller;

    try {
      const result = await searchProducts({
        q: q?.trim() || undefined,
        sort: srt || undefined,
        filters: flt,
        priceRange: prices,
        deals: dealsMode || undefined,
        countOnly: true,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      setTotal(Number.isFinite(result.total) ? result.total : 0);
      setTotalPending(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setTotalPending(false);
    } finally {
      if (countAbortRef.current === controller) {
        countAbortRef.current = null;
      }
    }
  }, [cancelExactCount, dealsMode]);

  const doSearch = useCallback(async (q, srt, flt, prices, ct, append) => {
    if (abortRef.current) abortRef.current.abort();
    if (!append) cancelExactCount();
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
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (append) {
        setProducts((prev) => [...prev, ...result.products]);
      } else {
        setProducts(result.products);
      }
      if (append) {
        if (result.totalPending) {
          setTotal((prev) => prev + result.products.length);
        } else if (Number.isFinite(result.total)) {
          setTotal(result.total);
        }
      } else {
        setTotal(result.totalPending ? result.products.length : (Number.isFinite(result.total) ? result.total : 0));
        setTotalPending(Boolean(result.totalPending));
        if (result.totalPending) {
          fetchExactTotal(q, srt, flt, prices);
        }
      }

      setEncodedCT(result.encodedCT || null);
      setHasMorePages(result.hasMorePages || false);

      if (result.filters) {
        setFilterOptions(result.filters);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err.response?.data?.error?.message || err.message || 'Something went wrong';
      setError(msg);
      setTotalPending(false);
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
  }, [cancelExactCount, dealsMode, fetchExactTotal]);

  useEffect(() => {
    latestStateRef.current = serializeSearchState({ query, sort, filters, priceRange });
  }, [filters, priceRange, query, sort]);

  useEffect(() => {
    if (!enabled) return undefined;

    const timer = setTimeout(() => {
      setEncodedCT(null);
      doSearch(query, sort, filters, priceRange, null, false);
      if (!initialLoaded) setInitialLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query, sort, filters, priceRange, dealsMode, doSearch]);

  useEffect(() => {
    if (enabled) return;
    if (abortRef.current) abortRef.current.abort();
    cancelExactCount();
  }, [cancelExactCount, enabled]);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
    if (countAbortRef.current) countAbortRef.current.abort();
  }, []);

  const loadMore = useCallback(() => {
    if (!enabled) return Promise.resolve();
    if (encodedCT && !loading && !loadingMore && !loadMoreLockRef.current) {
      loadMoreLockRef.current = true;
      return doSearch(query, sort, filters, priceRange, encodedCT, true)
        .finally(() => {
          loadMoreLockRef.current = false;
        });
    }
    return Promise.resolve();
  }, [enabled, encodedCT, loading, loadingMore, query, sort, filters, priceRange, doSearch]);

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
    setQuery('');
    setFilters({});
    setSort('');
    setPriceRange(EMPTY_PRICE_RANGE);
  }, []);

  const applyFilters = useCallback(({ filters: nextFilters, sort: nextSort, priceRange: nextPriceRange }) => {
    setFilters(nextFilters || {});
    setSort(nextSort || '');
    setPriceRange(normalizePriceRangeState(nextPriceRange));
    setEncodedCT(null);
  }, []);

  const replaceSearchState = useCallback((nextState = {}) => {
    const normalizedState = {
      query: nextState.query || '',
      sort: nextState.sort || '',
      filters: normalizeFiltersState(nextState.filters),
      priceRange: normalizePriceRangeState(nextState.priceRange),
    };
    const nextSerialized = serializeSearchState(normalizedState);
    if (latestStateRef.current === nextSerialized) return;

    setQuery(normalizedState.query);
    setSort(normalizedState.sort);
    setFilters(normalizedState.filters);
    setPriceRange(normalizedState.priceRange);
    setEncodedCT(null);
  }, []);

  return {
    query,
    setQuery,
    sort,
    setSort,
    filters,
    setFilters,
    priceRange,
    setPriceRange,
    updateFilter,
    applyFilters,
    clearFilters,
    replaceSearchState,
    products,
    total,
    totalPending,
    filterOptions,
    hasMorePages,
    loadMore,
    loading,
    loadingMore,
    error,
    initialLoaded,
  };
}

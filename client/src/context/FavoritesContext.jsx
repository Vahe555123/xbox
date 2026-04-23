import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  addFavorite,
  deleteFavorite,
  fetchFavorites,
  fetchRelatedProducts,
  syncFavorites,
} from '../services/api';

const STORAGE_KEY = 'xbox-favorite-ids-v1';
const LEGACY_STORAGE_KEY = 'xbox-favorites-v1';

function normalizeFavoriteId(item) {
  const id = typeof item === 'string'
    ? item
    : item?.id || item?.productId || item?.product?.id || item?.product?.productId;
  const normalized = String(id || '').trim().toUpperCase();
  return normalized || null;
}

function uniqueIds(values) {
  return (Array.isArray(values) ? values : [])
    .map(normalizeFavoriteId)
    .filter(Boolean)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function readJsonArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredIds() {
  const current = uniqueIds(readJsonArray(STORAGE_KEY));
  if (current.length) return current;
  return uniqueIds(readJsonArray(LEGACY_STORAGE_KEY));
}

function fallbackItems(ids) {
  return ids.map((id) => ({
    id,
    title: id,
    detailPath: `/game/${id}`,
    price: null,
  }));
}

const FavoritesContext = createContext(null);

export function FavoritesProvider({ children }) {
  const [favoriteIds, setFavoriteIds] = useState(readStoredIds);
  const [items, setItems] = useState(() => fallbackItems(readStoredIds()));
  const [serverReady, setServerReady] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteIds));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [favoriteIds]);

  const hydrateFavoriteItems = useCallback(async (ids) => {
    if (!ids.length) {
      setItems([]);
      return;
    }

    try {
      const response = await fetchRelatedProducts(ids);
      const products = response.products || [];
      const byId = new Map(products.map((product) => [String(product.id || '').toUpperCase(), product]));
      setItems(ids.map((id) => byId.get(id) || fallbackItems([id])[0]));
    } catch {
      setItems(fallbackItems(ids));
    }
  }, []);

  const loadServerFavorites = useCallback(async () => {
    const localIds = readStoredIds();
    try {
      const remoteItems = await syncFavorites(localIds);
      const remoteIds = uniqueIds(remoteItems);
      setFavoriteIds(remoteIds);
      await hydrateFavoriteItems(remoteIds);
      setServerReady(true);
    } catch {
      setFavoriteIds(localIds);
      hydrateFavoriteItems(localIds);
      setServerReady(false);
    }
  }, [hydrateFavoriteItems]);

  useEffect(() => {
    loadServerFavorites();
    window.addEventListener('auth-changed', loadServerFavorites);
    return () => window.removeEventListener('auth-changed', loadServerFavorites);
  }, [loadServerFavorites]);

  useEffect(() => {
    hydrateFavoriteItems(favoriteIds);
  }, [favoriteIds, hydrateFavoriteItems]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY || e.key === LEGACY_STORAGE_KEY) {
        setFavoriteIds(readStoredIds());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const isFavorite = useCallback(
    (id) => favoriteIds.includes(String(id || '').trim().toUpperCase()),
    [favoriteIds],
  );

  const toggle = useCallback((product) => {
    const id = normalizeFavoriteId(product);
    if (!id) return;
    const exists = favoriteIds.includes(id);

    setFavoriteIds((prev) => (
      prev.includes(id)
        ? prev.filter((itemId) => itemId !== id)
        : [...prev, id]
    ));

    if (serverReady) {
      const request = exists ? deleteFavorite(id) : addFavorite(id);
      request.catch(() => {
        fetchFavorites()
          .then((remoteItems) => setFavoriteIds(uniqueIds(remoteItems)))
          .catch(() => setServerReady(false));
      });
    }
  }, [favoriteIds, serverReady]);

  const remove = useCallback((id) => {
    const normalizedId = normalizeFavoriteId(id);
    if (!normalizedId) return;

    setFavoriteIds((prev) => prev.filter((itemId) => itemId !== normalizedId));
    if (serverReady) {
      deleteFavorite(normalizedId).catch(() => {
        fetchFavorites()
          .then((remoteItems) => setFavoriteIds(uniqueIds(remoteItems)))
          .catch(() => setServerReady(false));
      });
    }
  }, [serverReady]);

  const value = useMemo(
    () => ({
      items,
      count: favoriteIds.length,
      favoriteIds,
      isFavorite,
      toggle,
      remove,
    }),
    [items, favoriteIds, isFavorite, toggle, remove],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }
  return ctx;
}

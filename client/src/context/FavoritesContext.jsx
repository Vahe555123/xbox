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
  syncFavorites,
} from '../services/api';

const STORAGE_KEY = 'xbox-favorites-v1';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function snapshotFromProduct(product) {
  if (!product?.id) return null;
  return {
    id: product.id,
    title: product.title,
    image: product.image || null,
    detailPath: product.detailPath || `/game/${product.id}`,
    platforms: product.platforms || [],
    genre: product.genre || [],
    price: product.price || null,
    priceRub: product.priceRub || null,
    paymentPrices: product.paymentPrices || null,
    topupCombo: product.topupCombo || null,
    publisher: product.publisher || null,
    rating: product.rating || null,
    subscriptions: product.subscriptions || null,
    subscriptionLabels: product.subscriptionLabels || [],
    supportedLanguages: product.supportedLanguages || [],
    hasRussianLanguage: Boolean(product.hasRussianLanguage),
    gamePassSavingsPercent: product.gamePassSavingsPercent || null,
  };
}

const FavoritesContext = createContext(null);

export function FavoritesProvider({ children }) {
  const [items, setItems] = useState(readStored);
  const [serverReady, setServerReady] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const loadServerFavorites = useCallback(async () => {
    try {
      const localItems = readStored();
      const remoteItems = await syncFavorites(localItems);
      setItems(remoteItems);
      setServerReady(true);
    } catch {
      setServerReady(false);
    }
  }, []);

  useEffect(() => {
    loadServerFavorites();
    window.addEventListener('auth-changed', loadServerFavorites);
    return () => window.removeEventListener('auth-changed', loadServerFavorites);
  }, [loadServerFavorites]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setItems(JSON.parse(e.newValue));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const isFavorite = useCallback(
    (id) => items.some((i) => i.id === id),
    [items],
  );

  const toggle = useCallback((product) => {
    const snap = snapshotFromProduct(product);
    if (!snap) return;
    const exists = items.some((i) => i.id === snap.id);

    setItems((prev) => {
      if (prev.some((i) => i.id === snap.id)) {
        return prev.filter((i) => i.id !== snap.id);
      }
      return [...prev, snap];
    });

    if (serverReady) {
      const request = exists ? deleteFavorite(snap.id) : addFavorite(snap);
      request.catch(() => {
        fetchFavorites()
          .then(setItems)
          .catch(() => setServerReady(false));
      });
    }
  }, [items, serverReady]);

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (serverReady) {
      deleteFavorite(id).catch(() => {
        fetchFavorites()
          .then(setItems)
          .catch(() => setServerReady(false));
      });
    }
  }, [serverReady]);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      isFavorite,
      toggle,
      remove,
    }),
    [items, isFavorite, toggle, remove],
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

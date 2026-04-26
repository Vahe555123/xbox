import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { fetchRelatedProducts } from '../services/api';

const STORAGE_KEY = 'xbox-cart-ids-v1';

function normalizeId(value) {
  const id = typeof value === 'string'
    ? value
    : value?.id || value?.productId;
  const normalized = String(id || '').trim().toUpperCase();
  return normalized || null;
}

function uniqueIds(values) {
  return (Array.isArray(values) ? values : [])
    .map(normalizeId)
    .filter(Boolean)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function readStoredIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return uniqueIds(parsed);
  } catch {
    return [];
  }
}

function fallbackItem(id) {
  return { id, title: id, detailPath: `/game/${id}`, price: null };
}

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [ids, setIds] = useState(readStoredIds);
  const [items, setItems] = useState(() => readStoredIds().map(fallbackItem));
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, [ids]);

  const hydrate = useCallback(async (currentIds) => {
    if (!currentIds.length) {
      setItems([]);
      return;
    }
    setHydrating(true);
    try {
      const response = await fetchRelatedProducts(currentIds);
      const products = response.products || [];
      const byId = new Map(products.map((p) => [String(p.id || '').toUpperCase(), p]));
      setItems(currentIds.map((id) => byId.get(id) || fallbackItem(id)));
    } catch {
      setItems(currentIds.map(fallbackItem));
    } finally {
      setHydrating(false);
    }
  }, []);

  useEffect(() => {
    hydrate(ids);
  }, [ids, hydrate]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setIds(readStoredIds());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const inCart = useCallback(
    (id) => ids.includes(String(id || '').trim().toUpperCase()),
    [ids],
  );

  const add = useCallback((product) => {
    const id = normalizeId(product);
    if (!id) return;
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const remove = useCallback((id) => {
    const normalized = normalizeId(id);
    if (!normalized) return;
    setIds((prev) => prev.filter((item) => item !== normalized));
  }, []);

  const toggle = useCallback((product) => {
    const id = normalizeId(product);
    if (!id) return;
    setIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const clear = useCallback(() => {
    setIds([]);
  }, []);

  const refresh = useCallback(() => hydrate(ids), [hydrate, ids]);

  const value = useMemo(
    () => ({ ids, items, count: ids.length, hydrating, inCart, add, remove, toggle, clear, refresh }),
    [ids, items, hydrating, inCart, add, remove, toggle, clear, refresh],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 20000,
  withCredentials: true,
  headers: { 'Accept': 'application/json' },
});

api.interceptors.request.use((config) => {
  try {
    const user = JSON.parse(localStorage.getItem('auth:user') || 'null');
    if (user?.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
  } catch {
    /* ignore */
  }
  return config;
});

export async function searchProducts({ q, sort, filters, encodedCT, countOnly, signal }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (encodedCT) params.set('encodedCT', encodedCT);
  if (countOnly) params.set('countOnly', 'true');

  if (filters && typeof filters === 'object') {
    for (const [key, values] of Object.entries(filters)) {
      if (Array.isArray(values) && values.length > 0) {
        if (key === 'LanguageMode') {
          params.set('languageMode', values[0]);
          continue;
        }
        values.forEach((value) => params.append(key, value));
      }
    }
  }

  const { data } = await api.get('/xbox/search', { params, signal });
  return data;
}

export async function fetchProductDetail(productId) {
  const { data } = await api.get(`/xbox/product/${encodeURIComponent(productId)}`);
  return data;
}

export async function fetchProductLocalizedDescription(productId, { locale = 'ru-UA', signal } = {}) {
  const { data } = await api.get(`/xbox/product/${encodeURIComponent(productId)}/description`, {
    params: { locale },
    signal,
  });
  return data;
}

export async function createProductPurchase(productId, payload) {
  const { data } = await api.post(`/xbox/product/${encodeURIComponent(productId)}/purchase`, payload);
  return data;
}

export async function createCartPurchase(payload) {
  const { data } = await api.post('/xbox/cart/purchase', payload);
  return data;
}

export async function fetchRelatedProducts(productIds, relationMap) {
  if (!productIds || productIds.length === 0) return { products: [] };
  const params = { ids: productIds.join(',') };
  if (relationMap) {
    params.relationMap = JSON.stringify(relationMap);
  }
  const { data } = await api.get('/xbox/products/batch', { params });
  return data;
}

export async function fetchSupportLinks() {
  const { data } = await api.get('/support-links');
  return data.links || {};
}

export async function registerUser(email, password) {
  const { data } = await api.post('/auth/register', { email, password });
  return data;
}

export async function verifyEmailCode(email, code) {
  const { data } = await api.post('/auth/verify', { email, code });
  return data;
}

export async function loginUser(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function fetchAuthProviders() {
  const { data } = await api.get('/auth/providers');
  return data.providers;
}

export async function consumeOAuthSession(sessionId) {
  const { data } = await api.get(`/auth/oauth/session/${encodeURIComponent(sessionId)}`);
  return data;
}

export async function loginWithTelegram(payload) {
  const { data } = await api.post('/auth/telegram', payload);
  return data;
}

export async function fetchProfile() {
  const { data } = await api.get('/auth/me');
  return data;
}

export async function updatePurchaseSettings(payload) {
  const { data } = await api.put('/auth/purchase-settings', payload);
  return data.purchaseSettings;
}

export async function changePassword(currentPassword, newPassword) {
  const { data } = await api.post('/auth/change-password', {
    currentPassword,
    newPassword,
  });
  return data;
}

export async function fetchFavorites() {
  const { data } = await api.get('/favorites');
  return data.items || [];
}

export async function addFavorite(productId) {
  const { data } = await api.post('/favorites', { productId });
  return data.item;
}

export async function deleteFavorite(productId) {
  const { data } = await api.delete(`/favorites/${encodeURIComponent(productId)}`);
  return data;
}

export async function syncFavorites(items) {
  const { data } = await api.put('/favorites/sync', { items });
  return data.items || [];
}

// Admin API
export async function checkAdmin() {
  const { data } = await api.get('/admin/check');
  return data.isAdmin;
}

export async function fetchAdminStats() {
  const { data } = await api.get('/admin/stats');
  return data;
}

export async function fetchAdminUsers({ page = 1, limit = 20, search = '' } = {}) {
  const params = { page, limit };
  if (search) params.search = search;
  const { data } = await api.get('/admin/users', { params });
  return data;
}

export async function fetchAdminUserDetail(userId) {
  const { data } = await api.get(`/admin/users/${encodeURIComponent(userId)}`);
  return data;
}

export async function fetchAdminNotifications({ page = 1, limit = 30 } = {}) {
  const params = { page, limit };
  const { data } = await api.get('/admin/notifications', { params });
  return data;
}

export async function searchAdminProducts(options = {}) {
  const params = typeof options === 'string' ? { q: options } : { ...options };
  if (!params.q) delete params.q;
  if (!params.languageMode || params.languageMode === 'all') delete params.languageMode;
  const { data } = await api.get('/admin/products/search', { params });
  return data.products || [];
}

export async function fetchProductOverrides({ page = 1, limit = 50, search = '' } = {}) {
  const { data } = await api.get('/admin/product-overrides', { params: { page, limit, search } });
  return data;
}

export async function fetchAdminSupportLinks() {
  const { data } = await api.get('/admin/support-links');
  return data.links || {};
}

export async function updateAdminSupportLinks(payload) {
  const { data } = await api.put('/admin/support-links', payload);
  return data.links || {};
}

export async function updateProductOverride(productId, payload) {
  const { data } = await api.put(`/admin/product-overrides/${encodeURIComponent(productId)}`, payload);
  return data.override;
}

export async function deleteProductOverride(productId) {
  const { data } = await api.delete(`/admin/product-overrides/${encodeURIComponent(productId)}`);
  return data;
}

export async function fetchSchedulerState() {
  const { data } = await api.get('/admin/scheduler');
  return data;
}

export async function updateSchedulerInterval(intervalHours) {
  const { data } = await api.put('/admin/scheduler', { intervalHours });
  return data;
}

export async function triggerDealCheck() {
  const { data } = await api.post('/admin/deal-check', {}, { timeout: 180000 });
  return data;
}

export async function fetchDigisellerRates(mode = 'oplata') {
  const { data } = await api.get('/admin/digiseller/rates', { params: { mode } });
  return data;
}

export async function refreshDigisellerRates(mode = 'oplata') {
  const { data } = await api.post('/admin/digiseller/rates/refresh', { mode });
  return data;
}

export async function fetchTopupCards() {
  const { data } = await api.get('/admin/topup-cards');
  return data;
}

export async function refreshTopupCards() {
  const { data } = await api.post('/admin/topup-cards/refresh');
  return data;
}

export async function updateTopupCard(usdValue, payload) {
  const { data } = await api.put(`/admin/topup-cards/${encodeURIComponent(usdValue)}`, payload);
  return data.card;
}

export async function previewTopupCombo(priceUsd) {
  const { data } = await api.get('/admin/topup-cards/preview', { params: { priceUsd } });
  return data;
}

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

export async function searchProducts({ q, sort, filters, priceRange, encodedCT, deals }) {
  const params = {};
  if (q) params.q = q;
  if (sort) params.sort = sort;
  if (encodedCT) params.encodedCT = encodedCT;
  if (priceRange?.min) params.minPrice = priceRange.min;
  if (priceRange?.max) params.maxPrice = priceRange.max;
  if (priceRange?.currency) params.priceCurrency = priceRange.currency;
  if (deals) params.deals = 'true';

  if (filters && typeof filters === 'object') {
    for (const [key, values] of Object.entries(filters)) {
      if (Array.isArray(values) && values.length > 0) {
        if (key === 'LanguageMode') {
          params.languageMode = values[0];
          continue;
        }
        if (key === 'DealsOnly') {
          params.deals = 'true';
          continue;
        }
        if (key === 'FreeOnly') {
          params.freeOnly = 'true';
          continue;
        }
        params[key] = values.join(',');
      }
    }
  }

  const { data } = await api.get('/xbox/search', { params });
  return data;
}

export async function fetchProductDetail(productId) {
  const { data } = await api.get(`/xbox/product/${encodeURIComponent(productId)}`);
  return data;
}

export async function createProductPurchase(productId, payload) {
  const { data } = await api.post(`/xbox/product/${encodeURIComponent(productId)}/purchase`, payload);
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

export async function addFavorite(product) {
  const { data } = await api.post('/favorites', { product });
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

export async function fetchSchedulerState() {
  const { data } = await api.get('/admin/scheduler');
  return data;
}

export async function updateSchedulerInterval(intervalHours) {
  const { data } = await api.put('/admin/scheduler', { intervalHours });
  return data;
}

export async function triggerDealCheck() {
  const { data } = await api.post('/admin/deal-check');
  return data;
}

export async function fetchDigisellerMappings({ page = 1, limit = 50, search = '' } = {}) {
  const params = { page, limit };
  if (search) params.search = search;
  const { data } = await api.get('/admin/digiseller', { params });
  return data;
}

export async function fetchDigisellerRates() {
  const { data } = await api.get('/admin/digiseller/rates');
  return data;
}

export async function refreshDigisellerRates() {
  const { data } = await api.post('/admin/digiseller/rates/refresh');
  return data;
}

export async function saveDigisellerMapping({ productId, digisellerId, note }) {
  const { data } = await api.post('/admin/digiseller', { productId, digisellerId, note });
  return data.item;
}

export async function deleteDigisellerMapping(productId) {
  const { data } = await api.delete(`/admin/digiseller/${encodeURIComponent(productId)}`);
  return data;
}

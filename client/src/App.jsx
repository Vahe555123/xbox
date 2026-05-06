import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import GameDetailPage from './pages/GameDetailPage';
import FavoritesPage from './pages/FavoritesPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import HelpPage from './pages/HelpPage';
import AuthModal from './components/AuthModal';
import FilterPanel from './components/FilterPanel';
import SupportWidget from './components/SupportWidget';
import { useFavorites } from './context/FavoritesContext';
import { useCart } from './context/CartContext';
import CartPage from './pages/CartPage';
import { useSearch } from './hooks/useSearch';
import { consumeOAuthSession, checkAdmin } from './services/api';

const FILTER_QUERY_KEYS = [
  'PlayWith',
  'Price',
  'Genre',
  'MaturityRating',
  'Multiplayer',
  'TechnicalFeatures',
  'IncludedInSubscription',
  'HandheldCompatibility',
  'SpecialOffers',
];

const DEFAULT_BROWSE_SORT = 'WishlistCountTotal desc';
const DEALS_FILTER_KEY = 'Price';
const DEALS_FILTER_VALUE = 'OnSale';

function isMobileNavigationViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 900;
}

function cloneFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function parseFilterValues(values) {
  const items = Array.isArray(values) ? values : [values];

  return items
    .flatMap((value) => String(value || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function getParamValues(params, key) {
  const values = parseFilterValues(params.getAll(key));
  if (values.length > 0) return values;

  const fallbackValue = params.get(key);
  return fallbackValue ? parseFilterValues(fallbackValue) : [];
}

function resolveDefaultCatalogSort({ query, sort }) {
  const normalizedQuery = String(query || '').trim();
  const normalizedSort = String(sort || '').trim();

  if (normalizedSort) return normalizedSort;
  if (normalizedQuery) return '';
  return DEFAULT_BROWSE_SORT;
}

function readCatalogState(searchString = '') {
  const params = new URLSearchParams(searchString);
  const query = String(params.get('q') || '').trim();
  const sort = resolveDefaultCatalogSort({
    query,
    sort: String(params.get('sort') || '').trim(),
  });
  const filters = {};

  FILTER_QUERY_KEYS.forEach((key) => {
    const values = getParamValues(params, key);
    if (values.length > 0) {
      filters[key] = values;
    }
  });

  const languageMode = String(params.get('languageMode') || '').trim();
  if (languageMode) {
    filters.LanguageMode = [languageMode];
  }

  // Keep legacy links working, but do not serialize them back to the URL.
  if (params.get('deals') === 'true') {
    filters.Price = Array.from(new Set([...(filters.Price || []), DEALS_FILTER_VALUE]));
  }

  if (params.get('freeOnly') === 'true') {
    filters.Price = Array.from(new Set([...(filters.Price || []), 'Free']));
  }

  return {
    query,
    sort,
    filters,
  };
}

function buildCatalogUrl({ query = '', sort = '', filters = {} } = {}) {
  const params = new URLSearchParams();
  const normalizedFilters = cloneFilters(filters);
  const normalizedQuery = String(query || '').trim();
  const normalizedSort = String(sort || '').trim();
  const effectiveSort = resolveDefaultCatalogSort({ query: normalizedQuery, sort: normalizedSort });

  if (normalizedQuery) {
    params.set('q', normalizedQuery);
  }

  if (effectiveSort && !(effectiveSort === DEFAULT_BROWSE_SORT && !normalizedQuery)) {
    params.set('sort', effectiveSort);
  }

  FILTER_QUERY_KEYS.forEach((key) => {
    const values = Array.isArray(normalizedFilters[key]) ? normalizedFilters[key].filter(Boolean) : [];
    values.forEach((value) => params.append(key, value));
  });

  const languageMode = normalizedFilters.LanguageMode?.[0];
  if (languageMode) {
    params.set('languageMode', languageMode);
  }

  const search = params.toString();
  return search ? `/?${search}` : '/';
}

function withFilterValue(filters, key, value, enabled) {
  const nextFilters = cloneFilters(filters);
  const nextValues = new Set(nextFilters[key] || []);

  if (enabled) {
    nextValues.add(value);
  } else {
    nextValues.delete(value);
  }

  if (nextValues.size === 0) {
    delete nextFilters[key];
  } else {
    nextFilters[key] = [...nextValues];
  }

  return nextFilters;
}

function HeaderFavoritesLink({ active = false, onClick }) {
  const { count } = useFavorites();

  return (
    <Link
      to="/favorites"
      className={`header-favorites-link ${active ? 'active' : ''}`}
      title="Избранное"
      onClick={onClick}
    >
      <span className="header-favorites-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 15.25 15.25 0 0 1-3.574-3.004A8.34 8.34 0 0 1 3 10.5c0-1.84.63-3.54 1.69-4.87A6.74 6.74 0 0 1 9.75 3c1.26 0 2.44.3 3.47.84.69.37 1.29.9 1.79 1.5.5-.61 1.1-1.13 1.79-1.5A6.74 6.74 0 0 1 14.25 3c1.84 0 3.54.63 4.87 1.69A6.74 6.74 0 0 1 21 10.5c0 2.62-1.38 4.98-3.51 6.9a15.25 15.25 0 0 1-3.57 3.004l-.022.012-.007.003-.002.001-.002.001Z"
          />
        </svg>
      </span>
      <span className="header-favorites-label">Избранное</span>
      {count > 0 && <span className="header-favorites-badge">{count}</span>}
    </Link>
  );
}

function HeaderCartLink({ active = false, onClick }) {
  const { count } = useCart();

  return (
    <Link
      to="/cart"
      className={`header-favorites-link header-cart-link ${active ? 'active' : ''}`}
      title="Корзина"
      onClick={onClick}
    >
      <span className="header-favorites-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M7 4h-2l-1 2v2h2l3.6 7.59-1.35 2.45C8.16 18.37 8.79 19.5 10 19.5h12v-2H10.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23 6.5H7.21l-.94-2zM7 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
          />
        </svg>
      </span>
      <span className="header-favorites-label">Корзина</span>
      {count > 0 && <span className="header-favorites-badge">{count}</span>}
    </Link>
  );
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth:user')) || null;
  } catch (_err) {
    return null;
  }
}

export default function App() {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(readStoredUser);
  const [authNotice, setAuthNotice] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isCatalogRoute = location.pathname === '/';
  const urlCatalogState = useMemo(() => readCatalogState(location.search), [location.search]);
  const isDealsActive = isCatalogRoute && Boolean(urlCatalogState.filters?.Price?.includes(DEALS_FILTER_VALUE));
  const isHomeActive = isCatalogRoute && !isDealsActive;
  const searchState = useSearch({
    enabled: isCatalogRoute,
    initialQuery: urlCatalogState.query,
    initialSort: urlCatalogState.sort,
    initialFilters: urlCatalogState.filters,
  });
  const sortFilter = searchState.filterOptions?.orderby || null;
  const currentCatalogState = useMemo(() => ({
    query: searchState.query,
    sort: searchState.sort,
    filters: searchState.filters,
  }), [searchState.filters, searchState.query, searchState.sort]);
  const dealsToggleUrl = useMemo(() => buildCatalogUrl({
    ...currentCatalogState,
    filters: withFilterValue(currentCatalogState.filters, DEALS_FILTER_KEY, DEALS_FILTER_VALUE, !isDealsActive),
  }), [currentCatalogState, isDealsActive]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    if (!isCatalogRoute) return;
    searchState.replaceSearchState(urlCatalogState);
  }, [isCatalogRoute, searchState.replaceSearchState, urlCatalogState]);

  const navigateToCatalog = (nextState) => {
    navigate(buildCatalogUrl(nextState));
  };

  const handleGlobalQueryChange = (value) => {
    navigateToCatalog({
      ...currentCatalogState,
      query: value,
    });
  };

  const handleGlobalApplyFilters = (payload) => {
    navigateToCatalog({
      ...currentCatalogState,
      filters: payload?.filters || {},
      sort: payload?.sort || '',
    });
  };

  const handleGlobalClearFilters = () => {
    navigate('/');
  };

  const handleClearDeals = () => {
    navigateToCatalog({
      ...currentCatalogState,
      filters: withFilterValue(currentCatalogState.filters, DEALS_FILTER_KEY, DEALS_FILTER_VALUE, false),
    });
  };

  const handleAuth = (user) => {
    setCurrentUser(user);
    localStorage.setItem('auth:user', JSON.stringify(user));
    window.dispatchEvent(new Event('auth-changed'));
  };

  const handleLogout = () => {
    localStorage.removeItem('auth:user');
    setCurrentUser(null);
    setIsAdmin(false);
    window.dispatchEvent(new Event('auth-changed'));
    closeMobileMenu();
    navigate('/');
  };

  const handleProfileAction = () => {
    closeMobileMenu();
    if (currentUser) {
      window.location.assign('/profile');
      return;
    }
    setAuthModalOpen(true);
  };

  const handleMobileNavClickCapture = (event) => {
    if (!isMobileNavigationViewport()) return;
    if (event.target.closest('a, button')) {
      closeMobileMenu();
    }
  };

  useEffect(() => {
    if (!currentUser) {
      setIsAdmin(false);
      return;
    }

    checkAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, [currentUser]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get('auth_session');
    const authError = url.searchParams.get('auth_error');

    const clearAuthParams = () => {
      url.searchParams.delete('auth_session');
      url.searchParams.delete('auth_error');
      url.searchParams.delete('auth_provider');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };

    if (authError) {
      setAuthNotice(authError);
      setAuthModalOpen(true);
      clearAuthParams();
      return;
    }

    if (!sessionId) return;

    consumeOAuthSession(sessionId)
      .then((res) => {
        handleAuth({ ...(res.user || {}), token: res.token });
      })
      .catch((err) => {
        setAuthNotice(err.response?.data?.error?.message || err.message || 'Social login failed');
        setAuthModalOpen(true);
      })
      .finally(clearAuthParams);
  }, []);

  useEffect(() => {
    closeMobileMenu();
  }, [location.pathname, location.search]);

  useEffect(() => {
    document.body.classList.toggle('mobile-menu-open', mobileMenuOpen);

    return () => {
      document.body.classList.remove('mobile-menu-open');
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeMobileMenu();
      }
    };

    const handleResize = () => {
      if (!isMobileNavigationViewport()) {
        closeMobileMenu();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileMenuOpen]);

  return (
    <div className={`app ${mobileMenuOpen ? 'app-mobile-menu-open' : ''}`}>
      <header className="app-header">
        <div className="header-inner">
          <h1 className="logo">
            <Link to="/" className="logo-link" onClick={closeMobileMenu}>
              <span className="logo-icon">&#127918;</span>
              <span className="logo-text">Xbox Game Search</span>
            </Link>
          </h1>

          <button
            type="button"
            className={`mobile-menu-toggle ${mobileMenuOpen ? 'active' : ''}`}
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-controls="site-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((value) => !value)}
          >
            <span className="mobile-menu-toggle-bar" />
            <span className="mobile-menu-toggle-bar" />
            <span className="mobile-menu-toggle-bar" />
          </button>

          {mobileMenuOpen && (
            <button
              type="button"
              className="top-nav-backdrop"
              aria-label="Close menu"
              onClick={closeMobileMenu}
            />
          )}

          <nav
            id="site-navigation"
            className={`top-nav ${mobileMenuOpen ? 'top-nav-open' : ''}`}
            aria-label="Основная навигация"
            onClickCapture={handleMobileNavClickCapture}
          >
            <div className="top-nav-mobile-header">
              <div className="top-nav-mobile-title">Menu</div>
              <button
                type="button"
                className="top-nav-mobile-close"
                aria-label="Close menu"
                onClick={closeMobileMenu}
              >
                x
              </button>
            </div>

            <Link to="/" className={`top-nav-link top-nav-home ${isHomeActive ? 'active' : ''}`}>
              Каталог игр
            </Link>

            <Link
              to={dealsToggleUrl}
              className={`top-nav-link top-nav-sale ${isDealsActive ? 'active' : ''}`}
            >
              Скидки
            </Link>

            <a className="top-nav-link top-nav-gamepass" href="https://xboxportal.ru/product/4687274">
              Game Pass
            </a>

            <a className="top-nav-link" href="https://xboxportal.ru/category/152018">
              Игровая валюта
            </a>

            <a className="top-nav-link" href="https://xboxportal.ru/category/149289">
              Подписки
            </a>

            <a className="top-nav-link" href="https://xboxportal.ru/category/149293">
              Аккаунт
            </a>

            <a className="top-nav-link top-nav-link--wide" href="https://xboxportal.ru/category/154890">
              Коды пополнения баланса
            </a>

            <Link to="/help" className="top-nav-link">
              Помощь
            </Link>

            {isAdmin && (
              <Link to="/admin" className="top-nav-link header-admin-btn" title="Админ-панель">
                <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
                Админ
              </Link>
            )}

            <HeaderFavoritesLink active={location.pathname === '/favorites'} onClick={closeMobileMenu} />
            <HeaderCartLink active={location.pathname === '/cart'} onClick={closeMobileMenu} />

            <button
              type="button"
              className={`top-nav-button auth-button ${currentUser ? 'profile-button' : ''}`}
              onClick={handleProfileAction}
            >
              {currentUser ? (
                <>
                  <span className="profile-button-avatar">
                    {(currentUser.name || currentUser.email || 'X').slice(0, 1).toUpperCase()}
                  </span>
                  <span>Профиль</span>
                </>
              ) : 'Войти'}
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        <FilterPanel
          filters={searchState.filterOptions}
          activeFilters={searchState.filters}
          onApply={handleGlobalApplyFilters}
          onClear={handleGlobalClearFilters}
          query={searchState.query}
          onQueryChange={handleGlobalQueryChange}
          sort={searchState.sort}
          sortFilter={sortFilter}
          total={searchState.total}
        />

        <Routes>
          <Route
            path="/"
            element={(
              <SearchPage
                searchState={searchState}
                dealsMode={isDealsActive}
                onClearDeals={handleClearDeals}
              />
            )}
          />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/cart" element={<CartPage currentUser={currentUser} onLoginClick={() => setAuthModalOpen(true)} />} />
          <Route path="/help" element={<HelpPage />} />
          <Route
            path="/profile"
            element={(
              <ProfilePage
                currentUser={currentUser}
                onLogout={handleLogout}
                onLoginClick={() => setAuthModalOpen(true)}
              />
            )}
          />
          <Route path="/game/:productId" element={<GameDetailPage />} />
          <Route
            path="/admin"
            element={(
              <AdminPage
                currentUser={currentUser}
                onLoginClick={() => setAuthModalOpen(true)}
              />
            )}
          />
        </Routes>
      </main>

      <footer className="app-footer">
        <p>
          Data sourced from the public Microsoft Store catalog.
          Not affiliated with Microsoft or Xbox.
        </p>
      </footer>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuth={handleAuth}
        externalError={authNotice}
      />
      <SupportWidget />
    </div>
  );
}

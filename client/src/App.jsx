import React, { useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import GameDetailPage from './pages/GameDetailPage';
import FavoritesPage from './pages/FavoritesPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import AuthModal from './components/AuthModal';
import FilterPanel from './components/FilterPanel';
import SupportWidget from './components/SupportWidget';
import { useFavorites } from './context/FavoritesContext';
import { useSearch } from './hooks/useSearch';
import { consumeOAuthSession, checkAdmin } from './services/api';

function isMobileNavigationViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= 900;
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
  const isDealsActive = location.pathname === '/' && new URLSearchParams(location.search).get('deals') === 'true';
  const isHomeActive = location.pathname === '/' && !isDealsActive;
  const searchState = useSearch({ dealsMode: isDealsActive });
  const sortFilter = searchState.filterOptions?.orderby || null;

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const goToCatalog = () => {
    if (location.pathname !== '/') {
      navigate('/');
    }
  };

  const handleGlobalQueryChange = (value) => {
    searchState.setQuery(value);
    goToCatalog();
  };

  const handleGlobalApplyFilters = (payload) => {
    searchState.applyFilters(payload);
    goToCatalog();
  };

  const handleGlobalClearFilters = () => {
    searchState.clearFilters();
    goToCatalog();
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
              to={isDealsActive ? '/' : '/?deals=true'}
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

            <a className="top-nav-link" href="https://xboxportal.ru/rules">
              Помощь
            </a>

            {isAdmin && (
              <Link to="/admin" className="top-nav-link header-admin-btn" title="Админ-панель">
                <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
                Админ
              </Link>
            )}

            <HeaderFavoritesLink active={location.pathname === '/favorites'} onClick={closeMobileMenu} />

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
          priceRange={searchState.priceRange}
        />

        <Routes>
          <Route path="/" element={<SearchPage searchState={searchState} dealsMode={isDealsActive} />} />
          <Route path="/favorites" element={<FavoritesPage />} />
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

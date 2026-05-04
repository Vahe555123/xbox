import React, { useEffect, useRef, useState } from 'react';
import {
  registerUser,
  verifyEmailCode,
  loginUser,
  fetchAuthProviders,
  loginWithTelegram,
} from '../services/api';

const DEFAULT_PROVIDERS = {
  google: { enabled: false },
  vk: { enabled: false },
  telegram: { enabled: false, ready: false, botUsername: '' },
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function VKIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#fff" d="M21.579 6.855c.14-.465 0-.806-.666-.806h-2.199c-.56 0-.816.295-.956.620 0 0-1.117 2.72-2.702 4.481-.512.513-.745.675-1.024.675-.14 0-.341-.162-.341-.627V6.855c0-.559-.163-.806-.629-.806H10.19c-.35 0-.559.26-.559.507 0 .532.793.655.875 2.153v3.253c0 .708-.128.838-.407.838-.745 0-2.557-2.731-3.633-5.858-.212-.609-.424-.855-.987-.855H3.28c-.628 0-.754.295-.754.620 0 .581.745 3.463 3.467 7.271 1.815 2.606 4.367 4.018 6.691 4.018 1.394 0 1.564-.313 1.564-.852v-1.967c0-.628.132-.754.576-.754.326 0 .884.163 2.188 1.418 1.490 1.490 1.736 2.155 2.574 2.155h2.199c.628 0 .942-.313.762-.932-.198-.616-.91-1.511-1.855-2.571-.512-.605-1.280-1.256-1.513-1.581-.326-.419-.233-.605 0-.978.001 0 2.672-3.763 2.950-5.041z" />
    </svg>
  );
}

/** Стилизованная «отправка» в бейдже — не официальный логотип Telegram. */
function TelegramPaperBadge() {
  return (
    <span className="auth-telegram-icon-badge" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2.01 21 23 12 2.01 3v7.09L18.99 12 2.01 14.91V21z"
        />
      </svg>
    </span>
  );
}

export default function AuthModal({ open, onClose, onAuth, externalError }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState(DEFAULT_PROVIDERS);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const telegramRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    fetchAuthProviders()
      .then((providerConfig) => setProviders({ ...DEFAULT_PROVIDERS, ...providerConfig }))
      .catch(() => {
        setProviders(DEFAULT_PROVIDERS);
        setError('Не удалось загрузить способы входа');
      });
  }, [open]);

  useEffect(() => {
    if (open && externalError) {
      setError(externalError);
    }
  }, [externalError, open]);

  useEffect(() => {
    if (!open || !providers.telegram?.ready || !providers.telegram.botUsername || !telegramRef.current) {
      return undefined;
    }

    const container = telegramRef.current;
    const previousHandler = window.onTelegramAuth;

    window.onTelegramAuth = async (telegramUser) => {
      setLoading(true);
      setError('');
      setNotice('');

      try {
        const res = await loginWithTelegram(telegramUser);
        onAuth?.({ ...(res.user || {}), token: res.token });
        onClose();
        resetForm();
      } catch (err) {
        setError(err.response?.data?.error?.message || err.message || 'Telegram login failed');
      } finally {
        setLoading(false);
      }
    };

    container.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', providers.telegram.botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'window.onTelegramAuth(user)');
    container.appendChild(script);

    return () => {
      window.onTelegramAuth = previousHandler;
      container.innerHTML = '';
    };
  }, [onAuth, onClose, open, providers.telegram?.botUsername, providers.telegram?.ready]);

  if (!open) return null;

  function resetForm() {
    setPassword('');
    setCode('');
    setError('');
    setNotice('');
  }

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await registerUser(email, password);
      setMode('verify');
      setCode('');
      setNotice('Код подтверждения отправлен на почту');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Не удалось создать аккаунт');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await verifyEmailCode(email, code);
      setMode('login');
      setPassword('');
      setCode('');
      setNotice('Почта подтверждена. Теперь можно войти');
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Не удалось подтвердить код');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const res = await loginUser(email, password);
      onAuth?.({ ...(res.user || { email: res.email }), token: res.token });
      onClose();
      resetForm();
    } catch (err) {
      setError(err.response?.data?.error?.message || err.message || 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setCode('');
  };

  const startOAuth = (provider) => {
    setError('');
    setNotice('');
    window.location.assign(`/api/auth/oauth/${provider}`);
  };

  const explainTelegramUnavailable = () => {
    if (providers.telegram?.enabled && !providers.telegram?.ready) {
      setError('Telegram вход не настроен: добавьте TELEGRAM_BOT_TOKEN и перезапустите сервер');
      return;
    }
    setError('Telegram вход сейчас недоступен');
  };

  const title = mode === 'register'
    ? 'Создать аккаунт'
    : mode === 'verify'
      ? 'Подтвердить почту'
      : 'Войти в магазин';

  const subtitle = mode === 'register'
    ? 'Сохраняйте избранное и возвращайтесь к покупкам с любого устройства.'
    : mode === 'verify'
      ? 'Введите код из письма, чтобы активировать аккаунт.'
      : 'Выберите способ входа ниже.';

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="auth-modal-close" onClick={onClose} aria-label="Закрыть">
          &times;
        </button>

        <div className="auth-shell">
          <aside className="auth-visual" aria-hidden="true">
            <div className="auth-visual-dots" />
            <div className="auth-visual-inner">
              <div className="auth-visual-mark">
                <svg viewBox="0 0 32 32" width="40" height="40" fill="currentColor">
                  <path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm0 4a9.97 9.97 0 0 1 7.07 2.93L7.93 23.07A9.97 9.97 0 0 1 6 16c0-5.514 4.486-10 10-10zm0 20c-2.647 0-5.063-1.032-6.84-2.71L23.29 9.16A9.953 9.953 0 0 1 26 16c0 5.514-4.486 10-10 10z" />
                </svg>
              </div>
              <p className="auth-visual-title">Xbox Store</p>
              <p className="auth-visual-desc">Игры, достижения и персональные рекомендации — всё в одном месте.</p>
              <ul className="auth-visual-perks">
                <li>
                  <span className="auth-perk-dot" />
                  Сохраняйте любимые игры
                </li>
                <li>
                  <span className="auth-perk-dot" />
                  Следите за ценами
                </li>
                <li>
                  <span className="auth-perk-dot" />
                  Быстрый вход через соцсети
                </li>
              </ul>
            </div>
          </aside>

          <section className="auth-panel">
            <div className="auth-heading">
              <p className="auth-kicker">Аккаунт Xbox Store</p>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                className={mode === 'login' ? 'active' : ''}
                onClick={() => switchMode('login')}
              >
                Вход
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'active' : ''}
                onClick={() => switchMode('register')}
              >
                Регистрация
              </button>
              <button
                type="button"
                className={mode === 'verify' ? 'active' : ''}
                onClick={() => switchMode('verify')}
              >
                Подтверждение
              </button>
            </div>

            {mode !== 'verify' && (
              <>
                <div className="auth-social">
                  <button
                    type="button"
                    className="auth-social-button auth-social-google"
                    onClick={() => startOAuth('google')}
                    disabled={!providers.google?.enabled || loading}
                    title={providers.google?.enabled ? 'Войти через Google' : 'Google (недоступно)'}
                  >
                    <GoogleIcon />
                    <span>Google</span>
                  </button>
                  <button
                    type="button"
                    className="auth-social-button auth-social-vk"
                    onClick={() => startOAuth('vk')}
                    disabled={!providers.vk?.enabled || loading}
                    title={providers.vk?.enabled ? 'Войти через VK' : 'VK (недоступно)'}
                  >
                    <VKIcon />
                    <span>VK</span>
                  </button>
                  {providers.telegram?.ready ? (
                    <div
                      className={`auth-social-button auth-telegram-widget-host${loading ? ' auth-telegram-widget-host--busy' : ''}`}
                      title="Войти через Telegram"
                      role="group"
                      aria-label="Войти через Telegram"
                    >
                      <div className="auth-telegram-faux" aria-hidden="true">
                        <TelegramPaperBadge />
                        <span>Telegram</span>
                      </div>
                      <div className="auth-telegram-widget auth-telegram-widget--overlay" ref={telegramRef} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="auth-social-button"
                      onClick={explainTelegramUnavailable}
                      title="Telegram (недоступно)"
                      aria-label="Войти через Telegram (недоступно)"
                    >
                      <TelegramPaperBadge />
                      <span>Telegram</span>
                    </button>
                  )}
                </div>
                <div className="auth-divider"><span>или через email</span></div>
              </>
            )}

            {notice && <p className="auth-notice">{notice}</p>}
            {error && <p className="auth-error">{error}</p>}

            {mode === 'register' && (
              <form className="auth-form" onSubmit={handleRegister}>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    placeholder="Минимум 6 символов"
                    required
                    autoComplete="new-password"
                  />
                </label>
                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <span className="auth-spinner" />
                  ) : 'Зарегистрироваться'}
                </button>
                <p className="auth-switch-hint">
                  Уже есть аккаунт?{' '}
                  <button type="button" className="auth-link-btn" onClick={() => switchMode('login')}>
                    Войти
                  </button>
                </p>
              </form>
            )}

            {mode === 'verify' && (
              <form className="auth-form" onSubmit={handleVerify}>
                <div className="auth-verify-info">
                  <div className="auth-verify-icon">✉</div>
                  <p>
                    Код отправлен на{' '}
                    <strong>{email || 'вашу почту'}</strong>
                  </p>
                </div>
                <label>
                  Код из письма
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    placeholder="123456"
                    required
                    autoComplete="one-time-code"
                  />
                </label>
                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? <span className="auth-spinner" /> : 'Подтвердить'}
                </button>
              </form>
            )}

            {mode === 'login' && (
              <form className="auth-form" onSubmit={handleLogin}>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ваш пароль"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <button className="auth-submit" type="submit" disabled={loading}>
                  {loading ? <span className="auth-spinner" /> : 'Войти'}
                </button>
                <p className="auth-switch-hint">
                  Нет аккаунта?{' '}
                  <button type="button" className="auth-link-btn" onClick={() => switchMode('register')}>
                    Зарегистрироваться
                  </button>
                </p>
              </form>
            )}

            {!providers.telegram?.ready && providers.telegram?.enabled && (
              <p className="auth-hint auth-hint--warn">
                Для Telegram входа добавьте <code>TELEGRAM_BOT_TOKEN</code> в серверный .env
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

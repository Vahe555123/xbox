import React, { useEffect, useRef, useState } from 'react';
import { changePassword, confirmEmailLink, fetchAuthProviders, fetchProfile, getOAuthLinkUrl, linkTelegramAccount, requestEmailLink, unlinkProvider, updatePurchaseSettings } from '../services/api';

const PROVIDER_LABELS = {
  email: 'Email / Пароль',
  google: 'Google',
  vk: 'ВКонтакте',
  telegram: 'Telegram',
};

const PROVIDER_ICONS = {
  email: '✉',
  google: 'G',
  vk: 'VK',
  telegram: 'TG',
};

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('auth:user') || 'null');
  } catch {
    return null;
  }
}

function initialsFromUser(user) {
  const source = user?.name || user?.email || 'Xbox';
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'XB';
}

export default function ProfilePage({ currentUser, onLogout, onLoginClick }) {
  const [storedUser] = useState(() => currentUser || readStoredUser());
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(Boolean(storedUser));
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({
    purchaseEmail: '',
    xboxAccountEmail: '',
    xboxAccountPassword: '',
    clearXboxAccountPassword: false,
    paymentMode: 'oplata',
  });
  const [purchaseSavedPassword, setPurchaseSavedPassword] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [purchaseFeedbackBlock, setPurchaseFeedbackBlock] = useState('');
  const [purchaseLoading, setPurchaseLoading] = useState(false);

  const [notifyDeals, setNotifyDeals] = useState(true);
  const [notifySpecialOffers, setNotifySpecialOffers] = useState(true);
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifyError, setNotifyError] = useState('');
  const [notifyLoading, setNotifyLoading] = useState(false);

  const [providerConfig, setProviderConfig] = useState(null);
  const [providerMsg, setProviderMsg] = useState('');
  const [providerErr, setProviderErr] = useState('');
  const [providerLoading, setProviderLoading] = useState('');
  const telegramLinkRef = useRef(null);

  const [emailLinkModal, setEmailLinkModal] = useState(false);
  const [emailLinkStep, setEmailLinkStep] = useState(1);
  const [emailLinkEmail, setEmailLinkEmail] = useState('');
  const [emailLinkCode, setEmailLinkCode] = useState('');
  const [emailLinkPassword, setEmailLinkPassword] = useState('');
  const [emailLinkLoading, setEmailLinkLoading] = useState(false);
  const [emailLinkMsg, setEmailLinkMsg] = useState('');
  const [emailLinkErr, setEmailLinkErr] = useState('');

  useEffect(() => {
    if (!storedUser) return;

    setLoading(true);
    setError('');

    Promise.all([fetchProfile(), fetchAuthProviders()])
      .then(([data, pConfig]) => {
        setProfile(data);
        setProviderConfig(pConfig);
        const settings = data.purchaseSettings || {};
        setPurchaseForm({
          purchaseEmail: settings.purchaseEmail || '',
          xboxAccountEmail: settings.xboxAccountEmail || '',
          xboxAccountPassword: '',
          clearXboxAccountPassword: false,
          paymentMode: settings.paymentMode || 'oplata',
        });
        setPurchaseSavedPassword(Boolean(settings.hasXboxAccountPassword));
        setNotifyDeals(settings.notifyDeals !== false);
        setNotifySpecialOffers(settings.notifySpecialOffers !== false);
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || err.message || 'Не удалось загрузить профиль');
      })
      .finally(() => setLoading(false));
  }, [storedUser]);

  // Reload profile after returning from OAuth link redirect
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('auth_link') === 'success') {
      fetchProfile()
        .then((data) => {
          setProfile(data);
          setProviderMsg('Аккаунт успешно привязан');
        })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Telegram link widget
  useEffect(() => {
    if (!telegramLinkRef.current || !providerConfig?.telegram?.botUsername) return;
    if (telegramLinkRef.current.querySelector('script')) return;

    window.onTelegramLinkAuth = (payload) => {
      setProviderLoading('telegram');
      setProviderMsg('');
      setProviderErr('');
      linkTelegramAccount(payload)
        .then(() => fetchProfile())
        .then((data) => {
          setProfile(data);
          setProviderMsg('Telegram привязан');
        })
        .catch((err) => {
          setProviderErr(err.response?.data?.error?.message || err.message || 'Не удалось привязать Telegram');
        })
        .finally(() => setProviderLoading(''));
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', providerConfig.telegram.botUsername);
    script.setAttribute('data-size', 'medium');
    script.setAttribute('data-onauth', 'onTelegramLinkAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;
    telegramLinkRef.current.appendChild(script);
  }, [providerConfig]);

  if (!storedUser) {
    return (
      <div className="profile-page profile-page-empty">
        <div className="profile-page-card">
          <p className="profile-kicker">Xbox профиль</p>
          <h1>Войдите в аккаунт</h1>
          <p>Профиль, избранное и смена пароля доступны после авторизации.</p>
          <button className="profile-page-primary" type="button" onClick={onLoginClick}>
            Войти
          </button>
        </div>
      </div>
    );
  }

  const user = profile?.user || storedUser || {};
  const providers = profile?.providers || [user.provider].filter(Boolean);
  const hasPassword = Boolean(profile?.hasPassword);

  const handleUnlink = async (provider) => {
    setProviderMsg('');
    setProviderErr('');
    setProviderLoading(provider);
    try {
      await unlinkProvider(provider);
      const data = await fetchProfile();
      setProfile(data);
      setProviderMsg(`${PROVIDER_LABELS[provider] || provider} отвязан`);
    } catch (err) {
      setProviderErr(err.response?.data?.error?.message || err.message || 'Не удалось отвязать аккаунт');
    } finally {
      setProviderLoading('');
    }
  };

  const ALL_LINK_PROVIDERS = ['google', 'vk', 'telegram'];
  const canUnlink = (providers.length + (hasPassword ? 0 : 0)) > 1;
  // actual count: linked oauth + email/password
  const loginMethodCount = providers.length;

  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordError('');
    setPasswordLoading(true);

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordMessage('Пароль обновлён');
    } catch (err) {
      setPasswordError(err.response?.data?.error?.message || err.message || 'Не удалось поменять пароль');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handlePurchaseField = (event) => {
    const { name, value, type, checked } = event.target;
    setPurchaseForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setPurchaseMessage('');
    setPurchaseError('');
    setPurchaseFeedbackBlock('');
  };

  const submitPurchaseSettings = async (event) => {
    event.preventDefault();
    const feedbackBlock = event.currentTarget.dataset.settingsBlock || 'purchase';
    setPurchaseMessage('');
    setPurchaseError('');
    setPurchaseFeedbackBlock(feedbackBlock);
    setPurchaseLoading(true);

    try {
      const settings = await updatePurchaseSettings({
        purchaseEmail: purchaseForm.purchaseEmail,
        xboxAccountEmail: purchaseForm.xboxAccountEmail,
        xboxAccountPassword: purchaseForm.xboxAccountPassword || undefined,
        clearXboxAccountPassword: purchaseForm.clearXboxAccountPassword,
        paymentMode: purchaseForm.paymentMode,
      });
      setPurchaseForm({
        purchaseEmail: settings.purchaseEmail || '',
        xboxAccountEmail: settings.xboxAccountEmail || '',
        xboxAccountPassword: '',
        clearXboxAccountPassword: false,
        paymentMode: settings.paymentMode || 'oplata',
      });
      setPurchaseSavedPassword(Boolean(settings.hasXboxAccountPassword));
      setProfile((current) => current ? { ...current, purchaseSettings: settings } : current);
      setPurchaseMessage('Настройки покупки сохранены');
    } catch (err) {
      setPurchaseError(err.response?.data?.error?.message || err.message || 'Не удалось сохранить настройки покупки');
    } finally {
      setPurchaseLoading(false);
    }
  };

  const submitNotifySettings = async (event) => {
    event.preventDefault();
    setNotifyMessage('');
    setNotifyError('');
    setNotifyLoading(true);
    try {
      await updatePurchaseSettings({ notifyDeals, notifySpecialOffers });
      setNotifyMessage('Настройки уведомлений сохранены');
    } catch (err) {
      setNotifyError(err.response?.data?.error?.message || err.message || 'Не удалось сохранить');
    } finally {
      setNotifyLoading(false);
    }
  };

  const openEmailLinkModal = () => {
    setEmailLinkStep(1);
    setEmailLinkEmail('');
    setEmailLinkCode('');
    setEmailLinkPassword('');
    setEmailLinkMsg('');
    setEmailLinkErr('');
    setEmailLinkModal(true);
  };

  const closeEmailLinkModal = () => setEmailLinkModal(false);

  const handleEmailLinkRequest = async (e) => {
    e.preventDefault();
    setEmailLinkLoading(true);
    setEmailLinkErr('');
    setEmailLinkMsg('');
    try {
      await requestEmailLink(emailLinkEmail.trim());
      setEmailLinkStep(2);
      setEmailLinkMsg('Код отправлен на почту');
    } catch (err) {
      setEmailLinkErr(err.response?.data?.error?.message || err.message || 'Не удалось отправить код');
    } finally {
      setEmailLinkLoading(false);
    }
  };

  const handleEmailLinkConfirm = async (e) => {
    e.preventDefault();
    setEmailLinkLoading(true);
    setEmailLinkErr('');
    setEmailLinkMsg('');
    try {
      await confirmEmailLink(emailLinkEmail.trim(), emailLinkCode.trim(), emailLinkPassword);
      setEmailLinkMsg('Email и пароль успешно привязаны');
      setEmailLinkLoading(false);
      setTimeout(() => {
        closeEmailLinkModal();
        fetchProfile().then((data) => setProfile(data)).catch(() => {});
      }, 1200);
      return;
    } catch (err) {
      setEmailLinkErr(err.response?.data?.error?.message || err.message || 'Не удалось привязать');
    } finally {
      setEmailLinkLoading(false);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-page-hero">
        {user.avatar ? (
          <img className="profile-page-avatar" src={user.avatar} alt={user.name || 'Профиль'} />
        ) : (
          <div className="profile-page-avatar profile-avatar-empty">{initialsFromUser(user)}</div>
        )}
        <div>
          <p className="profile-kicker">Xbox профиль</p>
          <h1>{user.name || user.email || 'Игрок'}</h1>
          <p>{user.email || 'Email не указан'}</p>
        </div>
        <button className="profile-logout-btn profile-hero-logout" type="button" onClick={onLogout}>
          Выйти из профиля
        </button>
      </div>

      {loading && <p className="profile-muted">Загружаем данные...</p>}
      {error && <p className="profile-error">{error}</p>}

      <div className="profile-page-grid">
        <section className="profile-page-card">
          <h2>Данные аккаунта</h2>
          <dl className="profile-details">
            <dt>ID</dt>
            <dd>{user.id || '—'}</dd>
            <dt>Email</dt>
            <dd>{user.email || '—'}</dd>
            <dt>Статус</dt>
            <dd>{profile?.verified ? 'Подтверждён' : 'Не подтверждён'}</dd>
          </dl>
        </section>

        <section className="profile-page-card profile-providers-card">
          <h2>Способы входа</h2>
          <p>Привяжите несколько аккаунтов — войти можно будет любым из них.</p>

          {providerMsg && <p className="profile-success">{providerMsg}</p>}
          {providerErr && <p className="profile-error">{providerErr}</p>}

          <div className="profile-provider-rows">
            {ALL_LINK_PROVIDERS.map((prov) => {
              const linked = providers.includes(prov);
              const cfg = providerConfig?.[prov];
              const enabled = prov === 'telegram' ? Boolean(cfg?.enabled) : Boolean(cfg?.enabled);
              const isBusy = providerLoading === prov;

              return (
                <div key={prov} className={`profile-provider-row ${linked ? 'linked' : ''}`}>
                  <span className="profile-provider-icon">{PROVIDER_ICONS[prov]}</span>
                  <span className="profile-provider-name">{PROVIDER_LABELS[prov]}</span>

                  {linked ? (
                    <button
                      className="profile-provider-unlink"
                      type="button"
                      disabled={isBusy || loginMethodCount <= 1}
                      title={loginMethodCount <= 1 ? 'Нельзя отвязать единственный способ входа' : undefined}
                      onClick={() => handleUnlink(prov)}
                    >
                      {isBusy ? '...' : 'Отвязать'}
                    </button>
                  ) : (
                    prov === 'telegram' ? (
                      enabled && (
                        <div ref={telegramLinkRef} className="profile-telegram-link-wrap" />
                      )
                    ) : (
                      enabled ? (
                        <a
                          className="profile-provider-link"
                          href={getOAuthLinkUrl(prov)}
                        >
                          Привязать
                        </a>
                      ) : (
                        <span className="profile-provider-disabled">Недоступно</span>
                      )
                    )
                  )}
                </div>
              );
            })}

            <div className={`profile-provider-row ${hasPassword ? 'linked' : ''}`}>
              <span className="profile-provider-icon">{PROVIDER_ICONS.email}</span>
              <span className="profile-provider-name">{PROVIDER_LABELS.email}</span>
              {hasPassword ? (
                <span className="profile-provider-status">Привязан</span>
              ) : (
                <button
                  className="profile-provider-link"
                  type="button"
                  onClick={openEmailLinkModal}
                >
                  Привязать
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="profile-page-card">
          <h2>Почта для покупки</h2>
          <p>На эту почту будет приходить информация по оплате.</p>
          <form className="profile-password-form" onSubmit={submitPurchaseSettings} data-settings-block="email">
            <label>
              Email для покупки
              <input
                type="email"
                name="purchaseEmail"
                value={purchaseForm.purchaseEmail}
                onChange={handlePurchaseField}
                placeholder="mail@example.com"
              />
            </label>
     
            <button type="submit" disabled={purchaseLoading}>
              {purchaseLoading ? 'Сохраняем...' : 'Сохранить почту'}
            </button>
            {purchaseFeedbackBlock === 'email' && purchaseMessage && <p className="profile-success">{purchaseMessage}</p>}
            {purchaseFeedbackBlock === 'email' && purchaseError && <p className="profile-error">{purchaseError}</p>}
          </form>
        </section>

        <section className="profile-page-card">
          <h2>Аккаунт Xbox для покупки</h2>
          <p>Email и пароль аккаунта хранятся отдельно от входа на сайт.</p>
          <form className="profile-password-form" onSubmit={submitPurchaseSettings} data-settings-block="account">
            <label>
              Email аккаунта Xbox
              <input
                type="email"
                name="xboxAccountEmail"
                value={purchaseForm.xboxAccountEmail}
                onChange={handlePurchaseField}
                placeholder="xbox@example.com"
              />
            </label>
            <label>
              Пароль аккаунта Xbox
              <input
                type="password"
                name="xboxAccountPassword"
                value={purchaseForm.xboxAccountPassword}
                onChange={handlePurchaseField}
                placeholder={purchaseSavedPassword ? 'Пароль сохранён. Оставьте пустым, чтобы не менять' : 'Пароль'}
              />
            </label>
            {purchaseSavedPassword && (
              <label className="profile-checkbox-row">
                <input
                  type="checkbox"
                  name="clearXboxAccountPassword"
                  checked={purchaseForm.clearXboxAccountPassword}
                  onChange={handlePurchaseField}
                />
                Удалить сохранённый пароль
              </label>
            )}
            {purchaseFeedbackBlock === 'account' && purchaseMessage && <p className="profile-success">{purchaseMessage}</p>}
            {purchaseFeedbackBlock === 'account' && purchaseError && <p className="profile-error">{purchaseError}</p>}
            <button type="submit" disabled={purchaseLoading}>
              {purchaseLoading ? 'Сохраняем...' : 'Сохранить аккаунт Xbox'}
            </button>
          </form>
        </section>

        <section className="profile-page-card">
          <h2>Уведомления</h2>
          <p>Мы уведомляем вас об изменениях цен и спецпредложениях на игры из вашего списка желаемого.</p>
          <form className="profile-password-form" onSubmit={submitNotifySettings}>
            <label className="profile-checkbox-row">
              <input
                type="checkbox"
                checked={notifyDeals}
                onChange={(e) => { setNotifyDeals(e.target.checked); setNotifyMessage(''); setNotifyError(''); }}
              />
              Уведомлять о скидках
            </label>
            <label className="profile-checkbox-row">
              <input
                type="checkbox"
                checked={notifySpecialOffers}
                onChange={(e) => { setNotifySpecialOffers(e.target.checked); setNotifyMessage(''); setNotifyError(''); }}
              />
              Уведомлять о спецпредложениях
            </label>
            {notifyMessage && <p className="profile-success">{notifyMessage}</p>}
            {notifyError && <p className="profile-error">{notifyError}</p>}
            <button type="submit" disabled={notifyLoading}>
              {notifyLoading ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </form>
        </section>

        <section className="profile-page-card">
          <h2>Безопасность</h2>
          {hasPassword ? (
            <form className="profile-password-form" onSubmit={submitPassword}>
              <label>
                Текущий пароль
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                Новый пароль
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={6}
                  required
                />
              </label>
              {passwordMessage && <p className="profile-success">{passwordMessage}</p>}
              {passwordError && <p className="profile-error">{passwordError}</p>}
              <button type="submit" disabled={passwordLoading}>
                {passwordLoading ? 'Сохраняем...' : 'Поменять пароль'}
              </button>
            </form>
          ) : (
            <p className="profile-muted">
              Смена пароля доступна только для аккаунтов, зарегистрированных через email и пароль.
            </p>
          )}
        </section>
      </div>

      {emailLinkModal && (
        <div className="profile-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeEmailLinkModal(); }}>
          <div className="profile-modal email-link-modal">
            <button className="profile-modal-close" type="button" onClick={closeEmailLinkModal}>×</button>
            <h2>Привязать Email и пароль</h2>
            <p className="profile-muted">
              {emailLinkStep === 1
                ? 'Введите email — отправим 6-значный код для подтверждения.'
                : 'Введите код из письма и придумайте пароль для входа.'}
            </p>

            {emailLinkStep === 1 ? (
              <form className="profile-password-form email-link-form" onSubmit={handleEmailLinkRequest}>
                <label>
                  Email
                  <input
                    type="email"
                    value={emailLinkEmail}
                    onChange={(e) => { setEmailLinkEmail(e.target.value); setEmailLinkErr(''); }}
                    placeholder="mail@example.com"
                    required
                    autoFocus
                  />
                </label>
                {emailLinkErr && <p className="profile-error">{emailLinkErr}</p>}
                <button type="submit" disabled={emailLinkLoading}>
                  {emailLinkLoading ? 'Отправляем...' : 'Отправить код'}
                </button>
              </form>
            ) : (
              <form className="profile-password-form email-link-form" onSubmit={handleEmailLinkConfirm}>
                <label>
                  Код из письма
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={emailLinkCode}
                    onChange={(e) => { setEmailLinkCode(e.target.value.replace(/\D/g, '')); setEmailLinkErr(''); }}
                    placeholder="123456"
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Новый пароль
                  <input
                    type="password"
                    value={emailLinkPassword}
                    onChange={(e) => { setEmailLinkPassword(e.target.value); setEmailLinkErr(''); }}
                    placeholder="Минимум 6 символов"
                    minLength={6}
                    required
                  />
                </label>
                {emailLinkMsg && <p className="profile-success">{emailLinkMsg}</p>}
                {emailLinkErr && <p className="profile-error">{emailLinkErr}</p>}
                <div className="email-link-form-actions">
                  <button type="button" className="email-link-back" onClick={() => { setEmailLinkStep(1); setEmailLinkErr(''); setEmailLinkMsg(''); }}>
                    ← Назад
                  </button>
                  <button type="submit" disabled={emailLinkLoading}>
                    {emailLinkLoading ? 'Сохраняем...' : 'Привязать'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

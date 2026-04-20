import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { changePassword, fetchProfile, updatePurchaseSettings } from '../services/api';

const PROVIDER_LABELS = {
  email: 'Email',
  google: 'Google',
  vk: 'VK',
  telegram: 'Telegram',
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

  useEffect(() => {
    if (!storedUser) return;

    setLoading(true);
    setError('');
    fetchProfile()
      .then((data) => {
        setProfile(data);
        const settings = data.purchaseSettings || {};
        setPurchaseForm({
          purchaseEmail: settings.purchaseEmail || '',
          xboxAccountEmail: settings.xboxAccountEmail || '',
          xboxAccountPassword: '',
          clearXboxAccountPassword: false,
          paymentMode: settings.paymentMode || 'oplata',
        });
        setPurchaseSavedPassword(Boolean(settings.hasXboxAccountPassword));
      })
      .catch((err) => {
        setError(err.response?.data?.error?.message || err.message || 'Не удалось загрузить профиль');
      })
      .finally(() => setLoading(false));
  }, [storedUser]);

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
            <dt>Провайдеры</dt>
            <dd>
              <div className="profile-provider-list">
                {providers.length > 0 ? providers.map((provider) => (
                  <span key={provider}>{PROVIDER_LABELS[provider] || provider}</span>
                )) : '—'}
              </div>
            </dd>
            <dt>Статус</dt>
            <dd>{profile?.verified ? 'Подтверждён' : 'Не подтверждён'}</dd>
          </dl>
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
            <div className="profile-payment-modes">
              <label className={`profile-payment-mode ${purchaseForm.paymentMode === 'oplata' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="paymentMode"
                  value="oplata"
                  checked={purchaseForm.paymentMode === 'oplata'}
                  onChange={handlePurchaseField}
                />
                <span>
                  <strong>Oplata.info</strong>
                  <small>Генерация ссылки на оплату</small>
                </span>
              </label>
              <label className={`profile-payment-mode ${purchaseForm.paymentMode === 'key_activation' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="paymentMode"
                  value="key_activation"
                  checked={purchaseForm.paymentMode === 'key_activation'}
                  onChange={handlePurchaseField}
                />
                <span>
                  <strong>Ключ активации</strong>
                  <small>Покупка через товар 5262264</small>
                </span>
              </label>
              <label className={`profile-payment-mode ${purchaseForm.paymentMode === 'topup_cards' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="paymentMode"
                  value="topup_cards"
                  checked={purchaseForm.paymentMode === 'topup_cards'}
                  onChange={handlePurchaseField}
                />
                <span>
                  <strong>Карты пополнения</strong>
                  <small>Комбинация карт под цену игры</small>
                </span>
              </label>
            </div>
            <button type="submit" disabled={purchaseLoading}>
              {purchaseLoading ? 'Сохраняем...' : 'Сохранить почту и способ'}
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

      <div className="profile-page-actions">
        <Link className="profile-page-secondary" to="/favorites">
          Перейти в избранное
        </Link>
        <button className="profile-logout-btn" type="button" onClick={onLogout}>
          Выйти из профиля
        </button>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { changePassword, fetchProfile } from '../services/api';

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

  useEffect(() => {
    if (!storedUser) return;

    setLoading(true);
    setError('');
    fetchProfile()
      .then(setProfile)
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

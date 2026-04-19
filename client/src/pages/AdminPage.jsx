import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  checkAdmin,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminNotifications,
  fetchSchedulerState,
  updateSchedulerInterval,
  triggerDealCheck,
} from '../services/api';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function providerLabel(p) {
  const map = { email: 'Email', google: 'Google', vk: 'VK', telegram: 'Telegram' };
  return map[p] || p;
}

export default function AdminPage({ currentUser, onLoginClick }) {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(null); // null=loading, true/false
  const [tab, setTab] = useState('dashboard');

  // Dashboard
  const [stats, setStats] = useState(null);

  // Users
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');

  // User detail modal
  const [selectedUser, setSelectedUser] = useState(null);

  // Notifications
  const [notifications, setNotifications] = useState([]);
  const [notifsTotal, setNotifsTotal] = useState(0);
  const [notifsPage, setNotifsPage] = useState(1);

  // Scheduler
  const [scheduler, setScheduler] = useState(null);
  const [intervalInput, setIntervalInput] = useState('');
  const [dealCheckLoading, setDealCheckLoading] = useState(false);
  const [dealCheckResult, setDealCheckResult] = useState('');

  // Auth check
  useEffect(() => {
    if (!currentUser) {
      setAuthorized(false);
      return;
    }
    checkAdmin()
      .then((isAdmin) => setAuthorized(isAdmin))
      .catch(() => setAuthorized(false));
  }, [currentUser]);

  // Load data when tab changes
  const loadDashboard = useCallback(async () => {
    try {
      const data = await fetchAdminStats();
      setStats(data);
      setScheduler(data.scheduler);
      setIntervalInput(String(data.scheduler?.intervalHours || 24));
    } catch { /* ignore */ }
  }, []);

  const loadUsers = useCallback(async (page = 1, search = '') => {
    try {
      const data = await fetchAdminUsers({ page, limit: 20, search });
      setUsers(data.users);
      setUsersTotal(data.total);
      setUsersPage(data.page);
    } catch { /* ignore */ }
  }, []);

  const loadNotifications = useCallback(async (page = 1) => {
    try {
      const data = await fetchAdminNotifications({ page, limit: 30 });
      setNotifications(data.notifications);
      setNotifsTotal(data.total);
      setNotifsPage(data.page);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    if (tab === 'dashboard') loadDashboard();
    else if (tab === 'users') loadUsers(1, usersSearch);
    else if (tab === 'notifications') loadNotifications(1);
  }, [tab, authorized, loadDashboard, loadUsers, loadNotifications]);

  const handleUserSearch = (e) => {
    e.preventDefault();
    loadUsers(1, usersSearch);
  };

  const openUserDetail = async (userId) => {
    try {
      const data = await fetchAdminUserDetail(userId);
      setSelectedUser(data);
    } catch { /* ignore */ }
  };

  const handleIntervalSave = async () => {
    const hours = parseFloat(intervalInput);
    if (!hours || hours <= 0) return;
    try {
      const state = await updateSchedulerInterval(hours);
      setScheduler(state);
      setDealCheckResult('Интервал обновлён');
      setTimeout(() => setDealCheckResult(''), 3000);
    } catch { /* ignore */ }
  };

  const handleDealCheck = async () => {
    setDealCheckLoading(true);
    setDealCheckResult('');
    try {
      const result = await triggerDealCheck();
      setDealCheckResult(result.message || 'Готово');
      // Refresh scheduler state
      const state = await fetchSchedulerState();
      setScheduler(state);
    } catch (err) {
      setDealCheckResult('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setDealCheckLoading(false);
    }
  };

  // Not logged in
  if (!currentUser) {
    return (
      <div className="admin-page">
        <div className="admin-denied">
          <h2>Админ-панель</h2>
          <p>Войдите в аккаунт, чтобы получить доступ.</p>
          <button className="admin-btn admin-btn-primary" onClick={onLoginClick}>Войти</button>
        </div>
      </div>
    );
  }

  // Loading auth check
  if (authorized === null) {
    return (
      <div className="admin-page">
        <div className="admin-loading">Проверка доступа...</div>
      </div>
    );
  }

  // Not admin
  if (!authorized) {
    return (
      <div className="admin-page">
        <div className="admin-denied">
          <h2>Доступ запрещён</h2>
          <p>У вас нет прав для доступа к админ-панели.</p>
          <button className="admin-btn admin-btn-secondary" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Админ-панель</h1>
        <p className="admin-subtitle">Управление Xbox Store</p>
      </div>

      <nav className="admin-tabs">
        {[
          ['dashboard', 'Обзор'],
          ['users', 'Пользователи'],
          ['notifications', 'Уведомления'],
          ['scheduler', 'Планировщик'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ==================== Dashboard ==================== */}
      {tab === 'dashboard' && stats && (
        <div className="admin-panel">
          <div className="admin-stats-grid">
            <div className="admin-stat-card">
              <div className="admin-stat-value">{stats.stats.totalUsers}</div>
              <div className="admin-stat-label">Пользователей</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-value">{stats.stats.totalFavorites}</div>
              <div className="admin-stat-label">Избранных</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-value">{stats.stats.totalNotifications}</div>
              <div className="admin-stat-label">Уведомлений</div>
            </div>
            <div className="admin-stat-card">
              <div className="admin-stat-value">{stats.stats.newUsersLast7Days}</div>
              <div className="admin-stat-label">Новых за 7 дней</div>
            </div>
          </div>

          <div className="admin-grid-2col">
            <div className="admin-card">
              <h3>Провайдеры авторизации</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Провайдер</th><th>Кол-во</th></tr></thead>
                  <tbody>
                    {stats.providerStats.map((p) => (
                      <tr key={p.last_provider}>
                        <td>{providerLabel(p.last_provider)}</td>
                        <td>{p.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-card">
              <h3>Топ избранных игр</h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead><tr><th>Игра</th><th>ID</th><th>Добавлений</th></tr></thead>
                  <tbody>
                    {stats.topFavorited.map((f) => (
                      <tr key={f.product_id}>
                        <td>{f.title || '—'}</td>
                        <td className="admin-mono">{f.product_id}</td>
                        <td>{f.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="admin-card">
            <h3>Статус планировщика скидок</h3>
            <dl className="admin-dl">
              <dt>Интервал</dt>
              <dd>{scheduler?.intervalHours}ч</dd>
              <dt>Последний запуск</dt>
              <dd>{formatDate(scheduler?.lastRunAt)}</dd>
              <dt>Статус</dt>
              <dd>
                <span className={`admin-status ${scheduler?.lastRunStatus === 'success' ? 'admin-status-ok' : scheduler?.lastRunStatus ? 'admin-status-err' : ''}`}>
                  {scheduler?.lastRunStatus || 'не запускался'}
                </span>
              </dd>
              <dt>Следующий запуск</dt>
              <dd>{formatDate(scheduler?.nextRunAt)}</dd>
              <dt>Сейчас работает</dt>
              <dd>{scheduler?.isRunning ? 'Да' : 'Нет'}</dd>
            </dl>
          </div>
        </div>
      )}

      {/* ==================== Users ==================== */}
      {tab === 'users' && (
        <div className="admin-panel">
          <form className="admin-search-bar" onSubmit={handleUserSearch}>
            <input
              type="text"
              placeholder="Поиск по email или имени..."
              value={usersSearch}
              onChange={(e) => setUsersSearch(e.target.value)}
            />
            <button type="submit" className="admin-btn admin-btn-primary">Найти</button>
          </form>

          <p className="admin-total">Всего: {usersTotal}</p>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Email</th>
                  <th>Провайдер</th>
                  <th>Избранных</th>
                  <th>Регистрация</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name || '—'}</td>
                    <td className="admin-mono">{u.email || '—'}</td>
                    <td>
                      <span className={`admin-provider-chip admin-provider-${u.last_provider}`}>
                        {providerLabel(u.last_provider)}
                      </span>
                    </td>
                    <td>{u.favorites_count}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>
                      <button className="admin-btn admin-btn-sm" onClick={() => openUserDetail(u.id)}>
                        Подробнее
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {usersTotal > 20 && (
            <div className="admin-pagination">
              <button
                className="admin-btn admin-btn-sm"
                disabled={usersPage <= 1}
                onClick={() => loadUsers(usersPage - 1, usersSearch)}
              >
                Назад
              </button>
              <span>Стр. {usersPage} / {Math.ceil(usersTotal / 20)}</span>
              <button
                className="admin-btn admin-btn-sm"
                disabled={usersPage >= Math.ceil(usersTotal / 20)}
                onClick={() => loadUsers(usersPage + 1, usersSearch)}
              >
                Вперёд
              </button>
            </div>
          )}
        </div>
      )}

      {/* ==================== User Detail Modal ==================== */}
      {selectedUser && (
        <div className="admin-modal-backdrop" onClick={() => setSelectedUser(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-close" onClick={() => setSelectedUser(null)}>&times;</button>
            <h2>{selectedUser.user.name || selectedUser.user.email || 'Пользователь'}</h2>

            <dl className="admin-dl">
              <dt>ID</dt><dd className="admin-mono">{selectedUser.user.id}</dd>
              <dt>Email</dt><dd>{selectedUser.user.email || '—'}</dd>
              <dt>Провайдер</dt><dd>{providerLabel(selectedUser.user.last_provider)}</dd>
              <dt>Верифицирован</dt><dd>{selectedUser.user.verified ? 'Да' : 'Нет'}</dd>
              <dt>Регистрация</dt><dd>{formatDate(selectedUser.user.created_at)}</dd>
            </dl>

            {selectedUser.oauthAccounts.length > 0 && (
              <>
                <h3>OAuth аккаунты</h3>
                <div className="admin-chips">
                  {selectedUser.oauthAccounts.map((oa) => (
                    <span key={`${oa.provider}-${oa.provider_user_id}`} className={`admin-provider-chip admin-provider-${oa.provider}`}>
                      {providerLabel(oa.provider)}: {oa.provider_user_id}
                    </span>
                  ))}
                </div>
              </>
            )}

            {selectedUser.favorites.length > 0 && (
              <>
                <h3>Избранное ({selectedUser.favorites.length})</h3>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead><tr><th>Игра</th><th>ID</th><th>Добавлено</th></tr></thead>
                    <tbody>
                      {selectedUser.favorites.map((f) => (
                        <tr key={f.product_id}>
                          <td>{f.snapshot?.title || '—'}</td>
                          <td className="admin-mono">{f.product_id}</td>
                          <td>{formatDate(f.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedUser.notifications.length > 0 && (
              <>
                <h3>Отправленные уведомления</h3>
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-compact">
                    <thead><tr><th>Product ID</th><th>Deal Key</th><th>Дата</th></tr></thead>
                    <tbody>
                      {selectedUser.notifications.map((n, i) => (
                        <tr key={i}>
                          <td className="admin-mono">{n.product_id}</td>
                          <td className="admin-mono">{n.deal_key}</td>
                          <td>{formatDate(n.notified_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ==================== Notifications ==================== */}
      {tab === 'notifications' && (
        <div className="admin-panel">
          <p className="admin-total">Всего уведомлений: {notifsTotal}</p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Провайдер</th>
                  <th>Product ID</th>
                  <th>Скидка</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {notifications.map((n, i) => (
                  <tr key={i}>
                    <td>{n.name || n.email || n.user_id.slice(0, 8)}</td>
                    <td>
                      <span className={`admin-provider-chip admin-provider-${n.last_provider}`}>
                        {providerLabel(n.last_provider)}
                      </span>
                    </td>
                    <td className="admin-mono">{n.product_id}</td>
                    <td className="admin-mono">{n.deal_key}</td>
                    <td>{formatDate(n.notified_at)}</td>
                  </tr>
                ))}
                {notifications.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Нет уведомлений</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {notifsTotal > 30 && (
            <div className="admin-pagination">
              <button className="admin-btn admin-btn-sm" disabled={notifsPage <= 1} onClick={() => loadNotifications(notifsPage - 1)}>Назад</button>
              <span>Стр. {notifsPage} / {Math.ceil(notifsTotal / 30)}</span>
              <button className="admin-btn admin-btn-sm" disabled={notifsPage >= Math.ceil(notifsTotal / 30)} onClick={() => loadNotifications(notifsPage + 1)}>Вперёд</button>
            </div>
          )}
        </div>
      )}

      {/* ==================== Scheduler ==================== */}
      {tab === 'scheduler' && (
        <div className="admin-panel">
          <div className="admin-grid-2col">
            <div className="admin-card">
              <h3>Автоматическая проверка скидок</h3>
              <p className="admin-card-desc">
                Система автоматически проверяет цены на избранные товары всех пользователей
                и отправляет уведомления при появлении скидок.
              </p>

              <div className="admin-scheduler-controls">
                <label className="admin-field">
                  <span>Интервал (часы)</span>
                  <div className="admin-input-group">
                    <input
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={intervalInput}
                      onChange={(e) => setIntervalInput(e.target.value)}
                    />
                    <button className="admin-btn admin-btn-primary" onClick={handleIntervalSave}>
                      Сохранить
                    </button>
                  </div>
                </label>
              </div>

              <div className="admin-scheduler-action">
                <button
                  className="admin-btn admin-btn-accent"
                  onClick={handleDealCheck}
                  disabled={dealCheckLoading}
                >
                  {dealCheckLoading ? 'Проверяем...' : 'Запустить проверку сейчас'}
                </button>
                {dealCheckResult && (
                  <span className="admin-scheduler-result">{dealCheckResult}</span>
                )}
              </div>
            </div>

            <div className="admin-card">
              <h3>Текущее состояние</h3>
              {scheduler ? (
                <dl className="admin-dl">
                  <dt>Интервал</dt>
                  <dd>{scheduler.intervalHours}ч ({Math.round(scheduler.intervalMs / 60000)} мин)</dd>
                  <dt>Последний запуск</dt>
                  <dd>{formatDate(scheduler.lastRunAt)}</dd>
                  <dt>Результат</dt>
                  <dd>
                    <span className={`admin-status ${scheduler.lastRunStatus === 'success' ? 'admin-status-ok' : scheduler.lastRunStatus ? 'admin-status-err' : ''}`}>
                      {scheduler.lastRunStatus || 'ожидание'}
                    </span>
                  </dd>
                  <dt>Следующий запуск</dt>
                  <dd>{formatDate(scheduler.nextRunAt)}</dd>
                  <dt>Работает</dt>
                  <dd>{scheduler.isRunning ? 'Да (в процессе)' : 'Нет'}</dd>
                </dl>
              ) : (
                <p>Загрузка...</p>
              )}

              <button className="admin-btn admin-btn-sm" onClick={async () => {
                const state = await fetchSchedulerState();
                setScheduler(state);
              }} style={{ marginTop: '1rem' }}>
                Обновить статус
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

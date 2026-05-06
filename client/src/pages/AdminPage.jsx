import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  checkAdmin,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminUserDetail,
  fetchAdminNotifications,
  fetchAdminSupportLinks,
  searchAdminProducts,
  fetchProductOverrides,
  updateProductOverride,
  updateAdminSupportLinks,
  deleteProductOverride,
  fetchSchedulerState,
  updateSchedulerInterval,
  triggerDealCheck,
  fetchDigisellerRates,
  refreshDigisellerRates,
  fetchTopupCards,
  refreshTopupCards,
  updateTopupCard,
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

function dealRunStatusLabel(status) {
  const map = {
    sent: 'Отправлено',
    skipped: 'Пропущено',
    failed: 'Ошибка',
  };
  return map[status] || status || '—';
}

function dealRunReasonLabel(reason) {
  const map = {
    already_notified: 'уже отправляли',
    no_email: 'нет email',
    no_telegram_chat_or_email: 'нет Telegram chat_id и email',
    telegram_failed_no_email: 'Telegram не отправился, email нет',
    telegram_and_email_failed: 'Telegram и email не отправились',
    email_failed: 'email не отправился',
    process_user_error: 'ошибка обработки клиента',
  };
  return map[reason] || reason || '—';
}

function dealRunChannelLabel(channel) {
  const map = { email: 'Email', telegram: 'Telegram' };
  return map[channel] || '—';
}

const EMPTY_DIG_RATE_STATE = { lastRun: null, samples: [] };

const PRODUCT_LANGUAGE_MODES = [
  { value: 'auto', label: 'Авто с Xbox' },
  { value: 'full_ru', label: 'Русский' },
  { value: 'ru_subtitles', label: 'Русские субтитры' },
  { value: 'no_ru', label: 'Оригинал' },
  { value: 'unknown', label: 'Язык не указан' },
];

const PRODUCT_LANGUAGE_FILTERS = [
  { value: 'all', label: 'Все языки' },
  { value: 'unknown', label: 'Язык не указан' },
  { value: 'no_ru', label: 'Оригинал' },
  { value: 'full_ru', label: 'Русский' },
  { value: 'ru_subtitles', label: 'Русские субтитры' },
];

function productLanguageLabel(mode) {
  return PRODUCT_LANGUAGE_MODES.find((item) => item.value === (mode || 'auto'))?.label || mode || 'Авто';
}

const DIG_RATE_MODES = [
  {
    id: 'oplata',
    title: 'Курсы Digiseller для Xbox USD',
    description: 'Сэмплы считаются через price_options: система подбирает количество USD под рублевые интервалы, сохраняет effective rate и использует его для цен в каталоге.',
    fallbackProductId: '5837241',
  },
  {
    id: 'key_activation',
    title: 'Курсы Digiseller для ключей активации',
    description: 'Второй режим использует товар 5262264 и option 3529971=13870055, а при покупке генерирует финальную ссылку pay_api.',
    fallbackProductId: '5262264',
  },
];

export default function AdminPage({ currentUser, onLoginClick }) {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(null); // null=loading, true/false
  const [tab, setTab] = useState('dashboard');

  // Dashboard
  const [stats, setStats] = useState(null);
  const [supportLinksForm, setSupportLinksForm] = useState({
    vkUrl: '',
    telegramUrl: '',
    maxUrl: '',
  });
  const [supportLinksMessage, setSupportLinksMessage] = useState('');
  const [supportLinksSaving, setSupportLinksSaving] = useState(false);

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

  // Product overrides
  const [productSearch, setProductSearch] = useState('');
  const [productLanguageFilter, setProductLanguageFilter] = useState('all');
  const [productSearchLoading, setProductSearchLoading] = useState(false);
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productOverrides, setProductOverrides] = useState([]);
  const [productOverridesTotal, setProductOverridesTotal] = useState(0);
  const [selectedProductOverride, setSelectedProductOverride] = useState(null);
  const [overrideForm, setOverrideForm] = useState({
    productId: '',
    title: '',
    russianLanguageMode: 'auto',
    languageNote: '',
    specialOfferUrl: '',
    customDescription: '',
  });
  const [overrideMessage, setOverrideMessage] = useState('');

  // Scheduler
  const [scheduler, setScheduler] = useState(null);
  const [intervalInput, setIntervalInput] = useState('');
  const [dealCheckLoading, setDealCheckLoading] = useState(false);
  const [dealCheckResult, setDealCheckResult] = useState('');
  const [dealCheckReport, setDealCheckReport] = useState(null);

  // Digiseller
  const [digRateStates, setDigRateStates] = useState({
    oplata: EMPTY_DIG_RATE_STATE,
    key_activation: EMPTY_DIG_RATE_STATE,
  });
  const [digRateLoading, setDigRateLoading] = useState({});
  const [digRateMessage, setDigRateMessage] = useState({});

  // Topup cards
  const [topupState, setTopupState] = useState({ cards: [], lastRun: null, productId: null, optionCategoryId: null });
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupMessage, setTopupMessage] = useState('');

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

  const loadSupportLinks = useCallback(async () => {
    try {
      const links = await fetchAdminSupportLinks();
      setSupportLinksForm({
        vkUrl: links.vkUrl || '',
        telegramUrl: links.telegramUrl || '',
        maxUrl: links.maxUrl || '',
      });
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

  const loadProductOverrides = useCallback(async () => {
    try {
      const data = await fetchProductOverrides({ page: 1, limit: 50 });
      setProductOverrides(data.overrides || []);
      setProductOverridesTotal(data.total || 0);
    } catch { /* ignore */ }
  }, []);

  const loadAdminProducts = useCallback(async ({ q = '', languageMode = 'all' } = {}) => {
    setProductSearchLoading(true);
    setOverrideMessage('');
    try {
      const products = await searchAdminProducts({ q: q.trim(), languageMode });
      setProductSearchResults(products);
    } catch (err) {
      setOverrideMessage('Ошибка поиска: ' + (err.response?.data?.error || err.message));
    } finally {
      setProductSearchLoading(false);
    }
  }, []);

  const loadDigiseller = useCallback(async () => {
    try {
      const entries = await Promise.all(
        DIG_RATE_MODES.map(async (mode) => [mode.id, await fetchDigisellerRates(mode.id)]),
      );
      setDigRateStates(Object.fromEntries(entries));
    } catch { /* ignore */ }
  }, []);

  const loadTopupCards = useCallback(async () => {
    try {
      const state = await fetchTopupCards();
      setTopupState(state || { cards: [], lastRun: null, productId: null, optionCategoryId: null });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    if (tab === 'dashboard') {
      loadDashboard();
      loadSupportLinks();
    }
    else if (tab === 'users') loadUsers(1, usersSearch);
    else if (tab === 'notifications') loadNotifications(1);
    else if (tab === 'products') {
      loadProductOverrides();
      loadAdminProducts({ q: productSearch, languageMode: productLanguageFilter });
    }
    else if (tab === 'digiseller') loadDigiseller();
    else if (tab === 'topup') loadTopupCards();
  }, [tab, authorized, loadDashboard, loadSupportLinks, loadUsers, loadNotifications, loadProductOverrides, loadAdminProducts, loadDigiseller, loadTopupCards]);

  const handleUserSearch = (e) => {
    e.preventDefault();
    loadUsers(1, usersSearch);
  };

  const handleProductSearch = async (e) => {
    e.preventDefault();
    const query = productSearch.trim();
    await loadAdminProducts({ q: query, languageMode: productLanguageFilter });
  };

  const handleProductLanguageFilterChange = async (event) => {
    const languageMode = event.target.value;
    setProductLanguageFilter(languageMode);
    await loadAdminProducts({ q: productSearch, languageMode });
  };

  const handleSupportLinksSave = async (event) => {
    event.preventDefault();
    setSupportLinksSaving(true);
    setSupportLinksMessage('');
    try {
      const links = await updateAdminSupportLinks(supportLinksForm);
      setSupportLinksForm({
        vkUrl: links.vkUrl || '',
        telegramUrl: links.telegramUrl || '',
        maxUrl: links.maxUrl || '',
      });
      setSupportLinksMessage('Контакты поддержки сохранены');
      window.dispatchEvent(new Event('support-links-changed'));
    } catch (err) {
      setSupportLinksMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setSupportLinksSaving(false);
    }
  };

  const selectProductForOverride = (product, override = null) => {
    const currentOverride = override || product.adminOverride || {};
    setSelectedProductOverride(product || null);
    setOverrideForm({
      productId: product?.id || currentOverride.productId || '',
      title: product?.title || currentOverride.title || '',
      russianLanguageMode: currentOverride.russianLanguageMode || product?.russianLanguageMode || 'auto',
      languageNote: currentOverride.languageNote || product?.languageNote || '',
      specialOfferUrl: currentOverride.specialOfferUrl || '',
      customDescription: currentOverride.customDescription || '',
    });
    setOverrideMessage('');
  };

  const selectSavedOverride = (override) => {
    setSelectedProductOverride(null);
    setOverrideForm({
      productId: override.productId,
      title: override.title || '',
      russianLanguageMode: override.russianLanguageMode || 'auto',
      languageNote: override.languageNote || '',
      specialOfferUrl: override.specialOfferUrl || '',
      customDescription: override.customDescription || '',
    });
    setOverrideMessage('');
  };

  const saveProductOverride = async (e) => {
    e.preventDefault();
    if (!overrideForm.productId) return;
    setOverrideMessage('');
    try {
      const override = await updateProductOverride(overrideForm.productId, overrideForm);
      setOverrideMessage('Сохранено');
      setOverrideForm((current) => ({
        ...current,
        productId: override.productId,
        russianLanguageMode: override.russianLanguageMode || 'auto',
        languageNote: override.languageNote || '',
        specialOfferUrl: override.specialOfferUrl || '',
        customDescription: override.customDescription || '',
      }));
      await loadProductOverrides();
      await loadAdminProducts({ q: productSearch, languageMode: productLanguageFilter });
    } catch (err) {
      setOverrideMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const removeProductOverride = async () => {
    if (!overrideForm.productId) return;
    setOverrideMessage('');
    try {
      await deleteProductOverride(overrideForm.productId);
      setOverrideMessage('Ручная правка удалена');
      setOverrideForm((current) => ({
        ...current,
        russianLanguageMode: 'auto',
        languageNote: '',
        specialOfferUrl: '',
        customDescription: '',
      }));
      await loadProductOverrides();
      await loadAdminProducts({ q: productSearch, languageMode: productLanguageFilter });
    } catch (err) {
      setOverrideMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
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

  const handleRefreshTopup = async () => {
    setTopupLoading(true);
    setTopupMessage('');
    try {
      const result = await refreshTopupCards();
      setTopupMessage(`Обновлено: ${result.updatedCount}/${result.parsedCount}`);
      await loadTopupCards();
    } catch (err) {
      setTopupMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setTopupLoading(false);
    }
  };

  const handleTopupFieldChange = async (usdValue, field, value) => {
    try {
      const updated = await updateTopupCard(usdValue, { [field]: value });
      setTopupState((prev) => ({
        ...prev,
        cards: (prev.cards || []).map((c) => (c.usdValue === usdValue ? updated : c)),
      }));
    } catch (err) {
      setTopupMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRefreshDigRates = async (mode = 'oplata') => {
    setDigRateLoading((current) => ({ ...current, [mode]: true }));
    setDigRateMessage((current) => ({ ...current, [mode]: '' }));
    try {
      const result = await refreshDigisellerRates(mode);
      setDigRateStates((current) => ({
        ...current,
        [mode]: {
          ...(current[mode] || EMPTY_DIG_RATE_STATE),
          mode: result.mode || mode,
          digisellerId: result.run?.digiseller_id || current[mode]?.digisellerId,
          lastRun: result.run || null,
          samples: result.samples || [],
        },
      }));
      setDigRateMessage((current) => ({
        ...current,
        [mode]: `Курсы обновлены: ${result.samples?.length || 0} точек`,
      }));
    } catch (err) {
      setDigRateMessage((current) => ({
        ...current,
        [mode]: 'Ошибка: ' + (err.response?.data?.error || err.message),
      }));
    } finally {
      setDigRateLoading((current) => ({ ...current, [mode]: false }));
    }
  };

  const handleDealCheck = async () => {
    setDealCheckLoading(true);
    setDealCheckResult('');
    setDealCheckReport(null);
    try {
      const result = await triggerDealCheck();
      setDealCheckReport(result.report || null);
      if (result.report) {
        setDealCheckResult(`Готово: отправлено ${result.report.totals?.sent || 0}`);
      } else if (result.message === 'Deal check is already running') {
        setDealCheckResult('Проверка уже запущена');
      } else {
        setDealCheckResult(result.message || 'Готово');
      }
      // Refresh scheduler state
      const state = await fetchSchedulerState();
      setScheduler(state);
    } catch (err) {
      setDealCheckReport(err.response?.data?.report || null);
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
          ['products', 'Игры'],
          ['scheduler', 'Планировщик'],
          ['digiseller', 'Digiseller'],
          ['topup', 'Карты пополнения'],
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

          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h3>Контакты поддержки</h3>
                <p className="admin-card-desc">
                  Эти ссылки используются в кнопке помощи в правом нижнем углу сайта.
                </p>
              </div>
            </div>
            <form className="admin-override-form" onSubmit={handleSupportLinksSave}>
              <label className="admin-field">
                <span>ВКонтакте</span>
                <input
                  type="text"
                  value={supportLinksForm.vkUrl}
                  onChange={(e) => setSupportLinksForm((current) => ({ ...current, vkUrl: e.target.value }))}
                  placeholder="https://vk.com/im?sel=..."
                />
              </label>

              <label className="admin-field">
                <span>Telegram</span>
                <input
                  type="text"
                  value={supportLinksForm.telegramUrl}
                  onChange={(e) => setSupportLinksForm((current) => ({ ...current, telegramUrl: e.target.value }))}
                  placeholder="https://t.me/..."
                />
              </label>

              <label className="admin-field">
                <span>MAX</span>
                <input
                  type="text"
                  value={supportLinksForm.maxUrl}
                  onChange={(e) => setSupportLinksForm((current) => ({ ...current, maxUrl: e.target.value }))}
                  placeholder="https://max.ru/... или max://..."
                />
              </label>

              <div className="admin-override-actions">
                <button className="admin-btn admin-btn-primary" type="submit" disabled={supportLinksSaving}>
                  {supportLinksSaving ? 'Сохраняем...' : 'Сохранить контакты'}
                </button>
              </div>
              {supportLinksMessage && <p className="admin-scheduler-result">{supportLinksMessage}</p>}
            </form>
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

      {/* ==================== Products ==================== */}
      {tab === 'products' && (
        <div className="admin-panel">
          <div className="admin-grid-2col admin-products-grid">
            <div className="admin-card">
              <h3>Поиск игры</h3>
              <p className="admin-card-desc">
                Найдите товар по названию или Product ID, выберите его и задайте ручной язык. Эта правка будет применяться в каталоге и карточке товара.
              </p>
              <form className="admin-search-bar" onSubmit={handleProductSearch}>
                <input
                  type="text"
                  placeholder="Название или Product ID..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
                <select
                  className="admin-search-select"
                  value={productLanguageFilter}
                  onChange={handleProductLanguageFilterChange}
                  aria-label="Фильтр языка"
                >
                  {PRODUCT_LANGUAGE_FILTERS.map((filter) => (
                    <option key={filter.value} value={filter.value}>{filter.label}</option>
                  ))}
                </select>
                <button type="submit" className="admin-btn admin-btn-primary" disabled={productSearchLoading}>
                  {productSearchLoading ? 'Загрузка...' : 'Показать'}
                </button>
              </form>

              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr><th>Игра</th><th>ID</th><th>Язык сейчас</th><th></th></tr>
                  </thead>
                  <tbody>
                    {productSearchResults.map((product) => (
                      <tr key={product.id}>
                        <td>{product.title}</td>
                        <td className="admin-mono">{product.id}</td>
                        <td>{productLanguageLabel(product.russianLanguageMode)}</td>
                        <td>
                          <button className="admin-btn admin-btn-sm" type="button" onClick={() => selectProductForOverride(product)}>
                            Редактировать
                          </button>
                        </td>
                      </tr>
                    ))}
                    {productSearchResults.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Игры не найдены</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-card">
              <h3>Ручная правка товара</h3>
              <form className="admin-override-form" onSubmit={saveProductOverride}>
                <label className="admin-field">
                  <span>Product ID</span>
                  <input
                    type="text"
                    value={overrideForm.productId}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, productId: e.target.value.toUpperCase() }))}
                    placeholder="9MX6D30J0ZS6"
                    required
                  />
                </label>

                <label className="admin-field">
                  <span>Название</span>
                  <input
                    type="text"
                    value={overrideForm.title}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, title: e.target.value }))}
                    placeholder={selectedProductOverride?.title || 'Можно оставить пустым'}
                  />
                </label>

                <label className="admin-field">
                  <span>Русский язык</span>
                  <select
                    value={overrideForm.russianLanguageMode}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, russianLanguageMode: e.target.value }))}
                  >
                    {PRODUCT_LANGUAGE_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>{mode.label}</option>
                    ))}
                  </select>
                </label>

                <label className="admin-field">
                  <span>Заметка</span>
                  <textarea
                    value={overrideForm.languageNote}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, languageNote: e.target.value }))}
                    placeholder="Например: проверено вручную, есть русские субтитры"
                    rows={3}
                  />
                </label>

                <label className="admin-field">
                  <span style={{ color: '#ac84f1' }}>Спецпредложение (ссылка oplata.info)</span>
                  <input
                    type="url"
                    value={overrideForm.specialOfferUrl}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, specialOfferUrl: e.target.value }))}
                    placeholder="https://www.oplata.info/asp2/pay_wm.asp?id_d=..."
                  />
                </label>

                <label className="admin-field">
                  <span>Описание игры (ручная замена)</span>
                  <textarea
                    value={overrideForm.customDescription}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, customDescription: e.target.value }))}
                    placeholder="Если оставить пустым — используется описание из Xbox Store (ru-UA, затем en-US)"
                    rows={6}
                  />
                </label>

                <div className="admin-override-actions">
                  <button className="admin-btn admin-btn-primary" type="submit">Сохранить</button>
                  <button className="admin-btn admin-btn-secondary" type="button" onClick={removeProductOverride} disabled={!overrideForm.productId}>
                    Удалить правку
                  </button>
                </div>
                {overrideMessage && <p className="admin-scheduler-result">{overrideMessage}</p>}
              </form>
            </div>
          </div>

          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h3>Сохраненные правки</h3>
                <p className="admin-card-desc">Всего: {productOverridesTotal}</p>
              </div>
              <button className="admin-btn admin-btn-sm" type="button" onClick={loadProductOverrides}>Обновить</button>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr><th>Игра</th><th>ID</th><th>Язык</th><th>Заметка</th><th>Дата</th><th></th></tr>
                </thead>
                <tbody>
                  {productOverrides.map((override) => (
                    <tr key={override.productId}>
                      <td>{override.title || '—'}</td>
                      <td className="admin-mono">{override.productId}</td>
                      <td>{productLanguageLabel(override.russianLanguageMode)}</td>
                      <td>{override.languageNote || '—'}</td>
                      <td>{formatDate(override.updatedAt)}</td>
                      <td>
                        <button className="admin-btn admin-btn-sm" type="button" onClick={() => selectSavedOverride(override)}>
                          Изменить
                        </button>
                      </td>
                    </tr>
                  ))}
                  {productOverrides.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Ручных правок пока нет</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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

      {tab === 'scheduler' && dealCheckReport && (
        <div className="admin-panel admin-deal-run-panel">
          <div className="admin-card admin-deal-run-report">
            <div className="admin-card-head">
              <div>
                <h3>Лог ручного запуска</h3>
                <p className="admin-card-desc">
                  {formatDate(dealCheckReport.startedAt)} - {formatDate(dealCheckReport.finishedAt)}
                </p>
              </div>
              <span className={`admin-status ${dealCheckReport.status === 'success' ? 'admin-status-ok' : dealCheckReport.status === 'failed' ? 'admin-status-err' : ''}`}>
                {dealCheckReport.status}
              </span>
            </div>

            <div className="admin-report-stats">
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.clients || 0}</strong><span>клиентов</span></div>
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.favorites || 0}</strong><span>избранных игр</span></div>
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.productsOnSale || 0}</strong><span>игр со скидкой</span></div>
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.sent || 0}</strong><span>отправлено</span></div>
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.email || 0}</strong><span>Email</span></div>
              <div className="admin-report-stat"><strong>{dealCheckReport.totals?.telegram || 0}</strong><span>Telegram</span></div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>Статус</th>
                    <th>Куда</th>
                    <th>Игры</th>
                  </tr>
                </thead>
                <tbody>
                  {(dealCheckReport.entries || []).map((entry, index) => (
                    <tr key={`${entry.userId || 'user'}-${entry.status}-${index}`}>
                      <td>
                        <div>{entry.name || entry.email || entry.userId || '—'}</div>
                        {entry.email && entry.name && <div className="admin-muted">{entry.email}</div>}
                      </td>
                      <td>
                        <span className={`admin-report-status admin-report-status-${entry.status}`}>
                          {dealRunStatusLabel(entry.status)}
                        </span>
                        {entry.reason && <div className="admin-muted">{dealRunReasonLabel(entry.reason)}</div>}
                        {entry.error && <div className="admin-muted">{entry.error}</div>}
                      </td>
                      <td>
                        <div>{dealRunChannelLabel(entry.channel)}</div>
                        <div className="admin-muted">{entry.recipient || '—'}</div>
                      </td>
                      <td>
                        <div className="admin-report-games">
                          {(entry.deals || []).map((deal) => (
                            <a
                              key={deal.productId}
                              href={deal.siteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="admin-report-game"
                            >
                              {deal.title}
                              <span>-{deal.discountPercent}%</span>
                            </a>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(dealCheckReport.entries || []).length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        Новых отправок нет. Клиентов проверили, но подходящих новых скидок не нашли.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {Boolean(dealCheckReport.errors?.length) && (
              <div className="admin-report-errors">
                {dealCheckReport.errors.map((error, index) => (
                  <div key={`${error.stage}-${index}`}>
                    {error.stage}: {error.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== Digiseller ==================== */}
      {tab === 'digiseller' && (
        <div className="admin-panel">
          {DIG_RATE_MODES.map((rateMode) => {
            const rateState = digRateStates[rateMode.id] || EMPTY_DIG_RATE_STATE;
            const loading = Boolean(digRateLoading[rateMode.id]);
            const message = digRateMessage[rateMode.id];
            return (
              <div className="admin-card" key={rateMode.id}>
                <div className="admin-card-head">
                  <div>
                    <h3>{rateMode.title}</h3>
                    <p className="admin-card-desc">{rateMode.description}</p>
                  </div>
                  <button
                    className="admin-btn admin-btn-accent"
                    type="button"
                    onClick={() => handleRefreshDigRates(rateMode.id)}
                    disabled={loading}
                  >
                    {loading ? 'Обновляем...' : 'Обновить курсы'}
                  </button>
                </div>

                <dl className="admin-dl">
                  <dt>Digiseller товар</dt>
                  <dd className="admin-mono">{rateState.digisellerId || rateMode.fallbackProductId}</dd>
                  {rateState.optionCategoryId && (
                    <>
                      <dt>Option</dt>
                      <dd className="admin-mono">{rateState.optionCategoryId}={rateState.optionValueId}</dd>
                    </>
                  )}
                  <dt>Последний запуск</dt>
                  <dd>{formatDate(rateState.lastRun?.finished_at || rateState.lastRun?.started_at)}</dd>
                  <dt>Статус</dt>
                  <dd>
                    <span className={`admin-status ${rateState.lastRun?.status === 'success' ? 'admin-status-ok' : rateState.lastRun?.status === 'failed' ? 'admin-status-err' : ''}`}>
                      {rateState.lastRun?.status || 'нет данных'}
                    </span>
                  </dd>
                  <dt>Курс</dt>
                  <dd>
                    {rateState.lastRun?.min_rate
                      ? `${Number(rateState.lastRun.min_rate).toFixed(2)}-${Number(rateState.lastRun.max_rate).toFixed(2)} ₽ за $`
                      : 'нет данных'}
                  </dd>
                </dl>

                {message && <p className="admin-scheduler-result">{message}</p>}

                <div className="admin-table-wrap dig-rate-table">
                  <table className="admin-table admin-table-compact">
                    <thead>
                      <tr>
                        <th>Интервал RUB</th>
                        <th>USD</th>
                        <th>Итог RUB</th>
                        <th>Курс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rateState.samples || []).slice(0, 40).map((sample) => (
                        <tr key={sample.id || `${sample.targetRub}-${sample.requestedUsd}`}>
                          <td>{sample.label || Number(sample.target_rub || sample.targetRub).toLocaleString('ru-RU')}</td>
                          <td>{Number(sample.requested_usd || sample.requestedUsd).toFixed(2)} $</td>
                          <td>{Number(sample.amount_rub || sample.amountRub).toLocaleString('ru-RU')} ₽</td>
                          <td>{Number(sample.effective_rate || sample.effectiveRate).toFixed(2)} ₽/$</td>
                        </tr>
                      ))}
                      {(!rateState.samples || rateState.samples.length === 0) && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                            Курсы еще не рассчитаны. Нажмите «Обновить курсы».
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== Xbox topup cards ==================== */}
      {tab === 'topup' && (
        <div className="admin-panel">
          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h3>Карты пополнения Xbox (USA)</h3>
                <p className="admin-card-desc">
                  Парсер достаёт номиналы $5/$10/$25/$50, их option_id и цену в рублях
                  со страницы покупки Digiseller. Комбинация карт подбирается так, чтобы
                  покрыть цену игры минимальным количеством карт (правила заданы вручную).
                </p>
              </div>
              <button
                className="admin-btn admin-btn-accent"
                type="button"
                onClick={handleRefreshTopup}
                disabled={topupLoading}
              >
                {topupLoading ? 'Обновляем...' : 'Обновить цены'}
              </button>
            </div>

            <dl className="admin-dl">
              <dt>Digiseller товар</dt>
              <dd className="admin-mono">{topupState.productId || '—'}</dd>
              <dt>Option category</dt>
              <dd className="admin-mono">{topupState.optionCategoryId || '—'}</dd>
              <dt>Последний запуск</dt>
              <dd>{formatDate(topupState.lastRun?.finished_at || topupState.lastRun?.started_at)}</dd>
              <dt>Статус</dt>
              <dd>
                <span className={`admin-status ${topupState.lastRun?.status === 'success' ? 'admin-status-ok' : topupState.lastRun?.status === 'failed' ? 'admin-status-err' : ''}`}>
                  {topupState.lastRun?.status || 'нет данных'}
                </span>
              </dd>
              {topupState.lastRun?.error && (
                <>
                  <dt>Ошибка</dt>
                  <dd style={{ color: 'var(--color-danger, #b33)' }}>{topupState.lastRun.error}</dd>
                </>
              )}
            </dl>

            {topupMessage && <p className="admin-scheduler-result">{topupMessage}</p>}

            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr>
                    <th>Номинал</th>
                    <th>Option ID</th>
                    <th>Цена RUB</th>
                    <th>В наличии</th>
                    <th>Включена</th>
                    <th>Обновлена</th>
                  </tr>
                </thead>
                <tbody>
                  {(topupState.cards || []).map((card) => (
                    <tr key={card.usdValue}>
                      <td><b>${card.usdValue}</b></td>
                      <td>
                        <input
                          type="text"
                          className="admin-input-inline"
                          defaultValue={card.optionId || ''}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (card.optionId || '')) handleTopupFieldChange(card.usdValue, 'optionId', v || null);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="admin-input-inline"
                          defaultValue={card.priceRub ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            if (v !== card.priceRub) handleTopupFieldChange(card.usdValue, 'priceRub', v);
                          }}
                        />
                        <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                          {card.priceRubFormatted || ''}
                        </span>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={card.inStock}
                          onChange={(e) => handleTopupFieldChange(card.usdValue, 'inStock', e.target.checked)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={card.enabled}
                          onChange={(e) => handleTopupFieldChange(card.usdValue, 'enabled', e.target.checked)}
                        />
                      </td>
                      <td>{formatDate(card.lastRefreshedAt)}</td>
                    </tr>
                  ))}
                  {(!topupState.cards || topupState.cards.length === 0) && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        Нажмите «Обновить цены», чтобы спарсить номиналы со страницы Digiseller.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

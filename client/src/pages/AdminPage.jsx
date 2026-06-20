import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  checkAdmin,
  fetchAdminStats,
  fetchAdminUsers,
  fetchAdminUserDetail,
  updateAdminUserAccess,
  fetchAdminNotifications,
  fetchAdminSupportLinks,
  fetchAdminHelpContent,
  fetchAdminCacheSettings,
  searchAdminProducts,
  fetchProductOverrides,
  updateProductOverride,
  updateAdminSupportLinks,
  updateAdminHelpContent,
  updateAdminCacheSettings,
  clearAdminCache,
  fetchRussianIndexState,
  refreshRussianIndex,
  deleteProductOverride,
  fetchSchedulerState,
  updateSchedulerInterval,
  triggerDealCheck,
  fetchDigisellerRates,
  refreshDigisellerRates,
  fetchTopupCards,
  refreshTopupCards,
  updateTopupCard,
  fetchAdminPurchases,
  fetchAdminCollections,
  fetchAdminCollection,
  createAdminCollection,
  updateAdminCollection,
  deleteAdminCollection,
  setAdminCollectionProducts,
  fetchAdminCollectionsRefreshState,
  refreshAdminCollections,
  updateAdminCollectionsSchedule,
  fetchAdminSaleIndex,
  refreshAdminSaleIndex,
  stopAdminSaleIndex,
  cancelAdminSaleIndex,
  fetchAdminSaleIndexRuns,
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

function formatLogTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

const RUSSIAN_INDEX_PHASES = {
  starting: 'Запуск...',
  walking: 'Обход каталога',
  classifying: 'Определение языка',
  done: 'Готово',
  error: 'Ошибка',
  idle: 'Ожидание',
};

function renderRussianIndexProgress(progress) {
  if (!progress) return null;
  const phase = RUSSIAN_INDEX_PHASES[progress.phase] || progress.phase;
  const isClassifying = progress.phase === 'classifying';
  const total = Number(progress.total) || 0;
  const done = isClassifying ? Number(progress.processed) || 0 : Number(progress.scanned) || 0;
  const percent = isClassifying && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div className="admin-index-progress">
      <div className="admin-index-progress-head">
        <span>{phase}</span>
        <span>
          {isClassifying
            ? `${done.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')}${percent !== null ? ` (${percent}%)` : ''}`
            : `${done.toLocaleString('ru-RU')} игр`}
          {progress.fetched > 0 && ` • загружено ${Number(progress.fetched).toLocaleString('ru-RU')}`}
        </span>
      </div>
      <div className="admin-index-progress-bar">
        <div
          className={`admin-index-progress-fill ${percent === null ? 'indeterminate' : ''}`}
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  );
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

const SALE_PHASE_LABELS = {
  scanning: 'Сканирование каталога',
  cleanup: 'Очистка устаревших',
  done: 'Готово',
  cancelled: 'Отменено',
  error: 'Ошибка',
};

function saleRunStatusLabel(status) {
  const map = { success: 'успех', failed: 'ошибка', cancelled: 'отменён', running: 'выполняется' };
  return map[status] || status || '—';
}

function saleRunStatusClass(status) {
  if (status === 'success') return 'admin-status-ok';
  if (status === 'failed') return 'admin-status-err';
  if (status === 'cancelled') return 'admin-status-warn';
  return '';
}

const EMPTY_DIG_RATE_STATE = { lastRun: null, samples: [] };

const PRODUCT_LANGUAGE_MODES = [
  { value: 'auto', label: 'Авто с Xbox' },
  { value: 'full_ru', label: 'Полностью на русском' },
  { value: 'ru_subtitles', label: 'Русские субтитры' },
  { value: 'no_ru', label: 'Без русского' },
  { value: 'unknown', label: 'Язык не указан' },
];

const PRODUCT_LANGUAGE_FILTERS = [
  { value: 'all', label: 'Все языки' },
  { value: 'unknown', label: 'Язык не указан' },
  { value: 'no_ru', label: 'Без русского' },  
  { value: 'full_ru', label: 'Полностью на русском' },
  { value: 'ru_subtitles', label: 'Русские субтитры' },
];

const LANGUAGE_TAG_STYLES = {
  full_ru:      { background: 'rgba(16,124,16,0.25)', color: '#7edf7e', border: '1px solid rgba(16,124,16,0.4)' },
  ru_subtitles: { background: 'rgba(9,100,175,0.25)', color: '#7dcfff', border: '1px solid rgba(9,100,175,0.4)' },
  no_ru:        { background: 'rgba(255,255,255,0.08)', color: '#e0e4ed', border: '1px solid rgba(255,255,255,0.2)' },
  unknown:      { background: 'rgba(120,120,120,0.2)', color: '#b0b6c4', border: '1px solid rgba(120,120,120,0.3)' },
  auto:         { background: 'transparent', color: '#b0b6c4', border: '1px solid rgba(255,255,255,0.12)' },
};

const LANGUAGE_TAG_BASE = {
  display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
  fontSize: '0.78rem', fontWeight: 500, whiteSpace: 'nowrap',
};

function ProductLanguageTag({ mode }) {
  const resolved = mode || 'auto';
  const label = PRODUCT_LANGUAGE_MODES.find((item) => item.value === resolved)?.label || resolved;
  const style = { ...LANGUAGE_TAG_BASE, ...(LANGUAGE_TAG_STYLES[resolved] || LANGUAGE_TAG_STYLES.auto) };
  return <span style={style}>{label}</span>;
}

function productLanguageLabel(mode) {
  return PRODUCT_LANGUAGE_MODES.find((item) => item.value === (mode || 'auto'))?.label || mode || 'Авто';
}

function serializeDelimitedPairs(items, leftKey, rightKey) {
  return (items || [])
    .map((item) => {
      const left = String(item?.[leftKey] || '').trim();
      const right = String(item?.[rightKey] || '').trim();
      return left || right ? `${left} || ${right}`.trim() : '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseDelimitedPairs(text, leftKey, rightKey) {
  return String(text || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [left, ...rest] = line.split('||');
      return {
        [leftKey]: String(left || '').trim(),
        [rightKey]: String(rest.join('||') || '').trim(),
      };
    })
    .filter((item) => item[leftKey] || item[rightKey]);
}

function helpContentToForm(content = {}) {
  return {
    eyebrow: content.eyebrow || '',
    title: content.title || '',
    subtitle: content.subtitle || '',
    supportTitle: content.supportTitle || '',
    supportDescription: content.supportDescription || '',
    supportButtonLabel: content.supportButtonLabel || '',
    supportButtonUrl: content.supportButtonUrl || '',
    purchasesTitle: content.purchasesTitle || '',
    purchasesDescription: content.purchasesDescription || '',
    purchasesButtonLabel: content.purchasesButtonLabel || '',
    purchasesButtonUrl: content.purchasesButtonUrl || '',
    steps: Array.isArray(content.steps) ? content.steps.map((s) => ({ title: s.title || '', body: s.body || '' })) : [],
    faqItems: Array.isArray(content.faqItems) ? content.faqItems.map((f) => ({ question: f.question || '', answer: f.answer || '' })) : [],
  };
}

function helpFormToPayload(form = {}) {
  return {
    eyebrow: form.eyebrow || '',
    title: form.title || '',
    subtitle: form.subtitle || '',
    supportTitle: form.supportTitle || '',
    supportDescription: form.supportDescription || '',
    supportButtonLabel: form.supportButtonLabel || '',
    supportButtonUrl: form.supportButtonUrl || '',
    purchasesTitle: form.purchasesTitle || '',
    purchasesDescription: form.purchasesDescription || '',
    purchasesButtonLabel: form.purchasesButtonLabel || '',
    purchasesButtonUrl: form.purchasesButtonUrl || '',
    steps: (form.steps || []).filter((s) => s.title || s.body),
    faqItems: (form.faqItems || []).filter((f) => f.question || f.answer),
  };
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

function RichTextarea({ value, onChange, rows = 3, placeholder = '' }) {
  const ref = React.useRef(null);
  const [linkMode, setLinkMode] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState('');
  const [savedSel, setSavedSel] = React.useState({ start: 0, end: 0 });

  const openLink = () => {
    const el = ref.current;
    setSavedSel({ start: el?.selectionStart ?? value.length, end: el?.selectionEnd ?? value.length });
    setLinkUrl('');
    setLinkMode(true);
  };

  const insertLink = () => {
    const url = linkUrl.trim();
    if (!url) { setLinkMode(false); return; }
    const { start, end } = savedSel;
    const selected = value.slice(start, end);
    const insert = `[${selected || 'текст'}](${url})`;
    const next = value.slice(0, start) + insert + value.slice(end);
    onChange({ target: { value: next } });
    setLinkMode(false);
    requestAnimationFrame(() => {
      if (ref.current) {
        const pos = start + insert.length;
        ref.current.setSelectionRange(pos, pos);
        ref.current.focus();
      }
    });
  };

  return (
    <div className="admin-rich-wrap">
      <textarea ref={ref} value={value} onChange={onChange} rows={rows} placeholder={placeholder} />
      <div className="admin-rich-bar">
        {linkMode ? (
          <>
            <input
              autoFocus
              type="text"
              className="admin-rich-url-input"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
                if (e.key === 'Escape') setLinkMode(false);
              }}
            />
            <button type="button" className="admin-btn admin-btn-sm" onClick={insertLink}>ОК</button>
            <button type="button" className="admin-btn admin-btn-sm" onClick={() => setLinkMode(false)}>✕</button>
          </>
        ) : (
          <button type="button" className="admin-rich-link-btn" onClick={openLink} title="Выделите слово и нажмите, чтобы добавить ссылку">
            🔗 Ссылка
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminPage({ currentUser, onLoginClick }) {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(null); // null=loading, true/false
  const [tab, setTab] = useState('dashboard');

  // Dashboard
  const [stats, setStats] = useState(null);
  const [supportLinksForm, setSupportLinksForm] = useState({
    vkUrl: '',
    telegramUrl: '',
    telegramBotProxyUrl: '',
    maxUrl: '',
  });
  const [supportLinksMessage, setSupportLinksMessage] = useState('');
  const [supportLinksSaving, setSupportLinksSaving] = useState(false);
  const [helpContentForm, setHelpContentForm] = useState(() => helpContentToForm({}));
  const [helpContentMessage, setHelpContentMessage] = useState('');
  const [helpContentSaving, setHelpContentSaving] = useState(false);
  const [cacheSettingsForm, setCacheSettingsForm] = useState({
    ttl: '',
    mainCatalogTtl: '',
  });
  const [cacheSettingsEntries, setCacheSettingsEntries] = useState(0);
  const [cacheSettingsMessage, setCacheSettingsMessage] = useState('');
  const [cacheSettingsSaving, setCacheSettingsSaving] = useState(false);
  const [cacheClearLoading, setCacheClearLoading] = useState(false);
  const [russianIndexState, setRussianIndexState] = useState(null);
  const [russianIndexMessage, setRussianIndexMessage] = useState('');
  const [russianIndexRefreshing, setRussianIndexRefreshing] = useState(false);

  // Users
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState('');
  const [userAccessSavingId, setUserAccessSavingId] = useState('');
  const [userAccessMessage, setUserAccessMessage] = useState('');

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
    searchKeywords: '',
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

  // Purchases
  const [purchasesData, setPurchasesData] = useState({ purchases: [], total: 0 });
  const [purchasesSort, setPurchasesSort] = useState('count');
  const [purchasesLoading, setPurchasesLoading] = useState(false);

  // Collections (Подборки)
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [newCollectionTitle, setNewCollectionTitle] = useState('');
  const [selectedCollection, setSelectedCollection] = useState(null); // detail with productIds
  const [collectionProducts, setCollectionProducts] = useState([]); // [{id,title}]
  const [collectionProductsSaving, setCollectionProductsSaving] = useState(false);
  const [collectionMessage, setCollectionMessage] = useState('');
  const [collectionProductSearch, setCollectionProductSearch] = useState('');
  const [collectionSearchResults, setCollectionSearchResults] = useState([]);
  const [collectionSearchLoading, setCollectionSearchLoading] = useState(false);
  const [collectionsRefresh, setCollectionsRefresh] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ hour: 4, minute: 0, enabled: true });

  // Sale Index
  const [saleIndex, setSaleIndex] = useState(null);
  const [saleIndexRuns, setSaleIndexRuns] = useState([]);
  const [saleIndexLoading, setSaleIndexLoading] = useState(false);
  const [saleIndexMessage, setSaleIndexMessage] = useState('');
  const [expandedRunId, setExpandedRunId] = useState(null);
  const saleWasRunningRef = useRef(false);

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
        telegramBotProxyUrl: links.telegramBotProxyUrl || '',
        maxUrl: links.maxUrl || '',
      });
    } catch { /* ignore */ }
  }, []);

  const loadHelpContent = useCallback(async () => {
    try {
      const content = await fetchAdminHelpContent();
      setHelpContentForm(helpContentToForm(content));
    } catch { /* ignore */ }
  }, []);

  const loadCacheSettings = useCallback(async () => {
    try {
      const settings = await fetchAdminCacheSettings();
      setCacheSettingsForm({
        ttl: String(settings.ttl || ''),
        mainCatalogTtl: String(settings.mainCatalogTtl || ''),
      });
      setCacheSettingsEntries(Number(settings.entries) || 0);
    } catch { /* ignore */ }
  }, []);

  const loadRussianIndex = useCallback(async () => {
    try {
      setRussianIndexState(await fetchRussianIndexState());
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

  const loadPurchases = useCallback(async (sort = 'count') => {
    setPurchasesLoading(true);
    try {
      const result = await fetchAdminPurchases({ sort, limit: 100 });
      setPurchasesData(result || { purchases: [], total: 0 });
    } catch { /* ignore */ }
    finally { setPurchasesLoading(false); }
  }, []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      const list = await fetchAdminCollections();
      setCollections(list || []);
    } catch { /* ignore */ }
    finally { setCollectionsLoading(false); }
  }, []);

  const loadCollectionsRefresh = useCallback(async () => {
    try {
      const state = await fetchAdminCollectionsRefreshState();
      setCollectionsRefresh(state);
      if (state?.schedule) {
        setScheduleForm({
          hour: state.schedule.hour ?? 4,
          minute: state.schedule.minute ?? 0,
          enabled: state.schedule.enabled !== false,
        });
      }
    } catch { /* ignore */ }
  }, []);

  const loadSaleIndex = useCallback(async () => {
    try {
      const data = await fetchAdminSaleIndex();
      setSaleIndex(data);
    } catch { /* ignore */ }
  }, []);

  const loadSaleIndexRuns = useCallback(async () => {
    try {
      const runs = await fetchAdminSaleIndexRuns(20);
      setSaleIndexRuns(runs);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    if (tab === 'dashboard') {
      loadDashboard();
      loadSupportLinks();
      loadCacheSettings();
      loadRussianIndex();
    }
    else if (tab === 'users') loadUsers(1, usersSearch);
    else if (tab === 'notifications') loadNotifications(1);
    else if (tab === 'products') {
      loadProductOverrides();
      loadAdminProducts({ q: productSearch, languageMode: productLanguageFilter });
    }
    else if (tab === 'help') loadHelpContent();
    else if (tab === 'digiseller') loadDigiseller();
    else if (tab === 'topup') loadTopupCards();
    else if (tab === 'purchases') loadPurchases(purchasesSort);
    else if (tab === 'collections') { loadCollections(); loadCollectionsRefresh(); }
    else if (tab === 'scheduler') { loadSaleIndex(); loadSaleIndexRuns(); }
  }, [tab, authorized, loadDashboard, loadSupportLinks, loadCacheSettings, loadRussianIndex, loadUsers, loadNotifications, loadProductOverrides, loadAdminProducts, loadHelpContent, loadDigiseller, loadTopupCards, loadPurchases, purchasesSort, loadCollections, loadCollectionsRefresh, loadSaleIndex, loadSaleIndexRuns]);

  // Poll snapshot-refresh status while a refresh is running.
  useEffect(() => {
    if (!authorized || tab !== 'collections') return undefined;
    if (!collectionsRefresh?.running) return undefined;
    const timer = setInterval(loadCollectionsRefresh, 3000);
    return () => clearInterval(timer);
  }, [authorized, tab, collectionsRefresh?.running, loadCollectionsRefresh]);

  // While a Russian-index build is running, poll its status.
  useEffect(() => {
    if (!authorized || tab !== 'dashboard') return undefined;
    if (!russianIndexState?.isBuilding) return undefined;
    const timer = setInterval(loadRussianIndex, 3000);
    return () => clearInterval(timer);
  }, [authorized, tab, russianIndexState?.isBuilding, loadRussianIndex]);

  // Poll sale index live while it's running (fast cadence for the log feed).
  useEffect(() => {
    if (!authorized || tab !== 'scheduler') return undefined;
    if (!saleIndex?.scheduler?.isRunning) return undefined;
    const timer = setInterval(loadSaleIndex, 1500);
    return () => clearInterval(timer);
  }, [authorized, tab, saleIndex?.scheduler?.isRunning, loadSaleIndex]);

  // When a run finishes, refresh the history table once.
  useEffect(() => {
    const running = Boolean(saleIndex?.scheduler?.isRunning);
    if (saleWasRunningRef.current && !running) {
      loadSaleIndexRuns();
    }
    saleWasRunningRef.current = running;
  }, [saleIndex?.scheduler?.isRunning, loadSaleIndexRuns]);

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

  // ---- Collections handlers ----
  const handleCreateCollection = async (e) => {
    e.preventDefault();
    const title = newCollectionTitle.trim();
    if (!title) return;
    setCollectionMessage('');
    try {
      await createAdminCollection({ title });
      setNewCollectionTitle('');
      await loadCollections();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const selectCollection = async (id) => {
    setCollectionMessage('');
    try {
      const detail = await fetchAdminCollection(id);
      setSelectedCollection(detail);
      // Seed the editable product list; titles come from search picks or the id.
      setCollectionProducts((detail.productIds || []).map((pid) => ({ id: pid, title: pid })));
      setCollectionSearchResults([]);
      setCollectionProductSearch('');
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleToggleCollectionEnabled = async (collection) => {
    try {
      await updateAdminCollection(collection.id, { enabled: !collection.enabled });
      await loadCollections();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDeleteCollection = async (collection) => {
    if (!window.confirm(`Удалить подборку «${collection.title}»?`)) return;
    try {
      await deleteAdminCollection(collection.id);
      if (selectedCollection?.id === collection.id) setSelectedCollection(null);
      await loadCollections();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleCollectionProductSearch = async (e) => {
    e.preventDefault();
    setCollectionSearchLoading(true);
    try {
      const results = await searchAdminProducts({ q: collectionProductSearch.trim() });
      setCollectionSearchResults(results || []);
    } catch { /* ignore */ }
    finally { setCollectionSearchLoading(false); }
  };

  const addProductToCollection = (product) => {
    setCollectionProducts((current) => (
      current.some((p) => p.id === product.id)
        ? current
        : [...current, { id: product.id, title: product.title || product.id }]
    ));
  };

  const removeProductFromCollection = (productId) => {
    setCollectionProducts((current) => current.filter((p) => p.id !== productId));
  };

  const handleSaveCollectionProducts = async () => {
    if (!selectedCollection) return;
    setCollectionProductsSaving(true);
    setCollectionMessage('');
    try {
      await setAdminCollectionProducts(selectedCollection.id, collectionProducts.map((p) => p.id));
      setCollectionMessage('Состав подборки сохранён');
      await loadCollections();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setCollectionProductsSaving(false);
    }
  };

  const handleRefreshCollections = async () => {
    try {
      await refreshAdminCollections();
      await loadCollectionsRefresh();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveSchedule = async (e) => {
    e.preventDefault();
    setCollectionMessage('');
    try {
      await updateAdminCollectionsSchedule({
        hour: Number(scheduleForm.hour),
        minute: Number(scheduleForm.minute),
        enabled: scheduleForm.enabled,
      });
      setCollectionMessage('Расписание сохранено');
      await loadCollectionsRefresh();
    } catch (err) {
      setCollectionMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
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
        telegramBotProxyUrl: links.telegramBotProxyUrl || '',
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

  const handleCacheSettingsSave = async (event) => {
    event.preventDefault();
    setCacheSettingsSaving(true);
    setCacheSettingsMessage('');

    try {
      const settings = await updateAdminCacheSettings({
        ttl: parseInt(cacheSettingsForm.ttl, 10),
        mainCatalogTtl: parseInt(cacheSettingsForm.mainCatalogTtl, 10),
      });
      setCacheSettingsForm({
        ttl: String(settings.ttl || ''),
        mainCatalogTtl: String(settings.mainCatalogTtl || ''),
      });
      setCacheSettingsEntries(Number(settings.entries) || 0);
      setCacheSettingsMessage('Настройки кэша сохранены');
    } catch (err) {
      setCacheSettingsMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setCacheSettingsSaving(false);
    }
  };

  const handleCacheClear = async () => {
    setCacheClearLoading(true);
    setCacheSettingsMessage('');

    try {
      const result = await clearAdminCache();
      setCacheSettingsEntries(Number(result.sizeAfter) || 0);
      setCacheSettingsMessage(`Кэш очищен: ${result.sizeBefore || 0} -> ${result.sizeAfter || 0}`);
    } catch (err) {
      setCacheSettingsMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setCacheClearLoading(false);
    }
  };

  const handleRussianIndexRefresh = async () => {
    setRussianIndexRefreshing(true);
    setRussianIndexMessage('');

    try {
      const result = await refreshRussianIndex();
      if (result?.alreadyRunning) {
        setRussianIndexMessage('Обновление уже выполняется');
      } else {
        setRussianIndexMessage('Обновление запущено — индекс собирается в фоне');
      }
      if (result?.state) setRussianIndexState(result.state);
      await loadRussianIndex();
    } catch (err) {
      setRussianIndexMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setRussianIndexRefreshing(false);
    }
  };

  const handleHelpContentSave = async (event) => {
    event.preventDefault();
    setHelpContentSaving(true);
    setHelpContentMessage('');
    try {
      const content = await updateAdminHelpContent(helpFormToPayload(helpContentForm));
      setHelpContentForm(helpContentToForm(content));
      setHelpContentMessage('Раздел помощи сохранён');
    } catch (err) {
      setHelpContentMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setHelpContentSaving(false);
    }
  };

  const handleUserAdminToggle = async (user) => {
    if (!user?.id) return;
    setUserAccessSavingId(user.id);
    setUserAccessMessage('');
    try {
      const updatedUser = await updateAdminUserAccess(user.id, !user.isManualAdmin);
      setUsers((current) => current.map((entry) => (entry.id === user.id ? updatedUser : entry)));
      setSelectedUser((current) => (current?.user?.id === user.id
        ? { ...current, user: updatedUser }
        : current));
      setUserAccessMessage(updatedUser.isManualAdmin ? 'Админ выдан' : 'Админ снят');
    } catch (err) {
      setUserAccessMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setUserAccessSavingId('');
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
      searchKeywords: (currentOverride.searchKeywords || []).join(', '),
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
      searchKeywords: (override.searchKeywords || []).join(', '),
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
        searchKeywords: (override.searchKeywords || []).join(', '),
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
        searchKeywords: '',
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

  const handleSaleIndexStart = async () => {
    setSaleIndexLoading(true);
    setSaleIndexMessage('');
    try {
      const result = await refreshAdminSaleIndex();
      if (result.alreadyRunning) {
        setSaleIndexMessage('Сканирование уже запущено');
      } else {
        setSaleIndexMessage('Сканирование запущено — обновляется в фоне');
        await loadSaleIndex();
        await loadSaleIndexRuns();
      }
    } catch (err) {
      setSaleIndexMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleIndexLoading(false);
    }
  };

  const handleSaleIndexStop = async () => {
    setSaleIndexMessage('');
    try {
      await stopAdminSaleIndex();
      setSaleIndexMessage('Авто-обновление остановлено (таймер выключен)');
      await loadSaleIndex();
    } catch (err) {
      setSaleIndexMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaleIndexCancel = async () => {
    setSaleIndexMessage('');
    try {
      const result = await cancelAdminSaleIndex();
      setSaleIndexMessage(result.running ? 'Отмена запрошена — завершаем текущую страницу...' : 'Сканирование сейчас не выполняется');
      await loadSaleIndex();
    } catch (err) {
      setSaleIndexMessage('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  // Derived sale-index state for the live panel.
  const saleSched = saleIndex?.scheduler;
  const saleRunning = Boolean(saleSched?.isRunning);
  const saleCancelling = Boolean(saleSched?.cancelRequested);
  const saleProgress = saleSched?.progress || (saleRunning ? null : null);
  const saleLog = (saleSched?.log && saleSched.log.length)
    ? saleSched.log
    : (saleIndex?.lastRun?.log || []);

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
          ['collections', 'Подборки'],
          ['scheduler', 'Планировщик'],
          ['help', 'Помощь'],
          ['digiseller', 'Digiseller'],
          ['topup', 'Карты пополнения'],
          ['purchases', 'Покупки'],
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
                <span>Telegram Proxy</span>
                <input
                  type="text"
                  value={supportLinksForm.telegramBotProxyUrl}
                  onChange={(e) => setSupportLinksForm((current) => ({ ...current, telegramBotProxyUrl: e.target.value }))}
                  placeholder="http://login:password@host:port"
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

          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h3>Кэш сайта</h3>
                <p className="admin-card-desc">
                  Можно изменить время кэширования и сразу очистить текущий кэш без правки `.env`.
                </p>
              </div>
            </div>
            <form className="admin-override-form" onSubmit={handleCacheSettingsSave}>
              <div className="admin-grid-2col">
                <label className="admin-field">
                  <span>Обычный кэш (сек)</span>
                  <input
                    type="number"
                    min="1"
                    value={cacheSettingsForm.ttl}
                    onChange={(e) => setCacheSettingsForm((current) => ({ ...current, ttl: e.target.value }))}
                    placeholder="300"
                  />
                </label>

                <label className="admin-field">
                  <span>Главный каталог (сек)</span>
                  <input
                    type="number"
                    min="1"
                    value={cacheSettingsForm.mainCatalogTtl}
                    onChange={(e) => setCacheSettingsForm((current) => ({ ...current, mainCatalogTtl: e.target.value }))}
                    placeholder="900"
                  />
                </label>
              </div>

              <p className="admin-card-desc">Сейчас записей в памяти: {cacheSettingsEntries}</p>

              <div className="admin-override-actions">
                <button className="admin-btn admin-btn-primary" type="submit" disabled={cacheSettingsSaving}>
                  {cacheSettingsSaving ? 'Сохраняем...' : 'Сохранить TTL'}
                </button>
                <button className="admin-btn admin-btn-secondary" type="button" onClick={handleCacheClear} disabled={cacheClearLoading}>
                  {cacheClearLoading ? 'Очищаем...' : 'Сбросить кэш'}
                </button>
              </div>
              {cacheSettingsMessage && <p className="admin-scheduler-result">{cacheSettingsMessage}</p>}
            </form>
          </div>

          <div className="admin-card">
            <div className="admin-card-head">
              <div>
                <h3>Фильтр «Язык» (русские игры)</h3>
                <p className="admin-card-desc">
                  Список игр с русским языком собирается заранее, чтобы фильтр работал быстро.
                  Обновляется автоматически каждые {russianIndexState?.intervalHours || '—'} ч,
                  либо вручную кнопкой ниже.
                </p>
              </div>
            </div>

            <div className="admin-stats-grid">
              <div className="admin-stat-card">
                <div className="admin-stat-value">{russianIndexState?.counts?.russian ?? 0}</div>
                <div className="admin-stat-label">С русским</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-value">{russianIndexState?.counts?.fullRu ?? 0}</div>
                <div className="admin-stat-label">Полностью на русском</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-value">{russianIndexState?.counts?.subtitles ?? 0}</div>
                <div className="admin-stat-label">Только субтитры</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-value">{russianIndexState?.counts?.scanned ?? 0}</div>
                <div className="admin-stat-label">Просканировано</div>
              </div>
            </div>

            <p className="admin-card-desc">
              Последнее обновление: {formatDate(russianIndexState?.builtAt)}
              {' • '}
              {russianIndexState?.isBuilding
                ? 'идёт сборка...'
                : (russianIndexState?.complete ? 'индекс готов' : 'не завершён — будет достроен')}
              {russianIndexState?.lastError && ` • ошибка: ${russianIndexState.lastError}`}
            </p>
            {russianIndexState?.walkedAt && russianIndexState?.walkedCount > 0 && (
              <p className="admin-card-desc" style={{ marginTop: '0.25rem', opacity: 0.7 }}>
                Кэш обхода: {russianIndexState.walkedCount} игр от {formatDate(russianIndexState.walkedAt)} — следующая сборка пропустит обход каталога (если &lt; 1 ч)
              </p>
            )}

            {russianIndexState?.isBuilding && renderRussianIndexProgress(russianIndexState.progress)}

            <div className="admin-override-actions">
              <button
                className="admin-btn admin-btn-primary"
                type="button"
                onClick={handleRussianIndexRefresh}
                disabled={russianIndexRefreshing || russianIndexState?.isBuilding}
              >
                {russianIndexState?.isBuilding ? 'Собирается...' : (russianIndexRefreshing ? 'Запуск...' : 'Обновить сейчас')}
              </button>
            </div>
            {russianIndexMessage && <p className="admin-scheduler-result">{russianIndexMessage}</p>}

            {russianIndexState?.logs?.length > 0 && (
              <div className="admin-index-logs">
                {[...russianIndexState.logs].reverse().map((entry, i) => (
                  <div className="admin-index-log-row" key={`${entry.ts}-${i}`}>
                    <span className="admin-index-log-time">{formatLogTime(entry.ts)}</span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
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
          {userAccessMessage && <p className="admin-scheduler-result">{userAccessMessage}</p>}

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Имя</th>
                  <th>Email</th>
                  <th>Провайдер</th>
                  <th>Админ</th>
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
                    <td>
                      <span className={`admin-role-pill ${u.isAdmin ? 'admin-role-pill--active' : ''} ${u.isConfigAdmin ? 'admin-role-pill--config' : ''}`}>
                        {u.isConfigAdmin ? 'ENV' : u.isManualAdmin ? 'Да' : 'Нет'}
                      </span>
                    </td>
                    <td>{u.favorites_count}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>
                      <button className="admin-btn admin-btn-sm" type="button" onClick={() => openUserDetail(u.id)}>
                        Подробнее
                      </button>
                      <button
                        className="admin-btn admin-btn-sm"
                        type="button"
                        onClick={() => handleUserAdminToggle(u)}
                        disabled={userAccessSavingId === u.id || u.isConfigAdmin}
                      >
                        {userAccessSavingId === u.id ? 'Сохраняем...' : u.isManualAdmin ? 'Снять' : 'Выдать'}
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
              <dt>Админ</dt><dd>{selectedUser.user.isConfigAdmin ? 'ENV' : selectedUser.user.isManualAdmin ? 'Да' : 'Нет'}</dd>
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
                        <td><ProductLanguageTag mode={product.russianLanguageMode} /></td>
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
                  <span style={{ color: '#ac84f1' }}>Спецпредложение (ID товара на oplata.info)</span>
                  <input
                    type="text"
                    value={overrideForm.specialOfferUrl}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, specialOfferUrl: e.target.value }))}
                    placeholder="например: 1234567"
                  />
                </label>

                <label className="admin-field">
                  <span>Дополнительные ключевые слова поиска</span>
                  <input
                    type="text"
                    value={overrideForm.searchKeywords}
                    onChange={(e) => setOverrideForm((current) => ({ ...current, searchKeywords: e.target.value }))}
                    placeholder="Например: fifa, football, ea fc"
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
                      <td><ProductLanguageTag mode={override.russianLanguageMode} /></td>
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

      {/* ==================== Help ==================== */}
      {tab === 'help' && (
        <div className="admin-panel">
          <div className="admin-grid-2col">
            <div className="admin-card">
              <h3>Верхний блок</h3>
              <form className="admin-override-form" onSubmit={handleHelpContentSave}>
                <label className="admin-field">
                  <span>Надзаголовок</span>
                  <input
                    type="text"
                    value={helpContentForm.eyebrow}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, eyebrow: e.target.value }))}
                    placeholder="Помощь"
                  />
                </label>

                <label className="admin-field">
                  <span>Заголовок</span>
                  <input
                    type="text"
                    value={helpContentForm.title}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, title: e.target.value }))}
                    placeholder="Как купить игру и получить помощь"
                  />
                </label>

                <label className="admin-field">
                  <span>Подзаголовок</span>
                  <RichTextarea
                    value={helpContentForm.subtitle}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, subtitle: e.target.value }))}
                    rows={5}
                  />
                </label>

                <div className="admin-override-actions">
                  <button className="admin-btn admin-btn-primary" type="submit" disabled={helpContentSaving}>
                    {helpContentSaving ? 'Сохраняем...' : 'Сохранить помощь'}
                  </button>
                </div>
              </form>
            </div>

            <div className="admin-card">
              <h3>Карточки помощи</h3>
              <p className="admin-card-desc">Описания поддерживают ссылки: [текст](https://...)</p>
              <form className="admin-override-form" onSubmit={handleHelpContentSave}>
                <label className="admin-field">
                  <span>Заголовок поддержки</span>
                  <input
                    type="text"
                    value={helpContentForm.supportTitle}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, supportTitle: e.target.value }))}
                  />
                </label>

                <label className="admin-field">
                  <span>Описание поддержки</span>
                  <RichTextarea
                    value={helpContentForm.supportDescription}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, supportDescription: e.target.value }))}
                    rows={4}
                  />
                </label>

                <label className="admin-field">
                  <span>Текст кнопки поддержки</span>
                  <input
                    type="text"
                    value={helpContentForm.supportButtonLabel}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, supportButtonLabel: e.target.value }))}
                  />
                </label>

                <label className="admin-field">
                  <span>Ссылка кнопки поддержки</span>
                  <input
                    type="text"
                    value={helpContentForm.supportButtonUrl}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, supportButtonUrl: e.target.value }))}
                    placeholder="Если пусто, страница возьмёт первую ссылку из контактов"
                  />
                </label>

                <label className="admin-field">
                  <span>Заголовок блока покупки</span>
                  <input
                    type="text"
                    value={helpContentForm.purchasesTitle}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, purchasesTitle: e.target.value }))}
                  />
                </label>

                <label className="admin-field">
                  <span>Описание блока покупки</span>
                  <RichTextarea
                    value={helpContentForm.purchasesDescription}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, purchasesDescription: e.target.value }))}
                    rows={4}
                  />
                </label>

                <label className="admin-field">
                  <span>Текст кнопки покупки</span>
                  <input
                    type="text"
                    value={helpContentForm.purchasesButtonLabel}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, purchasesButtonLabel: e.target.value }))}
                  />
                </label>

                <label className="admin-field">
                  <span>Ссылка кнопки покупки</span>
                  <input
                    type="text"
                    value={helpContentForm.purchasesButtonUrl}
                    onChange={(e) => setHelpContentForm((current) => ({ ...current, purchasesButtonUrl: e.target.value }))}
                    placeholder="https://oplata.info"
                  />
                </label>
              </form>
            </div>
          </div>

          <div className="admin-card">
            <h3>Пошаговый блок</h3>
            <p className="admin-card-desc">Поддерживает ссылки: [текст](https://...)</p>
            <div className="admin-help-items">
              {(helpContentForm.steps || []).map((step, idx) => (
                <div key={idx} className="admin-help-item">
                  <div className="admin-help-item-index">{idx + 1}</div>
                  <div className="admin-help-item-fields">
                    <input
                      type="text"
                      placeholder="Заголовок шага"
                      value={step.title}
                      onChange={(e) => setHelpContentForm((cur) => {
                        const steps = cur.steps.map((s, i) => (i === idx ? { ...s, title: e.target.value } : s));
                        return { ...cur, steps };
                      })}
                    />
                    <RichTextarea
                      placeholder="Описание шага"
                      rows={2}
                      value={step.body}
                      onChange={(e) => setHelpContentForm((cur) => {
                        const steps = cur.steps.map((s, i) => (i === idx ? { ...s, body: e.target.value } : s));
                        return { ...cur, steps };
                      })}
                    />
                  </div>
                  <button
                    type="button"
                    className="admin-help-item-del"
                    title="Удалить шаг"
                    onClick={() => setHelpContentForm((cur) => ({ ...cur, steps: cur.steps.filter((_, i) => i !== idx) }))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="admin-btn"
                onClick={() => setHelpContentForm((cur) => ({ ...cur, steps: [...(cur.steps || []), { title: '', body: '' }] }))}
              >
                + Добавить шаг
              </button>
            </div>
          </div>

          <div className="admin-card">
            <h3>Частые вопросы (FAQ)</h3>
            <p className="admin-card-desc">Поддерживает ссылки: [текст](https://...)</p>
            <div className="admin-help-items">
              {(helpContentForm.faqItems || []).map((item, idx) => (
                <div key={idx} className="admin-help-item admin-help-item--faq">
                  <div className="admin-help-item-index">{idx + 1}</div>
                  <div className="admin-help-item-fields">
                    <input
                      type="text"
                      placeholder="Вопрос"
                      value={item.question}
                      onChange={(e) => setHelpContentForm((cur) => {
                        const faqItems = cur.faqItems.map((f, i) => (i === idx ? { ...f, question: e.target.value } : f));
                        return { ...cur, faqItems };
                      })}
                    />
                    <RichTextarea
                      placeholder="Ответ"
                      rows={3}
                      value={item.answer}
                      onChange={(e) => setHelpContentForm((cur) => {
                        const faqItems = cur.faqItems.map((f, i) => (i === idx ? { ...f, answer: e.target.value } : f));
                        return { ...cur, faqItems };
                      })}
                    />
                  </div>
                  <button
                    type="button"
                    className="admin-help-item-del"
                    title="Удалить вопрос"
                    onClick={() => setHelpContentForm((cur) => ({ ...cur, faqItems: cur.faqItems.filter((_, i) => i !== idx) }))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="admin-btn"
                onClick={() => setHelpContentForm((cur) => ({ ...cur, faqItems: [...(cur.faqItems || []), { question: '', answer: '' }] }))}
              >
                + Добавить вопрос
              </button>
            </div>

            <div className="admin-override-actions" style={{ marginTop: '1.2rem' }}>
              <button className="admin-btn admin-btn-primary" type="button" onClick={handleHelpContentSave} disabled={helpContentSaving}>
                {helpContentSaving ? 'Сохраняем...' : 'Сохранить раздел помощи'}
              </button>
            </div>
            {helpContentMessage && <p className="admin-scheduler-result">{helpContentMessage}</p>}
          </div>
        </div>
      )}

      {/* ==================== Collections (Подборки) ==================== */}
      {tab === 'collections' && (
        <div className="admin-panel">
          {collectionMessage && <p className="admin-scheduler-result">{collectionMessage}</p>}
          <div className="admin-grid-2col admin-products-grid">
            <div className="admin-card">
              <h3>Подборки</h3>
              <p className="admin-card-desc">
                Создавайте подборки и добавляйте в них игры. На сайте подборки доступны в фильтре. Одна игра может быть в нескольких подборках.
              </p>
              <form className="admin-search-bar" onSubmit={handleCreateCollection}>
                <input
                  type="text"
                  placeholder="Название новой подборки..."
                  value={newCollectionTitle}
                  onChange={(e) => setNewCollectionTitle(e.target.value)}
                />
                <button type="submit" className="admin-btn admin-btn-primary">Создать</button>
              </form>

              <div className="admin-table-wrap">
                <table className="admin-table admin-table-compact">
                  <thead>
                    <tr><th>Название</th><th>Игр</th><th>На сайте</th><th></th></tr>
                  </thead>
                  <tbody>
                    {collections.map((c) => (
                      <tr key={c.id} style={selectedCollection?.id === c.id ? { background: 'rgba(255,255,255,0.06)' } : undefined}>
                        <td>
                          <button
                            className="admin-btn admin-btn-sm"
                            type="button"
                            onClick={() => selectCollection(c.id)}
                            style={{ background: 'transparent', padding: 0, textAlign: 'left', textDecoration: 'underline' }}
                          >
                            {c.title}
                          </button>
                          <span className="admin-mono" style={{ display: 'block', fontSize: '0.75em', color: 'var(--text-muted)' }}>{c.slug}</span>
                        </td>
                        <td>{c.productCount ?? 0}</td>
                        <td>
                          <button
                            className={`admin-btn admin-btn-sm ${c.enabled ? 'admin-btn-primary' : ''}`}
                            type="button"
                            onClick={() => handleToggleCollectionEnabled(c)}
                            title="Нажмите, чтобы показать/скрыть подборку в фильтре на сайте"
                          >
                            {c.enabled ? '✓ Показана' : 'Скрыта'}
                          </button>
                        </td>
                        <td>
                          <button className="admin-btn admin-btn-sm admin-btn-secondary" type="button" onClick={() => handleDeleteCollection(c)}>
                            Удалить
                          </button>
                        </td>
                      </tr>
                    ))}
                    {collections.length === 0 && !collectionsLoading && (
                      <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Подборок пока нет</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="admin-card" style={{ marginTop: '1rem' }}>
                <h3>Автообновление</h3>
                <p className="admin-card-desc">
                  Раз в сутки сервер заново скачивает данные игр подборок и сохраняет в базу для быстрой отдачи.
                </p>
                {collectionsRefresh && (
                  <dl className="admin-dl">
                    <dt>Последнее обновление</dt><dd>{formatDate(collectionsRefresh.lastRunAt)}</dd>
                    <dt>Игр в снепшоте</dt><dd>{collectionsRefresh.counts?.snapshots ?? 0}</dd>
                    <dt>Статус</dt><dd>{collectionsRefresh.running ? 'Обновляется...' : 'Ожидание'}</dd>
                    {collectionsRefresh.lastError && <><dt>Ошибка</dt><dd>{collectionsRefresh.lastError}</dd></>}
                  </dl>
                )}
                <form className="admin-override-form" onSubmit={handleSaveSchedule}>
                  <label className="admin-field">
                    <span>Время обновления (час : минута)</span>
                    <span style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="number" min={0} max={23}
                        value={scheduleForm.hour}
                        onChange={(e) => setScheduleForm((s) => ({ ...s, hour: e.target.value }))}
                      />
                      <input
                        type="number" min={0} max={59}
                        value={scheduleForm.minute}
                        onChange={(e) => setScheduleForm((s) => ({ ...s, minute: e.target.value }))}
                      />
                    </span>
                  </label>
                  <label className="admin-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={scheduleForm.enabled}
                      onChange={(e) => setScheduleForm((s) => ({ ...s, enabled: e.target.checked }))}
                    />
                    <span>Автообновление включено</span>
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" className="admin-btn admin-btn-primary">Сохранить расписание</button>
                    <button type="button" className="admin-btn" onClick={handleRefreshCollections} disabled={collectionsRefresh?.running}>
                      Обновить сейчас
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className="admin-card">
              {selectedCollection ? (
                <>
                  <h3>Игры подборки «{selectedCollection.title}»</h3>
                  <form className="admin-search-bar" onSubmit={handleCollectionProductSearch}>
                    <input
                      type="text"
                      placeholder="Найти игру по названию или Product ID..."
                      value={collectionProductSearch}
                      onChange={(e) => setCollectionProductSearch(e.target.value)}
                    />
                    <button type="submit" className="admin-btn admin-btn-primary" disabled={collectionSearchLoading}>
                      {collectionSearchLoading ? 'Загрузка...' : 'Найти'}
                    </button>
                  </form>

                  {collectionSearchResults.length > 0 && (
                    <div className="admin-table-wrap" style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <table className="admin-table admin-table-compact">
                        <tbody>
                          {collectionSearchResults.map((product) => (
                            <tr key={product.id}>
                              <td>{product.title}</td>
                              <td className="admin-mono">{product.id}</td>
                              <td>
                                <button
                                  className="admin-btn admin-btn-sm"
                                  type="button"
                                  onClick={() => addProductToCollection(product)}
                                  disabled={collectionProducts.some((p) => p.id === product.id)}
                                >
                                  {collectionProducts.some((p) => p.id === product.id) ? 'Добавлено' : 'Добавить'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h4 style={{ marginTop: '1rem' }}>В подборке: {collectionProducts.length}</h4>
                  <div className="admin-table-wrap">
                    <table className="admin-table admin-table-compact">
                      <tbody>
                        {collectionProducts.map((p) => (
                          <tr key={p.id}>
                            <td>{p.title}</td>
                            <td className="admin-mono">{p.id}</td>
                            <td>
                              <button className="admin-btn admin-btn-sm admin-btn-secondary" type="button" onClick={() => removeProductFromCollection(p.id)}>
                                Убрать
                              </button>
                            </td>
                          </tr>
                        ))}
                        {collectionProducts.length === 0 && (
                          <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Пусто</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <button
                    className="admin-btn admin-btn-primary"
                    type="button"
                    onClick={handleSaveCollectionProducts}
                    disabled={collectionProductsSaving}
                    style={{ marginTop: '0.75rem' }}
                  >
                    {collectionProductsSaving ? 'Сохранение...' : 'Сохранить состав'}
                  </button>
                </>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Выберите подборку слева, чтобы редактировать её состав.</p>
              )}
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

      {/* ==================== Sale Index block inside Scheduler ==================== */}
      {tab === 'scheduler' && (
        <div className="admin-panel">
          <div className="admin-grid-2col">
            {/* Left: controls */}
            <div className="admin-card">
              <div className="admin-card-head">
                <div>
                  <h3>Индекс скидок Xbox</h3>
                  <p className="admin-card-desc">
                    Сканирует каталог Xbox по сортировке «AllDeals desc», сохраняет игры
                    со скидками и даты окончания. Автообновление каждый час.
                  </p>
                </div>
              </div>

              <div className="admin-sale-actions">
                <button
                  className="admin-btn admin-btn-accent"
                  onClick={handleSaleIndexStart}
                  disabled={saleIndexLoading || saleRunning}
                >
                  {saleRunning ? '● Сканирование...' : (saleIndexLoading ? 'Запуск...' : '▶ Запустить сейчас')}
                </button>
                <button
                  className="admin-btn admin-btn-danger"
                  onClick={handleSaleIndexCancel}
                  disabled={!saleRunning || saleCancelling}
                >
                  {saleCancelling ? 'Отменяем...' : '✕ Отменить'}
                </button>
                <button
                  className="admin-btn admin-btn-secondary"
                  onClick={handleSaleIndexStop}
                  disabled={saleIndexLoading || !saleSched?.timerActive}
                  title="Выключить автоматический ежечасный запуск"
                >
                  ⏸ Остановить таймер
                </button>
                <button
                  className="admin-btn admin-btn-sm"
                  onClick={() => { loadSaleIndex(); loadSaleIndexRuns(); }}
                >
                  ⟳ Обновить
                </button>
              </div>
              {saleIndexMessage && <p className="admin-scheduler-result" style={{ marginTop: '0.75rem' }}>{saleIndexMessage}</p>}
            </div>

            {/* Right: status */}
            <div className="admin-card">
              <h3>Статус планировщика</h3>
              {saleIndex ? (
                <dl className="admin-dl">
                  <dt>Всего игр в базе</dt>
                  <dd>{(saleIndex.totalProducts ?? 0).toLocaleString('ru-RU')}</dd>
                  <dt>Авто-таймер</dt>
                  <dd>
                    <span className={`admin-status ${saleSched?.timerActive ? 'admin-status-ok' : 'admin-status-warn'}`}>
                      {saleSched?.timerActive ? `включён (каждые ${saleSched?.intervalHours}ч)` : 'выключен'}
                    </span>
                  </dd>
                  <dt>Последний запуск</dt>
                  <dd>{formatDate(saleSched?.lastRunAt)}</dd>
                  <dt>Результат</dt>
                  <dd>
                    <span className={`admin-status ${saleSched?.lastRunStatus === 'success' ? 'admin-status-ok' : saleSched?.lastRunStatus === 'cancelled' ? 'admin-status-warn' : saleSched?.lastRunStatus ? 'admin-status-err' : ''}`}>
                      {saleSched?.lastRunStatus || 'не запускался'}
                    </span>
                  </dd>
                  <dt>Следующий запуск</dt>
                  <dd>{saleSched?.nextRunAt ? formatDate(saleSched.nextRunAt) : '—'}</dd>
                  <dt>Сейчас работает</dt>
                  <dd>{saleRunning ? 'Да (в процессе)' : 'Нет'}</dd>
                </dl>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>Загрузка...</p>
              )}
            </div>
          </div>

          {/* Live progress + log */}
          {(saleProgress || saleLog.length > 0) && (
            <div className={`admin-card admin-sale-live ${saleRunning ? 'is-running' : ''}`}>
              <div className="admin-card-head">
                <div>
                  <h3>
                    {saleRunning && <span className="admin-sale-pulse" />}
                    {saleRunning ? 'Прогресс сканирования' : 'Последний прогон'}
                  </h3>
                  <p className="admin-card-desc">
                    {SALE_PHASE_LABELS[saleProgress?.phase] || (saleRunning ? 'Идёт сканирование...' : 'Завершено')}
                    {saleProgress?.totalItems != null && ` · игр со скидкой: ${saleProgress.totalItems.toLocaleString('ru-RU')}`}
                  </p>
                </div>
              </div>

              {saleProgress && (
                <>
                  <div className="admin-sale-counters">
                    <div className="admin-sale-counter">
                      <span className="admin-sale-counter-num">{saleProgress.pagesScanned ?? 0}</span>
                      <span className="admin-sale-counter-label">страниц просмотрено</span>
                    </div>
                    <div className="admin-sale-counter">
                      <span className="admin-sale-counter-num accent">{saleProgress.productsFound ?? 0}</span>
                      <span className="admin-sale-counter-label">игр со скидкой найдено</span>
                    </div>
                    <div className="admin-sale-counter">
                      <span className="admin-sale-counter-num ok">{saleProgress.productsUpdated ?? 0}</span>
                      <span className="admin-sale-counter-label">сохранено в базу</span>
                    </div>
                    <div className="admin-sale-counter">
                      <span className="admin-sale-counter-num">{saleProgress.productsDeleted ?? 0}</span>
                      <span className="admin-sale-counter-label">удалено устаревших</span>
                    </div>
                  </div>

                  {(() => {
                    const est = saleProgress.estimatedPages || 0;
                    const determinate = saleRunning && saleProgress.phase === 'scanning' && est > 0;
                    const percent = determinate ? Math.min(100, Math.round((saleProgress.page / est) * 100)) : null;
                    const done = !saleRunning || saleProgress.phase !== 'scanning';
                    return (
                      <div className="admin-index-progress">
                        <div className="admin-index-progress-head">
                          <span>{SALE_PHASE_LABELS[saleProgress.phase] || 'Сканирование'}</span>
                          <span>
                            {saleRunning
                              ? `страница ${saleProgress.page ?? 0}${est ? ` / ~${est}` : ''}${percent !== null ? ` · ${percent}%` : ''}`
                              : `завершено · ${saleProgress.pagesScanned ?? 0} стр.`}
                          </span>
                        </div>
                        <div className="admin-index-progress-bar">
                          <div
                            className={`admin-index-progress-fill ${determinate || done ? '' : 'indeterminate'}`}
                            style={done
                              ? { width: '100%', background: saleProgress.phase === 'error' ? '#f87171' : saleProgress.phase === 'cancelled' ? '#e0a458' : undefined }
                              : (percent !== null ? { width: `${percent}%` } : undefined)}
                          />
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {saleLog.length > 0 && (
                <div className="admin-index-logs">
                  {[...saleLog].reverse().map((entry, i) => (
                    <div className="admin-index-log-row" key={`${entry.ts}-${i}`}>
                      <span className="admin-index-log-time">{formatLogTime(entry.ts)}</span>
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Run history */}
          <div className="admin-card">
            <div className="admin-card-head">
              <h3>История запусков</h3>
              <button className="admin-btn admin-btn-sm" onClick={loadSaleIndexRuns}>⟳ Обновить</button>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Начало</th>
                    <th>Длит.</th>
                    <th>Статус</th>
                    <th>Стр.</th>
                    <th>Найдено</th>
                    <th>Сохр.</th>
                    <th>Удал.</th>
                    <th>Лог</th>
                  </tr>
                </thead>
                <tbody>
                  {saleIndexRuns.map((run) => {
                    const durSec = run.finished_at
                      ? Math.max(0, Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000))
                      : null;
                    const log = Array.isArray(run.log) ? run.log : [];
                    const expanded = expandedRunId === run.id;
                    return (
                      <React.Fragment key={run.id}>
                        <tr>
                          <td className="admin-mono">{run.id}</td>
                          <td>{formatDate(run.started_at)}</td>
                          <td>{durSec != null ? `${durSec}с` : <span style={{ color: 'var(--text-muted)' }}>идёт</span>}</td>
                          <td>
                            <span className={`admin-status ${saleRunStatusClass(run.status)}`}>
                              {saleRunStatusLabel(run.status)}
                            </span>
                          </td>
                          <td>{run.pages_scanned ?? '—'}</td>
                          <td>{run.products_found ?? '—'}</td>
                          <td>{run.products_updated ?? '—'}</td>
                          <td>{run.products_deleted ?? '—'}</td>
                          <td>
                            {(log.length > 0 || run.error) ? (
                              <button
                                className="admin-btn admin-btn-sm"
                                onClick={() => setExpandedRunId(expanded ? null : run.id)}
                              >
                                {expanded ? 'Скрыть' : `Лог (${log.length})`}
                              </button>
                            ) : '—'}
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={9} style={{ background: 'rgba(0,0,0,0.2)', padding: 0 }}>
                              {run.error && (
                                <div className="admin-sale-run-error">Ошибка: {run.error}</div>
                              )}
                              <div className="admin-index-logs" style={{ margin: '0.6rem', maxHeight: 260 }}>
                                {log.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Лог пуст</div>}
                                {[...log].reverse().map((entry, i) => (
                                  <div className="admin-index-log-row" key={`${entry.ts}-${i}`}>
                                    <span className="admin-index-log-time">{formatLogTime(entry.ts)}</span>
                                    <span>{entry.message}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {saleIndexRuns.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                        Запусков ещё не было
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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

      {/* ==================== Purchases ==================== */}
      {tab === 'purchases' && (
        <div className="admin-panel">
          <div className="admin-card">
            <div className="admin-card-head">
              <h2>Покупки</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => { setPurchasesSort('count'); loadPurchases('count'); }}
                  style={{
                    background: purchasesSort === 'count' ? '#fff' : 'rgba(255,255,255,0.08)',
                    color: purchasesSort === 'count' ? '#05080c' : '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    padding: '0.35rem 0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  По популярности
                </button>
                <button
                  onClick={() => { setPurchasesSort('recent'); loadPurchases('recent'); }}
                  style={{
                    background: purchasesSort === 'recent' ? '#fff' : 'rgba(255,255,255,0.08)',
                    color: purchasesSort === 'recent' ? '#05080c' : '#fff',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '8px',
                    padding: '0.35rem 0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Последние
                </button>
              </div>
            </div>

            {purchasesLoading && <p className="admin-loading">Загрузка...</p>}

            {!purchasesLoading && (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      {purchasesSort === 'count' ? (
                        <>
                          <th>#</th>
                          <th>Игра</th>
                          <th>Покупок</th>
                          <th>Последняя</th>
                        </>
                      ) : (
                        <>
                          <th>Дата</th>
                          <th>Игра</th>
                          <th>Покупатель</th>
                          <th>Способ</th>
                          <th>Цена USD</th>
                          <th>Цена RUB</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {purchasesData.purchases.map((p, i) => (
                      purchasesSort === 'count' ? (
                        <tr key={p.product_id}>
                          <td style={{ color: 'var(--text-muted)', width: '2rem' }}>{i + 1}</td>
                          <td>
                            <a
                              href={`/game/${p.product_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              {p.product_title}
                            </a>
                          </td>
                          <td><strong style={{ color: '#8ff0a4' }}>{p.total_count}</strong></td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {formatDate(p.last_purchased_at)}
                          </td>
                        </tr>
                      ) : (
                        <tr key={p.id}>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {formatDate(p.created_at)}
                          </td>
                          <td>
                            <a
                              href={`/game/${p.product_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              {p.product_title}
                            </a>
                          </td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {p.user_email || p.user_name ? (
                              <span title={p.user_email || ''}>{p.user_name || p.user_email}</span>
                            ) : 'Гость'}
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{p.payment_mode}</td>
                          <td style={{ fontSize: '0.85rem' }}>{p.price_usd != null ? `$${p.price_usd}` : '—'}</td>
                          <td style={{ fontSize: '0.85rem' }}>{p.price_rub != null ? `${p.price_rub} ₽` : '—'}</td>
                        </tr>
                      )
                    ))}
                    {purchasesData.purchases.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                          Покупок пока нет
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Всего записей: {purchasesData.total}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

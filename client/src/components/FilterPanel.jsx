import React, { useEffect, useMemo, useState } from 'react';

const SKIP_FILTER_KEYS = ['orderby', 'MaturityRating', 'Accessibility', 'SupportedLanguages'];
// These filters allow only one value at a time (radio behaviour)
const RADIO_FILTER_KEYS = new Set(['Genre', 'Multiplayer', 'IncludedInSubscription', 'Collections']);
const FILTER_ORDER = [
  'Collections',
  'LanguageMode',
  'PlayWith',
  'Price',
  'Genre',
  'Multiplayer',
  'TechnicalFeatures',
  'IncludedInSubscription',
  'HandheldCompatibility',
];
const AUTO_APPLY_DELAY_MS = 250;
const QUERY_APPLY_DELAY_MS = 1000;

// Скидки / Бесплатно / Спецпредложения — shown as quick chips under the search
// bar (PS-style); only one can be active at a time.
const QUICK_CHIPS = [
  { id: 'sale', label: 'Скидки', filterKey: 'Price', value: 'OnSale' },
  { id: 'free', label: 'Бесплатно', filterKey: 'Price', value: 'Free' },
  { id: 'special', label: 'Спецпредложения', filterKey: 'SpecialOffers', value: 'Available' },
];
// These values are surfaced as chips, so we hide them from the dropdown filters.
const HIDDEN_PRICE_CHOICES = new Set(['OnSale', 'Free']);

const FILTER_TITLES = {
  orderby: 'Сортировка',
  Collections: 'Подборки',
  LanguageMode: 'Язык',
  PlayWith: 'Платформы',
  Accessibility: 'Доступность',
  Price: 'Цена',
  Genre: 'Жанр',
  MaturityRating: 'Возрастной рейтинг',
  Multiplayer: 'Мультиплеер',
  TechnicalFeatures: 'Технические характеристики',
  SupportedLanguages: 'Поддерживаемые языки',
  IncludedInSubscription: 'Подписки',
  HandheldCompatibility: 'Совместимость с Handheld',
  SpecialOffers: 'Спецпредложения',
};

const SORT_TITLES = {
  DO_NOT_FILTER: 'По релевантности',
  'ReleaseDate desc': 'Дата выхода: сначала новые',
  'MostPopular desc': 'Самые популярные',
  'Price asc': 'Цена: по возрастанию',
  'Price desc': 'Цена: по убыванию',
  'WishlistCountTotal desc': 'Больше всего в списке желаний',
  'DiscountPercentage desc': 'Скидка: сначала больше',
  'Title Asc': 'Название: А-Я',
  'Title Desc': 'Название: Я-А',
};

const PRICE_TITLES = {
  OnSale: 'Со скидкой',
  Free: 'Бесплатно',
  '<$5': 'До $5',
  '$5-$10': '$5 – $10',
  '$10-$20': '$10 – $20',
  '$20-$40': '$20 – $40',
  '$40-$60': '$40 – $60',
  '$60+': 'Свыше $60',
};

const MATURITY_TITLES = {
  'ESRB:EC': 'Early Childhood',
  'ESRB:E': 'Everyone',
  'ESRB:E10': 'Everyone 10+',
  'ESRB:T': 'Teen',
  'ESRB:M': 'Mature 17+',
  'ESRB:AO': 'Adults Only 18+',
  'ESRB:RPEveryone': 'Rating Pending',
  'ESRB:RPMature': 'Rating Pending: вероятно Mature 17+',
  'ESRB:RPTeen': 'Rating Pending: вероятно Teen 13+',
  'ESRB:UR': 'Без рейтинга',
};

const GENRE_TITLES = {
  'Action & adventure': 'Экшен и приключения',
  'Card & board': 'Карточные и настольные',
  Casino: 'Казино',
  Classics: 'Классика',
  Companion: 'Компаньон',
  Educational: 'Обучающие',
  'Family & kids': 'Семейные и детские',
  Fighting: 'Файтинги',
  'Multi-Player Online Battle Arena': 'MOBA',
  Music: 'Музыка',
  Other: 'Другое',
  Platformer: 'Платформеры',
  'Puzzle & trivia': 'Головоломки и викторины',
  'Racing & flying': 'Гонки и полеты',
  'Role playing': 'Ролевые',
  Shooter: 'Шутеры',
  Simulation: 'Симуляторы',
  Sports: 'Спорт',
  Strategy: 'Стратегии',
  Tools: 'Инструменты',
  Word: 'Слова',
};

const MULTIPLAYER_TITLES = {
  CrossPlatformMultiplayer: 'Кроссплатформенный мультиплеер',
  CrossPlatformCoop: 'Кроссплатформенный кооператив',
  SinglePlayer: 'Один игрок',
  OnlineMultiplayerWithGold: 'Онлайн-мультиплеер',
  CoopSupportOnline: 'Онлайн-кооператив',
  CoopSupportLocal: 'Локальный кооператив',
  LocalMultiplayer: 'Локальный мультиплеер',
};

const CUSTOM_FILTERS = {
  LanguageMode: {
    id: 'LanguageMode',
    title: 'Язык',
    isMultiSelect: true,
    choices: [
      { id: 'full_ru', title: 'Полностью на русском', isLabelOnly: false },
      { id: 'ru_subtitles', title: 'Русские субтитры', isLabelOnly: false },
    ],
  },
};

function formatRubShort(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric.toLocaleString('ru-RU');
}

// Convert a USD price-bucket id to a rubles label using the best-rate boundaries.
function getPriceRubLabel(choiceId, boundaries) {
  if (!boundaries) return null;
  const r = (usd) => formatRubShort(boundaries[usd]);
  switch (choiceId) {
    case '<$5': return r(5) ? `До ${r(5)} ₽` : null;
    case '$5-$10': return r(5) && r(10) ? `${r(5)} – ${r(10)} ₽` : null;
    case '$10-$20': return r(10) && r(20) ? `${r(10)} – ${r(20)} ₽` : null;
    case '$20-$40': return r(20) && r(40) ? `${r(20)} – ${r(40)} ₽` : null;
    case '$40-$60': return r(40) && r(60) ? `${r(40)} – ${r(60)} ₽` : null;
    case '$60+': return r(60) ? `От ${r(60)} ₽` : null;
    default: return null;
  }
}

function cloneFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function countActiveFilters(filters) {
  return Object.values(filters || {}).reduce(
    (sum, values) => sum + (Array.isArray(values) ? values.length : 0),
    0,
  );
}

function serializeFilterState(filters, sort) {
  const normalizedFilters = {};

  Object.keys(filters || {})
    .sort()
    .forEach((key) => {
      const values = filters[key];
      if (Array.isArray(values) && values.length > 0) {
        normalizedFilters[key] = [...values].sort();
      }
    });

  return JSON.stringify({
    filters: normalizedFilters,
    sort: sort || '',
  });
}

function getFilterTitle(key, fallback) {
  return FILTER_TITLES[key] || fallback || key;
}

function getChoiceTitle(key, choice) {
  if (!choice) return '';
  if (key === 'orderby') return SORT_TITLES[choice.id] || choice.title;
  if (key === 'Price') return PRICE_TITLES[choice.id] || choice.title;
  if (key === 'Genre') return GENRE_TITLES[choice.id] || choice.title;
  if (key === 'MaturityRating') return MATURITY_TITLES[choice.id] || choice.title;
  if (key === 'Multiplayer') return MULTIPLAYER_TITLES[choice.id] || choice.title;
  return choice.title;
}

export default function FilterPanel({
  filters,
  activeFilters,
  onApply,
  onClear,
  query,
  onQueryChange,
  sort,
  sortFilter,
  total,
  isOpen,
  onToggle,
  priceRubBoundaries,
  collections,
}) {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const expanded = isOpen !== undefined ? isOpen : internalExpanded;

  function handleToggle() {
    if (onToggle) {
      onToggle((v) => !v);
    } else {
      setInternalExpanded((v) => !v);
    }
  }

  const [draftFilters, setDraftFilters] = useState(() => cloneFilters(activeFilters));
  const [draftSort, setDraftSort] = useState(sort || '');
  const [draftQuery, setDraftQuery] = useState(query || '');

  useEffect(() => {
    setDraftFilters(cloneFilters(activeFilters));
  }, [activeFilters]);

  useEffect(() => {
    setDraftSort(sort || '');
  }, [sort]);

  useEffect(() => {
    setDraftQuery(query || '');
  }, [query]);

  useEffect(() => {
    if ((draftQuery || '') === (query || '')) return undefined;

    const timer = setTimeout(() => {
      onQueryChange(draftQuery);
    }, QUERY_APPLY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [draftQuery, onQueryChange, query]);

  useEffect(() => {
    const activeState = serializeFilterState(activeFilters, sort);
    const draftState = serializeFilterState(draftFilters, draftSort);

    if (activeState === draftState) return undefined;

    const timer = setTimeout(() => {
      onApply({
        filters: draftFilters,
        sort: draftSort,
      });
    }, AUTO_APPLY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [activeFilters, draftFilters, draftSort, onApply, sort]);

  // Custom (non-Xbox-API) filters: language + admin-curated collections. The
  // collections facet is built from the list loaded by the parent page.
  const customFilters = useMemo(() => {
    const result = { ...CUSTOM_FILTERS };
    if (Array.isArray(collections) && collections.length > 0) {
      result.Collections = {
        id: 'Collections',
        title: 'Подборки',
        isMultiSelect: false,
        choices: collections.map((c) => ({ id: c.slug, title: c.title, isLabelOnly: false })),
      };
    }
    return result;
  }, [collections]);

  const filterKeys = useMemo(() => {
    const availableFilters = {
      ...(filters || {}),
      ...customFilters,
    };

    const visibleKeys = Object.keys(availableFilters).filter((key) => {
      const filter = availableFilters[key];
      return !SKIP_FILTER_KEYS.includes(key) && filter?.choices?.some((choice) => !choice.isLabelOnly);
    });

    return [
      ...FILTER_ORDER.filter((key) => visibleKeys.includes(key)),
      ...visibleKeys.filter((key) => !FILTER_ORDER.includes(key)),
    ];
  }, [filters, customFilters]);

  const activeCount = countActiveFilters(activeFilters);

  const updateDraftFilter = (key, valueId) => {
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      const current = next[key] || [];

      if (RADIO_FILTER_KEYS.has(key)) {
        // Single-select: toggle off if already selected, otherwise replace
        if (current.includes(valueId)) {
          delete next[key];
        } else {
          next[key] = [valueId];
        }
      } else if (current.includes(valueId)) {
        const filtered = current.filter((value) => value !== valueId);
        if (filtered.length === 0) {
          delete next[key];
        } else {
          next[key] = filtered;
        }
      } else {
        next[key] = [...current, valueId];
      }

      return next;
    });
  };

  const closePanel = () => {
    if (onToggle) {
      onToggle(false);
    } else {
      setInternalExpanded(false);
    }
  };

  const applyFilters = () => {
    onApply({
      filters: draftFilters,
      sort: draftSort,
    });
    closePanel();
  };

  const resetFilters = () => {
    // Note: do NOT reset draftSort to '' here — the canonical default sort is
    // resolved from the URL after onClear(); forcing '' caused an apply loop.
    setDraftFilters({});
    setDraftQuery('');
    onClear();
    closePanel();
  };

  const isChipActive = (chip) => (draftFilters[chip.filterKey] || []).includes(chip.value);

  const toggleChip = (chip) => {
    const wasActive = isChipActive(chip);
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      // Only one quick chip can be active at a time — clear all chip values first.
      for (const item of QUICK_CHIPS) {
        const remaining = (next[item.filterKey] || []).filter((value) => value !== item.value);
        if (remaining.length > 0) next[item.filterKey] = remaining;
        else delete next[item.filterKey];
      }
      // Clear sale end-date when deactivating or switching away from Скидки
      delete next.SaleEndBefore;
      if (!wasActive) {
        next[chip.filterKey] = [...(next[chip.filterKey] || []), chip.value];
      }
      return next;
    });
  };

  const saleChipActive = isChipActive(QUICK_CHIPS[0]); // 'sale' chip

  const saleEndDate = (draftFilters.SaleEndBefore || [])[0] || '';

  const setSaleEndDate = (value) => {
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      if (value) {
        next.SaleEndBefore = [value];
      } else {
        delete next.SaleEndBefore;
      }
      return next;
    });
  };

  const choiceTitle = (key, choice) => {
    if (key === 'Price') {
      const rubLabel = getPriceRubLabel(choice.id, priceRubBoundaries);
      if (rubLabel) return rubLabel;
    }
    return getChoiceTitle(key, choice);
  };

  const getDropdownChoices = (key, filter) => (
    key === 'Price'
      ? filter.choices.filter((choice) => !HIDDEN_PRICE_CHOICES.has(choice.id))
      : filter.choices
  );

  return (
    <section className={`filter-panel ${expanded ? 'filter-panel-open' : ''}`}>
      <div className="filter-top-row">
        <div className="filter-search-wrap filter-search-desktop-only">
          <svg className="filter-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Поиск игр и подписок..."
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            autoFocus
          />
          {draftQuery && (
            <button
              className="filter-search-clear"
              onClick={() => {
                setDraftQuery('');
                onQueryChange('');
              }}
              aria-label="Очистить поиск"
            >
              &times;
            </button>
          )}
        </div>

        {sortFilter?.choices?.length > 0 && (
          <label className="filter-field filter-sort-dropdown">
            <span className="filter-field-label">{getFilterTitle('orderby', sortFilter.title)}</span>
            <select
              value={draftSort}
              onChange={(event) => setDraftSort(event.target.value)}
              aria-label={getFilterTitle('orderby', sortFilter.title)}
            >
              <option value="">По релевантности</option>
              {sortFilter.choices
                .filter((choice) => choice.id !== sortFilter.allChoiceId)
                .map((choice) => (
                  <option key={choice.id} value={choice.id === sortFilter.allChoiceId ? '' : choice.id}>
                    {getChoiceTitle('orderby', choice)}
                  </option>
                ))}
            </select>
          </label>
        )}

        <button
          className="filter-toggle-btn"
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="18" x2="20" y2="18" />
            <circle cx="9" cy="6" r="2" />
            <circle cx="15" cy="18" r="2" />
          </svg>
          Фильтр
          {activeCount > 0 && <span>{activeCount}</span>}
        </button>
      </div>

      {expanded && (
        <div className="filter-expanded">
          <div className="filter-quick-row">
            <div className="filter-quick-chips">
              {QUICK_CHIPS.map((chip) => (
                <label
                  key={chip.id}
                  className={`filter-toggle-check ${isChipActive(chip) ? 'active' : ''}`}
                >
                  <span>{chip.label}</span>
                  <input
                    type="checkbox"
                    checked={isChipActive(chip)}
                    onChange={() => toggleChip(chip)}
                  />
                </label>
              ))}
            </div>

            <div className="filter-count-pill">
              <strong>{Number(total || 0).toLocaleString('ru-RU')}</strong> товаров
            </div>
          </div>

          {saleChipActive && (
            <div className="filter-sale-date-row">
              <label className="filter-sale-date-label">
                Скидка действует до
                <input
                  type="date"
                  className="filter-sale-date-input"
                  value={saleEndDate}
                  onChange={(e) => setSaleEndDate(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </label>
              {saleEndDate && (
                <button
                  type="button"
                  className="filter-sale-date-clear"
                  onClick={() => setSaleEndDate('')}
                  aria-label="Сбросить дату"
                >
                  &times;
                </button>
              )}
            </div>
          )}

          <div className="filter-grid">
            {filterKeys.map((key) => {
              const filter = filters?.[key] || customFilters[key];
              if (!filter) return null;

              const choices = getDropdownChoices(key, filter);
              if (!choices.some((choice) => !choice.isLabelOnly)) return null;

              return (
                <FilterDropdown
                  key={key}
                  title={getFilterTitle(key, filter.title)}
                  choices={choices}
                  activeValues={draftFilters[key] || []}
                  getTitle={(choice) => choiceTitle(key, choice)}
                  onToggle={(valueId) => updateDraftFilter(key, valueId)}
                  isRadio={RADIO_FILTER_KEYS.has(key)}
                />
              );
            })}
            <div className="filter-actions">
              <button className="filter-reset-btn" type="button" onClick={resetFilters}>
                Сбросить
              </button>
              <button className="filter-apply-btn" type="button" onClick={applyFilters}>
                Применить
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FilterDropdown({ title, choices, activeValues, getTitle, onToggle, isRadio = false }) {
  const selectedChoices = choices.filter((choice) => activeValues.includes(choice.id));
  const selectedLabel = selectedChoices.length > 0
    ? selectedChoices.slice(0, 2).map((choice) => getTitle(choice)).join(', ')
    : title;

  // Stable group name for radio inputs (not for accessibility, just for DOM grouping)
  const groupName = `filter-radio-${title}`;

  return (
    <details className="filter-dropdown">
      <summary>
        <span>{selectedLabel}</span>
      </summary>
      <div className="filter-dropdown-menu">
        {choices.map((choice) => {
          if (choice.isLabelOnly) {
            return (
              <span key={choice.id} className="filter-label-only">
                {getTitle(choice)}
              </span>
            );
          }

          const isActive = activeValues.includes(choice.id);

          if (isRadio) {
            return (
              <label key={choice.id} className={`filter-checkbox filter-radio-item ${isActive ? 'active' : ''}`}>
                <input
                  type="radio"
                  name={groupName}
                  checked={isActive}
                  onChange={() => onToggle(choice.id)}
                  onClick={() => { if (isActive) onToggle(choice.id); }}
                />
                <span className="filter-checkbox-label">{getTitle(choice)}</span>
              </label>
            );
          }

          return (
            <label key={choice.id} className={`filter-checkbox ${isActive ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => onToggle(choice.id)}
              />
              <span className="filter-checkbox-label">{getTitle(choice)}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

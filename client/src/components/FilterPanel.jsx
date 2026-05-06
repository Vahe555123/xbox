import React, { useEffect, useMemo, useState } from 'react';

const SKIP_FILTER_KEYS = ['orderby'];
const FILTER_ORDER = [
  'PlayWith',
  'Accessibility',
  'Price',
  'Genre',
  'MaturityRating',
  'Multiplayer',
  'TechnicalFeatures',
  'SupportedLanguages',
  'IncludedInSubscription',
  'HandheldCompatibility',
];
const AUTO_APPLY_DELAY_MS = 250;

const FILTER_TITLES = {
  orderby: 'Сортировка',
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
}) {
  const [expanded, setExpanded] = useState(false);
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
    }, AUTO_APPLY_DELAY_MS);

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

  const filterKeys = useMemo(() => {
    if (!filters) return [];

    const visibleKeys = Object.keys(filters).filter((key) => {
      const filter = filters[key];
      return !SKIP_FILTER_KEYS.includes(key) && filter?.choices?.some((choice) => !choice.isLabelOnly);
    });

    return [
      ...FILTER_ORDER.filter((key) => visibleKeys.includes(key)),
      ...visibleKeys.filter((key) => !FILTER_ORDER.includes(key)),
    ];
  }, [filters]);

  const activeCount = countActiveFilters(activeFilters);

  const updateDraftFilter = (key, valueId) => {
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      const current = next[key] || [];

      if (current.includes(valueId)) {
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

  const applyFilters = () => {
    onApply({
      filters: draftFilters,
      sort: draftSort,
    });
    setExpanded(false);
  };

  const resetFilters = () => {
    setDraftFilters({});
    setDraftSort('');
    setDraftQuery('');
    onClear();
  };

  return (
    <section className={`filter-panel ${expanded ? 'filter-panel-open' : ''}`}>
      <div className="filter-top-row">
        <div className="filter-search-wrap">
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

        <div className="filter-count-pill">
          <strong>{Number(total || 0).toLocaleString('ru-RU')}</strong> товаров
        </div>

        <button
          className="filter-toggle-btn"
          type="button"
          onClick={() => setExpanded((value) => !value)}
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
          <div className="filter-grid">
            {filterKeys.map((key) => {
              const filter = filters[key];
              if (!filter) return null;

              return (
                <FilterDropdown
                  key={key}
                  title={getFilterTitle(key, filter.title)}
                  choices={filter.choices}
                  activeValues={draftFilters[key] || []}
                  getTitle={(choice) => getChoiceTitle(key, choice)}
                  onToggle={(valueId) => updateDraftFilter(key, valueId)}
                />
              );
            })}
          </div>

          <div className="filter-actions">
            <span className="filter-auto-hint">Применяется автоматически</span>
            <button className="filter-reset-btn" type="button" onClick={resetFilters}>
              Сбросить
            </button>
            <button className="filter-apply-btn" type="button" onClick={applyFilters}>
              Применить
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function FilterDropdown({ title, choices, activeValues, getTitle, onToggle }) {
  const selectedChoices = choices.filter((choice) => activeValues.includes(choice.id));
  const selectedLabel = selectedChoices.length > 0
    ? selectedChoices.slice(0, 2).map((choice) => getTitle(choice)).join(', ')
    : title;

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

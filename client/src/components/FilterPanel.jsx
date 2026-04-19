import React, { useEffect, useMemo, useState } from 'react';

const SKIP_FILTER_KEYS = ['orderby', 'Price', 'MaturityRating', 'Accessibility', 'SupportedLanguages'];
const SINGLE_SELECT_KEYS = new Set(['Genre', 'Multiplayer', 'IncludedInSubscription']);
const EMPTY_PRICE_RANGE = { min: '', max: '', currency: 'USD' };
const AUTO_APPLY_DELAY_MS = 2000;

const FILTER_TITLES = {
  orderby: 'Сортировка',
  PlayWith: 'Все платформы',
  Genre: 'Все жанры игры',
  Multiplayer: 'Количество игроков',
  TechnicalFeatures: 'Технические фишки',
  IncludedInSubscription: 'Подписки',
  HandheldCompatibility: 'Поддержка Handheld',
};

const SORT_TITLES = {
  DO_NOT_FILTER: 'По умолчанию',
  'ReleaseDate desc': 'Дата выхода: сначала новые',
  'MostPopular desc': 'Самые популярные',
  'Price asc': 'Цена: по возрастанию',
  'Price desc': 'Цена: по убыванию',
  'WishlistCountTotal desc': 'Чаще добавляют в список желаний',
  'DiscountPercentage desc': 'Скидка: сначала больше',
  'Title Asc': 'Название: А-Я',
  'Title Desc': 'Название: Я-А',
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

const LANGUAGE_CHOICES = [
  { id: '', title: 'Любой язык' },
  { id: 'full_ru', title: 'Полностью на русском' },
  { id: 'ru_subtitles', title: 'Русские субтитры' },
  { id: 'no_ru', title: 'Без русского' },
];

function cloneFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function normalizePriceRange(priceRange) {
  return {
    min: priceRange?.min ?? '',
    max: priceRange?.max ?? '',
    currency: priceRange?.currency || 'USD',
  };
}

function countActiveFilters(filters, priceRange) {
  const selectedCount = Object.values(filters || {}).reduce(
    (sum, values) => sum + (Array.isArray(values) ? values.length : 0),
    0,
  );
  const hasPrice = Boolean(priceRange?.min || priceRange?.max);
  return selectedCount + (hasPrice ? 1 : 0);
}

function serializeFilterState(filters, sort, priceRange) {
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
    priceRange: normalizePriceRange(priceRange),
  });
}

function getFilterTitle(key, fallback) {
  return FILTER_TITLES[key] || fallback || key;
}

function getChoiceTitle(key, choice) {
  if (!choice) return '';
  if (key === 'orderby') return SORT_TITLES[choice.id] || choice.title;
  if (key === 'Genre') return GENRE_TITLES[choice.id] || choice.title;
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
  priceRange,
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftFilters, setDraftFilters] = useState(() => cloneFilters(activeFilters));
  const [draftSort, setDraftSort] = useState(sort || '');
  const [draftPriceRange, setDraftPriceRange] = useState(() => normalizePriceRange(priceRange));
  const [draftQuery, setDraftQuery] = useState(query || '');

  useEffect(() => {
    setDraftFilters(cloneFilters(activeFilters));
  }, [activeFilters]);

  useEffect(() => {
    setDraftSort(sort || '');
  }, [sort]);

  useEffect(() => {
    setDraftPriceRange(normalizePriceRange(priceRange));
  }, [priceRange]);

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
    const activeState = serializeFilterState(activeFilters, sort, priceRange);
    const draftState = serializeFilterState(draftFilters, draftSort, draftPriceRange);

    if (activeState === draftState) return undefined;

    const timer = setTimeout(() => {
      onApply({
        filters: draftFilters,
        sort: draftSort,
        priceRange: draftPriceRange,
      });
    }, AUTO_APPLY_DELAY_MS);

    return () => clearTimeout(timer);
  }, [activeFilters, draftFilters, draftPriceRange, draftSort, onApply, priceRange, sort]);

  const filterKeys = useMemo(() => {
    if (!filters) return [];
    return Object.keys(filters).filter((key) => {
      const filter = filters[key];
      return !SKIP_FILTER_KEYS.includes(key) && filter?.choices?.some((choice) => !choice.isLabelOnly);
    });
  }, [filters]);

  const activeCount = countActiveFilters(activeFilters, priceRange);

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

  const updateDraftSingleFilter = (key, valueId) => {
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      if (!valueId) {
        delete next[key];
      } else {
        next[key] = [valueId];
      }
      return next;
    });
  };

  const updateDraftBooleanFilter = (key, checked) => {
    setDraftFilters((prev) => {
      const next = cloneFilters(prev);
      if (checked) {
        next[key] = ['true'];
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const updateDraftPrice = (key, value) => {
    setDraftPriceRange((prev) => ({
      ...prev,
      [key]: value.replace(',', '.'),
    }));
  };

  const applyFilters = () => {
    onApply({
      filters: draftFilters,
      sort: draftSort,
      priceRange: draftPriceRange,
    });
    setExpanded(false);
  };

  const resetFilters = () => {
    setDraftFilters({});
    setDraftSort('');
    setDraftPriceRange(EMPTY_PRICE_RANGE);
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
            <button className="filter-search-clear" onClick={() => setDraftQuery('')} aria-label="Очистить поиск">
              &times;
            </button>
          )}
        </div>

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
          <div className="filter-quick-row">
            <label className={`filter-toggle-check ${draftFilters.DealsOnly?.length ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(draftFilters.DealsOnly?.length)}
                onChange={(event) => updateDraftBooleanFilter('DealsOnly', event.target.checked)}
              />
              <span>Только со скидкой</span>
            </label>
            <label className={`filter-toggle-check ${draftFilters.FreeOnly?.length ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(draftFilters.FreeOnly?.length)}
                onChange={(event) => updateDraftBooleanFilter('FreeOnly', event.target.checked)}
              />
              <span>Бесплатные игры</span>
            </label>
          </div>

          <div className="filter-grid">
            {sortFilter?.choices?.length > 0 && (
              <label className="filter-field">
                <span className="filter-field-label">{getFilterTitle('orderby', sortFilter.title)}</span>
                <select
                  value={draftSort}
                  onChange={(event) => setDraftSort(event.target.value)}
                  aria-label={getFilterTitle('orderby', sortFilter.title)}
                >
                  <option value="">По умолчанию</option>
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

            {filterKeys.map((key) => {
              const filter = filters[key];
              if (SINGLE_SELECT_KEYS.has(key)) {
                return (
                  <FilterSelect
                    key={key}
                    title={getFilterTitle(key, filter.title)}
                    choices={filter.choices}
                    activeValue={draftFilters[key]?.[0] || ''}
                    getTitle={(choice) => getChoiceTitle(key, choice)}
                    onChange={(valueId) => updateDraftSingleFilter(key, valueId)}
                  />
                );
              }
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

            <label className="filter-field">
              <span className="filter-field-label">Мин. цена</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Мин. цена"
                value={draftPriceRange.min}
                onChange={(event) => updateDraftPrice('min', event.target.value)}
              />
            </label>

            <label className="filter-field">
              <span className="filter-field-label">Макс. цена</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Макс. цена"
                value={draftPriceRange.max}
                onChange={(event) => updateDraftPrice('max', event.target.value)}
              />
            </label>

            <label className="filter-field">
              <span className="filter-field-label">Валюта</span>
              <select
                value={draftPriceRange.currency}
                onChange={(event) => setDraftPriceRange((prev) => ({ ...prev, currency: event.target.value }))}
                aria-label="Валюта цены"
              >
                <option value="USD">Доллары</option>
                <option value="RUB">Рубли</option>
              </select>
            </label>

            <label className="filter-field">
              <span className="filter-field-label">Язык игры</span>
              <select
                value={draftFilters.LanguageMode?.[0] || ''}
                onChange={(event) => updateDraftSingleFilter('LanguageMode', event.target.value)}
                aria-label="Язык игры"
              >
                {LANGUAGE_CHOICES.map((choice) => (
                  <option key={choice.id || 'all'} value={choice.id}>{choice.title}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="filter-actions">
            <span className="filter-auto-hint">Применится автоматически через 2 секунды</span>
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

function FilterSelect({ title, choices, activeValue, getTitle, onChange }) {
  return (
    <label className="filter-field">
      <span className="filter-field-label">{title}</span>
      <select value={activeValue} onChange={(event) => onChange(event.target.value)} aria-label={title}>
        <option value="">{title}</option>
        {choices.filter((choice) => !choice.isLabelOnly).map((choice) => (
          <option key={choice.id} value={choice.id}>{getTitle(choice)}</option>
        ))}
      </select>
    </label>
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

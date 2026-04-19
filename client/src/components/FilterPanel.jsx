import React, { useEffect, useMemo, useState } from 'react';

const SKIP_FILTER_KEYS = ['orderby'];
const EMPTY_PRICE_RANGE = { min: '', max: '' };
const AUTO_APPLY_DELAY_MS = 2000;

function cloneFilters(filters) {
  return Object.fromEntries(
    Object.entries(filters || {}).map(([key, values]) => [key, Array.isArray(values) ? [...values] : []]),
  );
}

function normalizePriceRange(priceRange) {
  return {
    min: priceRange?.min ?? '',
    max: priceRange?.max ?? '',
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
          <div className="filter-grid">
            {sortFilter?.choices?.length > 0 && (
              <label className="filter-field">
                <span className="filter-field-label">{sortFilter.title || 'Сортировка'}</span>
                <select
                  value={draftSort}
                  onChange={(event) => setDraftSort(event.target.value)}
                  aria-label={sortFilter.title || 'Сортировка'}
                >
                  <option value="">По умолчанию</option>
                  {sortFilter.choices
                    .filter((choice) => choice.id !== sortFilter.allChoiceId)
                    .map((choice) => (
                    <option key={choice.id} value={choice.id === sortFilter.allChoiceId ? '' : choice.id}>
                      {choice.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {filterKeys.map((key) => {
              const filter = filters[key];
              return (
                <FilterDropdown
                  key={key}
                  title={filter.title || key}
                  choices={filter.choices}
                  activeValues={draftFilters[key] || []}
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

function FilterDropdown({ title, choices, activeValues, onToggle }) {
  const selectedChoices = choices.filter((choice) => activeValues.includes(choice.id));
  const selectedLabel = selectedChoices.length > 0
    ? selectedChoices.slice(0, 2).map((choice) => choice.title).join(', ')
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
                {choice.title}
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
              <span className="filter-checkbox-label">{choice.title}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

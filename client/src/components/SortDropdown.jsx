import React from 'react';

export default function SortDropdown({ sortFilter, value, onChange }) {
  if (!sortFilter?.choices?.length) return null;

  return (
    <div className="sort-dropdown">
      <label htmlFor="sort-select">{sortFilter.title || 'Sort by'}</label>
      <select
        id="sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {sortFilter.choices.map((opt) => (
          <option key={opt.id} value={opt.id === sortFilter.allChoiceId ? '' : opt.id}>
            {opt.title}
          </option>
        ))}
      </select>
    </div>
  );
}

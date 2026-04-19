import React from 'react';

export default function SearchBar({ value, onChange }) {
  return (
    <div className="search-bar">
      <div className="search-input-wrap">
        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search Xbox games..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
        {value && (
          <button className="clear-btn" onClick={() => onChange('')} aria-label="Clear search">
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

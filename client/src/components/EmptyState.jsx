import React from 'react';

export default function EmptyState({ query }) {
  if (query) {
    return (
      <div className="empty-state">
        <div className="empty-icon">&#128269;</div>
        <h2>No results found</h2>
        <p>
          No games matched <strong>"{query}"</strong>. Try a different search.
        </p>
      </div>
    );
  }

  return (
    <div className="empty-state">
      <div className="empty-icon">&#127918;</div>
      <h2>No games found</h2>
      <p>Try adjusting your filters or search terms.</p>
    </div>
  );
}

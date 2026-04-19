import React from 'react';

export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="error-state">
      <div className="error-icon">⚠</div>
      <h2>Something went wrong</h2>
      <p>{message}</p>
      {onRetry && (
        <button className="btn-retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

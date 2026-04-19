import React from 'react';

export default function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        &larr; Previous
      </button>

      <span className="pagination-info">
        Page {page} of {totalPages}
      </span>

      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next &rarr;
      </button>
    </div>
  );
}

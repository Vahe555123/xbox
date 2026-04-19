/**
 * Truncate text to a max length with ellipsis.
 */
export function truncate(text, max = 120) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * Build a small image URL by appending resize params.
 * Microsoft store images support query-string resizing.
 */
export function resizeImage(url, width = 300, height = 300) {
  if (!url) return null;
  const base = url.includes('?') ? url : `${url}?w=${width}&h=${height}`;
  return base;
}

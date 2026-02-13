/**
 * Format date as YYYY-MM-DD or null.
 * Consolidates formatDateForSummary / formatDateForDisplay from documents.js and chainOfTitle.js.
 */
export function formatDate(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Truncate text to limit characters, appending ellipsis if truncated.
 */
export function truncateText(text, limit = 2000) {
  if (!text) return '';
  const str = String(text).trim();
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}…`;
}

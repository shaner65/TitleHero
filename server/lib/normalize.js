/**
 * Normalize: '' -> null, trim strings.
 */
export function nn(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  return v;
}

/**
 * Parse value as decimal, stripping $ and ,. Returns null if invalid.
 */
export function toDecimalOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

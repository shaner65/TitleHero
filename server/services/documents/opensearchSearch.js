import { createOpenSearchClient } from '../../config.js';
import { OPENSEARCH_INDEX_DOCUMENTS, criteriaMultiMatchFields } from './opensearchConstants.js';
import { validateDateModeFields } from './search.js';

const TEXT_LIKE = new Set([
  'instrumentNumber', 'book', 'volume', 'page', 'instrumentType',
  'remarks', 'legalDescription', 'subBlock', 'abstractText',
  'marketShare', 'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes',
  'abstractCode', 'countyName',
]);
const NUMERIC_EQ = new Set([
  'documentID', 'bookTypeID', 'subdivisionID', 'exportFlag', 'GFNNumber',
]);
const DATE_EQ = new Set(['instrumentDate', 'filingDate', 'created_at', 'updated_at']);

const DATE_MODE_FIELDS = ['filingDate', 'instrumentDate'];

function shouldSkipParamKey(k) {
  if (['criteria', 'limit', 'offset', 'updatedSince', 'engine'].includes(k)) return true;
  if (k.endsWith('Mode') || k.endsWith('From') || k.endsWith('To')) return true;
  return false;
}

function parseLimitOffset(query) {
  const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 200);
  const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
  return { limit, offset };
}

/** Day bounds in ISO for DATE() = style filter on indexed date fields. */
function dateStringDayRange(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { gte: start.toISOString(), lte: end.toISOString() };
}

/**
 * Map OpenSearch hit to a row shaped like MySQL search rows (plain objects, serializable).
 */
export function mapHitSourceToRow(source) {
  if (!source || typeof source !== 'object') return source;
  const row = { ...source };
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && v !== null && typeof v.toISOString === 'function') {
      row[key] = v.toISOString();
    }
  }
  return row;
}

/**
 * Build OpenSearch request body from the same query object as GET /documents/search.
 */
export function buildOpenSearchRequestBody(query) {
  validateDateModeFields(query);

  const { limit, offset } = parseLimitOffset(query);
  const must = [];
  const filter = [];

  for (const [k, vRaw] of Object.entries(query)) {
    if (shouldSkipParamKey(k)) continue;
    const v = String(vRaw ?? '').trim();
    if (!v) continue;

    if (k === 'grantor') {
      must.push({ match: { 'grantors.ngram': v } });
    } else if (k === 'grantee') {
      must.push({ match: { 'grantees.ngram': v } });
    } else if (NUMERIC_EQ.has(k)) {
      const num = Number.parseInt(v, 10);
      if (!Number.isNaN(num)) {
        filter.push({ term: { [k]: num } });
      }
    } else if (DATE_EQ.has(k)) {
      const range = v.split('..');
      if (range.length === 2 && range[0].trim() && range[1].trim()) {
        filter.push({
          range: {
            [k]: { gte: range[0].trim(), lte: range[1].trim() },
          },
        });
      } else {
        const day = dateStringDayRange(v);
        if (day) {
          filter.push({ range: { [k]: day } });
        }
      }
    } else if (TEXT_LIKE.has(k)) {
      if (k === 'volume' || k === 'page') {
        filter.push({ term: { [`${k}.raw`]: v } });
      } else if (k === 'abstractCode') {
        filter.push({ term: { 'abstractCode.raw': v } });
      } else if (k === 'countyName') {
        must.push({ match: { 'countyName.ngram': v } });
      } else {
        must.push({ match: { [`${k}.ngram`]: v } });
      }
    }
  }

  for (const field of DATE_MODE_FIELDS) {
    const modeRaw = String(query[`${field}Mode`] ?? '').trim();
    if (!modeRaw) continue;
    const mode = modeRaw.toLowerCase();
    const from = String(query[`${field}From`] ?? '').trim();
    const to = String(query[`${field}To`] ?? '').trim();

    if (mode === 'exact') {
      const day = dateStringDayRange(from);
      if (day) filter.push({ range: { [field]: day } });
    } else if (mode === 'after') {
      filter.push({ range: { [field]: { gte: from } } });
    } else if (mode === 'before') {
      filter.push({ range: { [field]: { lte: from } } });
    } else if (mode === 'range') {
      filter.push({ range: { [field]: { gte: from, lte: to } } });
    }
  }

  const criteria = String(query.criteria ?? '').trim();
  if (criteria) {
    must.push({
      multi_match: {
        query: criteria,
        fields: criteriaMultiMatchFields(),
        type: 'best_fields',
        operator: 'or',
      },
    });
  }

  const updatedSince = String(query.updatedSince ?? '').trim();
  if (updatedSince) {
    filter.push({
      bool: {
        should: [
          { range: { created_at: { gt: updatedSince } } },
          { range: { updated_at: { gt: updatedSince } } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  let queryClause;
  if (must.length === 0 && filter.length === 0) {
    queryClause = { match_all: {} };
  } else {
    const bool = {};
    if (must.length) bool.must = must;
    else bool.must = [{ match_all: {} }];
    if (filter.length) bool.filter = filter;
    queryClause = { bool };
  }

  return {
    body: {
      query: queryClause,
      from: offset,
      size: limit,
      track_total_hits: true,
      sort: [
        { updated_at: { order: 'desc', missing: '_last', unmapped_type: 'date' } },
        { created_at: { order: 'desc', missing: '_last', unmapped_type: 'date' } },
      ],
    },
    limit,
    offset,
  };
}

/**
 * Run document search against OpenSearch; returns rows from _source only.
 */
export async function executeOpenSearchDocumentSearch(query, config) {
  const client = createOpenSearchClient(config);
  const { body, limit, offset } = buildOpenSearchRequestBody(query);

  const res = await client.search({
    index: OPENSEARCH_INDEX_DOCUMENTS,
    body: body,
  });

  const rb = res.body ?? res;
  const hitsRoot = rb.hits || {};
  const total =
    typeof hitsRoot.total === 'object' && hitsRoot.total !== null
      ? hitsRoot.total.value
      : hitsRoot.total;

  const rows = (hitsRoot.hits || []).map((h) => mapHitSourceToRow(h._source));

  return { rows, total: total ?? 0, limit, offset };
}

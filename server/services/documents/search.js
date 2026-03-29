import { getSearchBackend } from '../../config.js';
import { CRITERIA_FIELD_ALL, TEXT_FIELDS } from './opensearchConstants.js';

const TEXT_LIKE = new Set([
  'instrumentNumber', 'book', 'volume', 'page', 'instrumentType',
  'remarks', 'legalDescription', 'subBlock', 'abstractText',
  'marketShare', 'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes',
  'abstractCode', 'countyName'
]);
const NUMERIC_EQ = new Set([
  'documentID', 'bookTypeID', 'subdivisionID', 'exportFlag', 'GFNNumber'
]);
const DATE_EQ = new Set(['instrumentDate', 'filingDate', 'created_at', 'updated_at']);

const DATE_MODE_FIELDS = /** @type {const} */ ([
  'filingDate',
  'instrumentDate',
]);

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** When `criteria` is set, `criteriaField` must be absent/`all` or a member of TEXT_FIELDS. */
export function validateCriteriaField(query) {
  const criteria = String(query.criteria ?? '').trim();
  if (!criteria) return;
  const raw = String(query.criteriaField ?? '').trim().toLowerCase();
  if (!raw || raw === CRITERIA_FIELD_ALL) return;
  const field = String(query.criteriaField ?? '').trim();
  if (!TEXT_FIELDS.includes(field)) {
    throw badRequest(`Invalid criteriaField: ${field}`);
  }
}

/** Shared by OpenSearch path — same rules as buildSearchQuery date modes. */
export function validateDateModeFields(query) {
  for (const field of DATE_MODE_FIELDS) {
    const modeRaw = String(query[`${field}Mode`] ?? '').trim();
    if (!modeRaw) continue;

    const mode = modeRaw.toLowerCase();
    const from = String(query[`${field}From`] ?? '').trim();
    const to = String(query[`${field}To`] ?? '').trim();

    if (!from) {
      throw badRequest(`${field}From is required when ${field}Mode is provided`);
    }

    if (mode === 'range' && !to) {
      throw badRequest(`${field}To is required when ${field}Mode=range`);
    }

    if (!['exact', 'after', 'before', 'range'].includes(mode)) {
      throw badRequest(`Invalid ${field}Mode: ${modeRaw}`);
    }
  }
}

/**
 * Build search query from request query params.
 * Returns { where, params, limit, offset, needsCountyJoin }.
 */
export function buildSearchQuery(query) {
  const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 200);
  const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);

  const where = [];
  const params = [];

  for (const [k, vRaw] of Object.entries(query)) {
    if (['criteria', 'criteriaField', 'limit', 'offset', 'updatedSince', 'engine'].includes(k)) continue;
    if (
      k.endsWith('Mode') ||
      k.endsWith('From') ||
      k.endsWith('To')
    ) {
      // handled by explicit date-mode parsing below
      continue;
    }
    const v = String(vRaw ?? '').trim();
    if (!v) continue;

    if (k === 'grantor') {
      where.push(`EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantor' AND pt.name LIKE ?)`);
      params.push(`%${v}%`);
    } else if (k === 'grantee') {
      where.push(`EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantee' AND pt.name LIKE ?)`);
      params.push(`%${v}%`);
    } else if (NUMERIC_EQ.has(k)) {
      where.push(`d.\`${k}\` = ?`);
      params.push(v);
    } else if (DATE_EQ.has(k)) {
      const range = v.split('..');
      if (range.length === 2) {
        where.push(`d.\`${k}\` BETWEEN ? AND ?`);
        params.push(range[0], range[1]);
      } else {
        where.push(`DATE(d.\`${k}\`) = DATE(?)`);
        params.push(v);
      }
    } else if (TEXT_LIKE.has(k)) {
      if (k === 'volume' || k === 'page') {
        where.push(`d.\`${k}\` = ?`);
        params.push(v);
      } else if (k === 'abstractCode') {
        where.push(`d.\`abstractCode\` = ?`);
        params.push(v);
      } else if (k === 'countyName') {
        where.push(`c.\`name\` LIKE ?`);
        params.push(`%${v}%`);
      } else {
        where.push(`d.\`${k}\` LIKE ?`);
        params.push(`%${v}%`);
      }
    }
  }

  validateDateModeFields(query);
  validateCriteriaField(query);

  for (const field of DATE_MODE_FIELDS) {
    const modeRaw = String(query[`${field}Mode`] ?? '').trim();
    if (!modeRaw) continue;

    const mode = modeRaw.toLowerCase();
    const from = String(query[`${field}From`] ?? '').trim();
    const to = String(query[`${field}To`] ?? '').trim();

    if (mode === 'exact') {
      where.push(`DATE(d.\`${field}\`) = DATE(?)`);
      params.push(from);
    } else if (mode === 'after') {
      where.push(`d.\`${field}\` >= ?`);
      params.push(from);
    } else if (mode === 'before') {
      where.push(`d.\`${field}\` <= ?`);
      params.push(from);
    } else if (mode === 'range') {
      where.push(`d.\`${field}\` BETWEEN ? AND ?`);
      params.push(from, to);
    }
  }

  const criteria = String(query.criteria ?? '').trim();
  if (criteria) {
    const scopeRaw = String(query.criteriaField ?? '').trim().toLowerCase();
    const isAll = !scopeRaw || scopeRaw === CRITERIA_FIELD_ALL;

    if (isAll) {
      where.push(`(
        MATCH(
          d.instrumentNumber, d.instrumentType, d.legalDescription, d.remarks, d.address,
          d.CADNumber, d.CADNumber2, d.book, d.volume, d.page, d.abstractText, d.fieldNotes
        ) AGAINST (? IN BOOLEAN MODE)
        OR EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantor' AND pt.name LIKE ?)
        OR EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantee' AND pt.name LIKE ?)
        OR EXISTS (SELECT 1 FROM County c2 WHERE c2.countyID = d.countyID AND c2.name LIKE ?)
      )`);
      const like = `%${criteria}%`;
      params.push(criteria + '*', like, like, like);
    } else {
      const scope = String(query.criteriaField ?? '').trim();
      if (scope === 'grantors') {
        where.push(
          `EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantor' AND pt.name LIKE ?)`
        );
        params.push(`%${criteria}%`);
      } else if (scope === 'grantees') {
        where.push(
          `EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantee' AND pt.name LIKE ?)`
        );
        params.push(`%${criteria}%`);
      } else if (scope === 'countyName') {
        where.push(`EXISTS (SELECT 1 FROM County c2 WHERE c2.countyID = d.countyID AND c2.name LIKE ?)`);
        params.push(`%${criteria}%`);
      } else {
        where.push(`MATCH(d.\`${scope}\`) AGAINST (? IN BOOLEAN MODE)`);
        params.push(criteria + '*');
      }
    }
  }

  // Support updatedSince for incremental saved search updates
  const updatedSince = String(query.updatedSince ?? '').trim();
  if (updatedSince) {
    where.push(`(d.created_at > ? OR d.updated_at > ?)`);
    params.push(updatedSince, updatedSince);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const needsCountyJoin = where.some(w => w.includes(`c.\`name\``));
  const countyJoinClause = needsCountyJoin ? 'LEFT JOIN County c ON c.countyID = d.countyID' : '';

  return { whereClause, countyJoinClause, params, limit, offset };
}

/**
 * Execute document search via MySQL only. Returns { rows, total }.
 */
export async function executeMysqlSearch(pool, query) {
  const { whereClause, countyJoinClause, params, limit, offset } = buildSearchQuery(query);
  const searchParams = [...params, limit, offset];

  const limitedDocsSubquery = `
    SELECT d.documentID
    FROM Document d
    ${countyJoinClause}
    ${whereClause}
    ORDER BY (d.updated_at IS NULL), d.updated_at DESC, (d.created_at IS NULL), d.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const sql = `
    SELECT
      d.*,
      c.name AS countyName,
      GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors,
      GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees
    FROM (${limitedDocsSubquery}) limited
    JOIN Document d ON d.documentID = limited.documentID
    LEFT JOIN County c ON c.countyID = d.countyID
    LEFT JOIN Party p ON p.documentID = d.documentID
    GROUP BY d.documentID
    ORDER BY (d.updated_at IS NULL), d.updated_at DESC, (d.created_at IS NULL), d.created_at DESC
  `;

  const [rows] = await pool.query(sql, searchParams);

  const countParams = params;
  const countSql = `
    SELECT COUNT(DISTINCT d.documentID) as total
    FROM Document d
    ${countyJoinClause}
    ${whereClause}
  `;
  const [countResult] = await pool.query(countSql, countParams);
  const total = countResult[0]?.total || 0;

  return { rows, total };
}

/**
 * Whether to use OpenSearch for this request (Secrets Manager / env SEARCH_BACKEND via getSearchBackend, or query engine=opensearch).
 * Default: mysql when unset.
 */
export async function shouldUseOpenSearch(query) {
  const backend = await getSearchBackend();
  if (backend === 'opensearch') return true;
  if (backend === 'mysql') return false;
  const q = String(query?.engine ?? '').toLowerCase().trim();
  return q === 'opensearch';
}

/**
 * Execute document search: OpenSearch when configured and selected, else MySQL.
 */
export async function executeSearch(pool, query) {
  if (!(await shouldUseOpenSearch(query))) {
    return executeMysqlSearch(pool, query);
  }

  const { getOpenSearchConfig } = await import('../../config.js');
  const { executeOpenSearchDocumentSearch } = await import('./opensearchSearch.js');

  const config = await getOpenSearchConfig();
  if (!config) {
    return executeMysqlSearch(pool, query);
  }

  try {
    return await executeOpenSearchDocumentSearch(query, config);
  } catch (err) {
    if (err?.status === 400) throw err;
    console.error('OpenSearch search failed, falling back to MySQL:', err);
    return executeMysqlSearch(pool, query);
  }
}

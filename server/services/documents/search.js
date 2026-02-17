const TEXT_LIKE = new Set([
  'instrumentNumber', 'book', 'volume', 'page', 'instrumentType',
  'remarks', 'legalDescription', 'subBlock', 'abstractText', 'propertyType',
  'marketShare', 'sortArray', 'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes',
  'finalizedBy', 'nFileReference', 'abstractCode', 'countyName'
]);
const NUMERIC_EQ = new Set([
  'documentID', 'bookTypeID', 'subdivisionID', 'exportFlag', 'GFNNumber'
]);
const DATE_EQ = new Set(['fileStampDate', 'filingDate', 'created_at', 'updated_at']);

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
    if (['criteria', 'limit', 'offset'].includes(k)) continue;
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

  const criteria = String(query.criteria ?? '').trim();
  if (criteria) {
    where.push(`MATCH(
      d.instrumentNumber, d.instrumentType, d.legalDescription, d.remarks, d.address,
      d.CADNumber, d.CADNumber2, d.book, d.volume, d.page, d.abstractText, d.fieldNotes
    ) AGAINST (? IN BOOLEAN MODE)`);
    params.push(criteria + '*');
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const needsCountyJoin = where.some(w => w.includes(`c.\`name\``));
  const countyJoinClause = needsCountyJoin ? 'LEFT JOIN County c ON c.countyID = d.countyID' : '';

  return { whereClause, countyJoinClause, params, limit, offset };
}

/**
 * Execute document search. Returns { rows, total }.
 */
export async function executeSearch(pool, query) {
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

import { getOpenSearchConfig, createOpenSearchClient } from '../../config.js';
import { OPENSEARCH_INDEX_DOCUMENTS, TEXT_FIELDS } from './opensearchConstants.js';

function normalizeText(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function normalizeDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    if (typeof value === 'string' && value.includes('T')) {
      return new Date(value).toISOString();
    }
  } catch {
    // fall through
  }
  return String(value);
}

function normalizeFloat(value) {
  if (value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build index body aligned with python `make_opensearch_doc`, plus PRSERV/clerkNumber when present.
 */
export function makeOpenSearchDocument(row) {
  if (!row || row.documentID == null) return null;

  const doc = {};
  doc.documentID = parseInt(row.documentID, 10);

  if (row.exportFlag != null) doc.exportFlag = parseInt(row.exportFlag, 10);
  if (row.GFNNumber != null) doc.GFNNumber = parseInt(row.GFNNumber, 10);

  for (const intField of ['abstractID', 'bookTypeID', 'subdivisionID', 'countyID']) {
    if (row[intField] != null) doc[intField] = parseInt(row[intField], 10);
  }

  for (const floatField of ['lienAmount', 'acres']) {
    const f = normalizeFloat(row[floatField]);
    if (f != null) doc[floatField] = f;
  }

  for (const dateField of ['instrumentDate', 'filingDate', 'created_at', 'updated_at']) {
    const v = normalizeDate(row[dateField]);
    if (v != null) doc[dateField] = v;
  }

  for (const tf of TEXT_FIELDS) {
    const nv = normalizeText(row[tf]);
    if (nv != null) doc[tf] = nv;
  }

  const extras = [
    'instrumentNumber', 'instrumentType', 'legalDescription', 'remarks', 'subBlock', 'abstractCode',
    'book', 'volume', 'page', 'address', 'abstractText', 'fieldNotes', 'CADNumber', 'CADNumber2',
    'GLOLink', 'marketShare', 'grantors', 'grantees', 'PRSERV', 'clerkNumber',
  ];
  for (const extra of extras) {
    if (doc[extra] != null) continue;
    const nv = normalizeText(row[extra]);
    if (nv != null) doc[extra] = nv;
  }

  return doc;
}

const FETCH_ONE_SQL = `
  SELECT
    d.documentID,
    ANY_VALUE(d.abstractID) AS abstractID,
    ANY_VALUE(d.abstractCode) AS abstractCode,
    ANY_VALUE(d.bookTypeID) AS bookTypeID,
    ANY_VALUE(d.subdivisionID) AS subdivisionID,
    ANY_VALUE(d.countyID) AS countyID,
    ANY_VALUE(d.instrumentNumber) AS instrumentNumber,
    ANY_VALUE(d.book) AS book,
    ANY_VALUE(d.volume) AS volume,
    ANY_VALUE(d.page) AS page,
    ANY_VALUE(d.instrumentType) AS instrumentType,
    ANY_VALUE(d.remarks) AS remarks,
    ANY_VALUE(d.lienAmount) AS lienAmount,
    ANY_VALUE(d.legalDescription) AS legalDescription,
    ANY_VALUE(d.subBlock) AS subBlock,
    ANY_VALUE(d.abstractText) AS abstractText,
    ANY_VALUE(d.acres) AS acres,
    ANY_VALUE(d.instrumentDate) AS instrumentDate,
    ANY_VALUE(d.filingDate) AS filingDate,
    ANY_VALUE(d.exportFlag) AS exportFlag,
    ANY_VALUE(d.GFNNumber) AS GFNNumber,
    ANY_VALUE(d.marketShare) AS marketShare,
    ANY_VALUE(d.address) AS address,
    ANY_VALUE(d.CADNumber) AS CADNumber,
    ANY_VALUE(d.CADNumber2) AS CADNumber2,
    ANY_VALUE(d.GLOLink) AS GLOLink,
    ANY_VALUE(d.fieldNotes) AS fieldNotes,
    ANY_VALUE(d.created_at) AS created_at,
    ANY_VALUE(d.updated_at) AS updated_at,
    ANY_VALUE(d.PRSERV) AS PRSERV,
    ANY_VALUE(d.clerkNumber) AS clerkNumber,
    ANY_VALUE(c.name) AS countyName,
    GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors,
    GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees
  FROM Document d
  LEFT JOIN County c ON c.countyID = d.countyID
  LEFT JOIN Party p ON p.documentID = d.documentID
  WHERE d.documentID = ?
  GROUP BY d.documentID
`;

export async function fetchDocumentRowForOpenSearch(pool, documentID) {
  const [rows] = await pool.query(FETCH_ONE_SQL, [documentID]);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

export async function syncDocumentToOpenSearch(pool, documentID) {
  const config = await getOpenSearchConfig();
  if (!config) return;

  const row = await fetchDocumentRowForOpenSearch(pool, documentID);
  if (!row) return;

  const doc = makeOpenSearchDocument(row);
  if (!doc) return;

  const client = createOpenSearchClient(config);
  await client.index({
    index: OPENSEARCH_INDEX_DOCUMENTS,
    id: String(documentID),
    body: doc,
    refresh: false,
  });
}

export async function deleteDocumentFromOpenSearch(documentID) {
  const config = await getOpenSearchConfig();
  if (!config) return;

  const client = createOpenSearchClient(config);
  try {
    await client.delete({
      index: OPENSEARCH_INDEX_DOCUMENTS,
      id: String(documentID),
      refresh: false,
    });
  } catch (err) {
    if (err?.statusCode === 404) return;
    throw err;
  }
}

export function scheduleSyncDocumentToOpenSearch(pool, documentID) {
  syncDocumentToOpenSearch(pool, documentID).catch((e) =>
    console.error('[OpenSearch] sync failed', documentID, e.message || e)
  );
}

export function scheduleDeleteDocumentFromOpenSearch(documentID) {
  deleteDocumentFromOpenSearch(documentID).catch((e) =>
    console.error('[OpenSearch] delete failed', documentID, e.message || e)
  );
}

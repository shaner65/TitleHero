import { nn } from './normalize.js';

/**
 * Insert party records for a document (Grantor/Grantee).
 * Splits names on ; , / & "and" and inserts each as a row.
 */
export async function insertParties(pool, documentID, role, names) {
  const raw = (names ?? '').trim();
  if (!raw) return;

  const parts = raw
    .split(/(?:\band\b|[;,/&])/gi)
    .map(s => s.trim())
    .filter(Boolean);

  for (const name of parts) {
    await pool.query(
      'INSERT INTO Party (documentID, role, name) VALUES (?,?,?)',
      [documentID, role, name]
    );
  }
}

/**
 * ID tables only (auto-increment PKs). Get or create lookup by name.
 * e.g., BookTypeID, SubdivisionID, CountyID
 */
export async function ensureLookupId(pool, tableName, rawName) {
  const name = nn(rawName);
  if (!name) return null;

  const idCol = `${tableName}ID`;
  const [found] = await pool.query(
    `SELECT \`${idCol}\` AS id FROM \`${tableName}\` WHERE \`name\` = ? LIMIT 1`,
    [name]
  );
  if (found.length) return found[0].id;

  const [ins] = await pool.query(
    `INSERT INTO \`${tableName}\` (\`name\`) VALUES (?)`,
    [name]
  );
  return ins.insertId;
}

/**
 * Abstract uses VARCHAR PK: abstractCode. Do NOT create if code is blank.
 */
export async function ensureAbstract(pool, rawCode, rawName) {
  const code = nn(rawCode);
  const name = nn(rawName);
  if (!code) return null;

  const [found] = await pool.query(
    'SELECT abstractCode AS id FROM Abstract WHERE abstractCode = ? LIMIT 1',
    [code]
  );
  if (found.length) return found[0].id;

  await pool.query(
    'INSERT INTO Abstract (abstractCode, name) VALUES (?, ?)',
    [code, name]
  );
  return code;
}

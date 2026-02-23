import { getPool } from '../../config.js';
import { createFolderMarker } from '../../lib/s3.js';

export async function list() {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT countyID, name, effectiveDate FROM County');
  return rows;
}

export async function getById(countyId) {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT countyID, name, effectiveDate FROM County WHERE countyID = ?', [countyId]);
  return rows[0] ?? null;
}

export async function create(name, effectiveDate = null) {
  const countyName = (name || '').trim();
  if (!countyName) {
    throw Object.assign(new Error('County name is required'), { status: 400 });
  }

  const pool = await getPool();
  const [result] = await pool.query(
    'INSERT INTO County (name, effectiveDate) VALUES (?, ?)',
    [countyName, effectiveDate || null]
  );
  const newCounty = { countyID: result.insertId, name: countyName, effectiveDate: effectiveDate || null };

  try {
    await createFolderMarker(`${countyName}/`);
    console.log(`Created S3 folder for county: ${countyName}`);
  } catch (s3Error) {
    console.error('Error creating S3 folder:', s3Error);
  }

  return newCounty;
}

export async function update(countyId, name, effectiveDate = null) {
  if (!name) {
    throw Object.assign(new Error('County name is required'), { status: 400 });
  }

  const pool = await getPool();
  const [result] = await pool.query(
    'UPDATE County SET name = ?, effectiveDate = ? WHERE countyID = ?',
    [name, effectiveDate || null, countyId]
  );
  if (result.affectedRows === 0) {
    const err = new Error('County not found');
    err.status = 404;
    throw err;
  }

  return { countyID: countyId, name, effectiveDate: effectiveDate || null };
}

export async function remove(countyId) {
  const pool = await getPool();
  const [result] = await pool.query('DELETE FROM County WHERE countyID = ?', [countyId]);
  if (result.affectedRows === 0) {
    const err = new Error('County not found');
    err.status = 404;
    throw err;
  }
}

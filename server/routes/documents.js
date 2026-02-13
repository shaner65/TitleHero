import express from 'express';
import crypto from 'node:crypto';
import { getPool, getS3BucketName, getAIProcessorQueueName, getOpenAPIKey } from '../config.js';
import OpenAI from 'openai';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const s3 = new S3Client({ region: 'us-east-2' });
const sqs = new SQSClient({ region: 'us-east-2' });
const app = express();

/* -------------------------- small helpers -------------------------- */
async function listFilesByPrefixLocal(prefix) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));
  const keys = (out.Contents || []).map(o => o.Key).filter(Boolean);
  // keep numeric order like PR123.1.tif, PR123.2.tif
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return keys;
}

async function getObjectBufferLocal(Key) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
  // Support both Node body helpers
  return out.Body?.transformToByteArray
    ? Buffer.from(await out.Body.transformToByteArray())
    : Buffer.from(await out.Body.arrayBuffer());
}

async function insertParties(pool, documentID, role, names) {
  const raw = (names ?? '').trim();
  if (!raw) return;

  // Split on common separators: ; , / & "and"
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

function formatDateForSummary(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function truncateText(text, limit = 2000) {
  if (!text) return '';
  const str = String(text).trim();
  if (str.length <= limit) return str;
  return `${str.slice(0, limit)}…`;
}

function buildHeuristicSummary(doc) {
  const instrument = doc.instrumentType ? `${doc.instrumentType}` : 'Recorded document';
  const bookRef = [doc.book, doc.volume, doc.page].filter(Boolean).join('/');
  const bookText = bookRef ? `Book/Vol/Page ${bookRef}` : null;
  const filingDate = formatDateForSummary(doc.filingDate);
  const county = doc.countyName ? `${doc.countyName} County` : null;
  const parties = [doc.grantors, doc.grantees].filter(Boolean).join(' → ');
  const legal = truncateText(doc.legalDescription, 240);

  const sentence1Parts = [instrument, bookText, filingDate ? `filed ${filingDate}` : null, county ? `in ${county}` : null]
    .filter(Boolean)
    .join(', ');

  const sentence2Parts = [parties ? `Parties: ${parties}` : null, legal ? `Legal: ${legal}` : null]
    .filter(Boolean)
    .join('. ');

  const sentence1 = sentence1Parts ? `${sentence1Parts}.` : '';
  const sentence2 = sentence2Parts ? `${sentence2Parts}.` : '';

  return [sentence1, sentence2].filter(Boolean).join(' ');
}

async function generateAiSummary(doc) {
  try {
    const apiKey = await getOpenAPIKey();
    if (!apiKey) {
      return { summary: buildHeuristicSummary(doc) || '—', source: 'heuristic' };
    }

    const openai = new OpenAI({ apiKey });

    const lines = [];
    lines.push(`Document ID: ${doc.documentID}`);
    if (doc.instrumentType) lines.push(`Instrument Type: ${doc.instrumentType}`);
    if (doc.instrumentNumber) lines.push(`Instrument Number: ${doc.instrumentNumber}`);
    const bookRef = [doc.book, doc.volume, doc.page].filter(Boolean).join('/');
    if (bookRef) lines.push(`Book/Volume/Page: ${bookRef}`);
    if (doc.filingDate) lines.push(`Filing Date: ${formatDateForSummary(doc.filingDate)}`);
    if (doc.fileStampDate) lines.push(`File Stamp Date: ${formatDateForSummary(doc.fileStampDate)}`);
    if (doc.countyName) lines.push(`County: ${doc.countyName}`);
    if (doc.grantors) lines.push(`Grantor(s): ${doc.grantors}`);
    if (doc.grantees) lines.push(`Grantee(s): ${doc.grantees}`);
    if (doc.remarks) lines.push(`Remarks: ${truncateText(doc.remarks, 800)}`);
    if (doc.address) lines.push(`Address: ${doc.address}`);
    if (doc.legalDescription) lines.push(`Legal Description: ${truncateText(doc.legalDescription, 2000)}`);
    if (doc.abstractText) lines.push(`Abstract Text: ${truncateText(doc.abstractText, 1200)}`);

    const input = lines.join('\n');

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      text: {
        format: {
          type: 'json_schema',
          name: 'document_summary',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string' }
            },
            required: ['summary'],
            additionalProperties: false
          }
        }
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You are a title examiner assistant. Produce a concise 2-3 sentence summary using only the provided fields. No speculation, no headings, no bullet points. Keep it under 400 characters.'
            }
          ]
        },
        {
          role: 'user',
          content: [
            { type: 'input_text', text: input }
          ]
        }
      ]
    });

    const parsed = JSON.parse(response.output_text || '{}');
    const summary = (parsed?.summary || '').toString().trim();
    if (summary) {
      return { summary, source: 'ai' };
    }
  } catch (err) {
    console.error('AI summary failed:', err);
  }

  return { summary: buildHeuristicSummary(doc) || '—', source: 'heuristic' };
}

function nn(v) {
  // normalize: '' -> null, trim strings
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  return v;
}

function toDecimalOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** ID tables only (auto-increment PKs) */
async function ensureLookupId(pool, tableName, rawName) {
  const name = nn(rawName);
  if (!name) return null;

  const idCol = `${tableName}ID`; // e.g., BookTypeID, SubdivisionID, CountyID
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

/** Abstract uses VARCHAR PK: abstractCode. Do NOT create if code is blank. */
async function ensureAbstract(pool, rawCode, rawName) {
  const code = nn(rawCode);
  const name = nn(rawName);
  if (!code) return null; // do not create empty PKs

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

function base36Encode(number) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  if (number === 0) {
    return chars[0].repeat(9);
  }

  let result = '';
  while (number > 0) {
    const i = number % 36;
    number = Math.floor(number / 36);
    result = chars[i] + result;
  }

  return result.padStart(9, '0');
}

/* ------------------------------ routes ----------------------------- */

// GET: all documents
app.get('/documents', async (req, res) => {
  try {
    const pool = await getPool();

    // ! stops the server from crashing when it queries 2 million rows

    const [rows] = await pool.query('SELECT * FROM Document WHERE countyID = 1 ORDER BY documentID DESC LIMIT 100;');
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

/**
 * GET /documents/status?ids=1,2,3
 * Returns { statuses: [ { documentID, status, exportFlag } ] } where status is 'extracted' | 'pending'.
 */
app.get('/documents/status', async (req, res) => {
  try {
    const idsParam = req.query.ids;
    if (!idsParam || typeof idsParam !== 'string') {
      return res.status(400).json({ error: 'ids query param required (comma-separated document IDs)' });
    }
    const ids = idsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return res.status(200).json({ statuses: [] });
    }

    const pool = await getPool();
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT documentID, exportFlag FROM Document WHERE documentID IN (${placeholders})`,
      ids
    );

    const statuses = (rows || []).map(row => ({
      documentID: row.documentID,
      exportFlag: row.exportFlag ?? 0,
      status: row.exportFlag === 2 ? 'extracted' : 'pending',
    }));

    return res.status(200).json({ statuses });
  } catch (err) {
    console.error('Error fetching document status:', err);
    res.status(500).json({ error: 'Failed to fetch document status' });
  }
});

// POST: create document manually
app.post('/documents', async (req, res) => {
  try {
    const pool = await getPool();

    const {
      abstractCode = null,
      bookTypeID = null,
      subdivisionID = null,
      countyID = null,
      instrumentNumber = null,
      book = null,
      volume = null,
      page = null,
      grantor = null,
      grantee = null,
      instrumentType = null,
      remarks = null,
      lienAmount = null,
      legalDescription = null,
      subBlock = null,
      abstractText = null,
      acres = null,
      fileStampDate = null,
      filingDate = null,
      nFileReference = null,
      finalizedBy = null,
      exportFlag = null,
      propertyType = null,
      GFNNumber = null,
      marketShare = null,
      sortArray = null,
      address = null,
      CADNumber = null,
      CADNumber2 = null,
      GLOLink = null,
      fieldNotes = null
    } = req.body || {};

    const [result] = await pool.query(
      `INSERT INTO Document (
      abstractCode, bookTypeID, subdivisionID, countyID,
      instrumentNumber, book, volume, \`page\`,
      instrumentType, remarks, lienAmount, legalDescription, subBlock,
      abstractText, acres, fileStampDate, filingDate, nFileReference,
      finalizedBy, exportFlag, propertyType, GFNNumber, marketShare,
      sortArray, address, CADNumber, CADNumber2, GLOLink, fieldNotes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        nn(abstractCode), nn(bookTypeID), nn(subdivisionID), nn(countyID),
        nn(instrumentNumber), nn(book), nn(volume), nn(page),
        nn(instrumentType), nn(remarks), toDecimalOrNull(lienAmount), nn(legalDescription), nn(subBlock),
        nn(abstractText), toDecimalOrNull(acres), nn(fileStampDate), nn(filingDate), nn(nFileReference),
        nn(finalizedBy), Number.isInteger(exportFlag) ? exportFlag : (exportFlag ? 1 : 0),
        nn(propertyType), nn(GFNNumber), nn(marketShare),
        nn(sortArray), nn(address), nn(CADNumber), nn(CADNumber2), nn(GLOLink), nn(fieldNotes)
      ]
    );

    const docId = result.insertId;
    await insertParties(pool, docId, 'Grantor', grantor);
    await insertParties(pool, docId, 'Grantee', grantee);


    res.status(201).json({
      message: 'Document created successfully',
      documentID: result.insertId
    });
  } catch (err) {
    console.error('Error inserting document:', err);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

app.post('/documents/create-batch', async (req, res) => {
  try {
    const { files } = req.body; // [{ name, size, type }]

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const pool = await getPool();
    const created = [];

    for (const file of files) {
      const [result] = await pool.execute(`
        INSERT INTO Document (exportFlag)
        VALUES (1)
      `);

      const PRSERV = base36Encode(result.insertId);

      const extMatch = file.name.match(/\.([^.]+)$/);
      const ext = extMatch ? extMatch[1] : '';

      const newFileName = ext ? `${PRSERV}.${ext}` : PRSERV;

      created.push({
        documentID: result.insertId,
        PRSERV,
        originalName: file.name,
        newFileName,
      });
    }

    res.json({ documents: created });
  } catch (err) {
    console.error('Batch create failed:', err);
    res.status(500).json({ error: 'Failed to create documents' });
  }
});

app.post('/documents/presign-batch', async (req, res) => {
  try {
    const { documents, countyName } = req.body;

    if (!countyName) {
      return res.status(400).json({ error: 'countyName is required' });
    }

    const bucket = await getS3BucketName();

    const urls = await Promise.all(
      documents.map(async (doc) => {
        const key = `${countyName}/${doc.newFileName}`;

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: doc.type || 'application/octet-stream',
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 3000 });

        return { documentID: doc.documentID, key, url };
      })
    );

    res.json({ uploads: urls });
  } catch (err) {
    console.error('Presign batch failed:', err);
    res.status(500).json({ error: 'Failed to generate presigned URLs' });
  }
});

app.post('/documents/batch', async (req, res) => {
  try {
    const { total } = req.body;
    if (total == null || typeof total !== 'number' || total < 1) {
      return res.status(400).json({ error: 'total (number >= 1) is required' });
    }
    const pool = await getPool();
    const batchId = crypto.randomUUID();
    await pool.execute(
      'INSERT INTO Document_Batch_Job (batch_id, documents_total) VALUES (?, ?)',
      [batchId, total]
    );
    return res.json({ batchId });
  } catch (err) {
    console.error('Create batch failed:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

app.post('/documents/queue-batch', async (req, res) => {
  try {
    const { uploads, batchId: existingBatchId } = req.body;
    const queueUrl = await getAIProcessorQueueName();
    const pool = await getPool();

    // Use existing batch or create one for this request (progress tracking)
    let batchId = existingBatchId;
    if (!batchId) {
      batchId = crypto.randomUUID();
      await pool.execute(
        'INSERT INTO Document_Batch_Job (batch_id, documents_total) VALUES (?, ?)',
        [batchId, uploads.length]
      );
    }

    for (const item of uploads) {
      const s3Key = `${item.countyName}/${item.fileName}`;

      const params = {
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          document_id: item.documentID,
          PRSERV: item.PRSERV,
          county_name: item.countyName,
          county_id: item.countyID,
          key: s3Key,
          batch_id: batchId,
        }),
      };

      const command = new SendMessageCommand(params);
      await sqs.send(command);
    }

    res.json({ status: 'Queued all documents for processing', batchId });
  } catch (err) {
    console.error('Queue batch failed:', err);
    res.status(500).json({ error: 'Failed to queue batch' });
  }
});

app.get('/documents/batch/:batchId/status', async (req, res) => {
  try {
    const { batchId } = req.params;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId path param is required' });
    }
    const pool = await getPool();
    const [rows] = await pool.execute(
      'SELECT documents_total, documents_ai_processed, documents_db_updated FROM Document_Batch_Job WHERE batch_id = ?',
      [batchId]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const row = rows[0];
    return res.json({
      documentsTotal: row.documents_total,
      documentsAiProcessed: row.documents_ai_processed ?? 0,
      documentsDbUpdated: row.documents_db_updated ?? 0,
    });
  } catch (err) {
    console.error('Batch status failed:', err);
    res.status(500).json({ error: 'Failed to get batch status' });
  }
});

/* ------------------------------- search ------------------------------- */
app.get('/documents/search', async (req, res) => {
  try {
    const pool = await getPool();

    const textLike = new Set([
      'instrumentNumber', 'book', 'volume', 'page', 'instrumentType',
      'remarks', 'legalDescription', 'subBlock', 'abstractText', 'propertyType',
      'marketShare', 'sortArray', 'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes',
      'finalizedBy', 'nFileReference', 'abstractCode', 'countyName' // VARCHAR exact below
    ]);
    const numericEq = new Set([
      'documentID', 'bookTypeID', 'subdivisionID', 'exportFlag', 'GFNNumber'
    ]);
    const dateEq = new Set(['fileStampDate', 'filingDate', 'created_at', 'updated_at']);

    const limit = Math.min(parseInt(req.query.limit ?? '50', 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

    const where = [];
    const params = [];

    for (const [k, vRaw] of Object.entries(req.query)) {
      if (['criteria', 'limit', 'offset'].includes(k)) continue;
      const v = String(vRaw ?? '').trim();
      if (!v) continue;

      if (k === 'grantor') {
        where.push(`EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantor' AND pt.name LIKE ?)`);
        params.push(`%${v}%`);
      } else if (k === 'grantee') {
        where.push(`EXISTS (SELECT 1 FROM Party pt WHERE pt.documentID = d.documentID AND pt.role = 'Grantee' AND pt.name LIKE ?)`);
        params.push(`%${v}%`);
      } else if (numericEq.has(k)) {
        where.push(`d.\`${k}\` = ?`);
        params.push(v);
      } else if (dateEq.has(k)) {
        const range = v.split('..');
        if (range.length === 2) {
          where.push(`d.\`${k}\` BETWEEN ? AND ?`);
          params.push(range[0], range[1]);
        } else {
          where.push(`DATE(d.\`${k}\`) = DATE(?)`);
          params.push(v);
        }
      } else if (textLike.has(k)) {
        if (k === 'abstractCode') {
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

    // criteria search (uses FULLTEXT index for fast searching)
    const criteria = String(req.query.criteria ?? '').trim();
    if (criteria) {
      where.push(`MATCH(
        d.instrumentNumber, d.instrumentType, d.legalDescription, d.remarks, d.address,
        d.CADNumber, d.CADNumber2, d.book, d.volume, d.page, d.abstractText, d.fieldNotes
      ) AGAINST (? IN BOOLEAN MODE)`);
      params.push(criteria + '*');
    }

    // Build the WHERE clause string
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // Check if we need to join County table in subquery
    const needsCountyJoin = where.some(w => w.includes(`c.\`name\``));
    const countyJoinClause = needsCountyJoin ? 'LEFT JOIN County c ON c.countyID = d.countyID' : '';

    // Subquery to limit documents first by updated/created date, filtering applied
    const limitedDocsSubquery = `
      SELECT d.documentID
      FROM Document d
      ${countyJoinClause}
      ${whereClause}
      ORDER BY (d.updated_at IS NULL), d.updated_at DESC, (d.created_at IS NULL), d.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    // Final query joining the limited docs with other data & aggregations
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

    const [rows] = await pool.query(sql, params);

    // Get total count of all matching documents (without LIMIT/OFFSET)
    const countParams = params.slice(0, -2); // Remove limit and offset from params
    const countSql = `
      SELECT COUNT(DISTINCT d.documentID) as total
      FROM Document d
      ${countyJoinClause}
      ${whereClause}
    `;
    const [countResult] = await pool.query(countSql, countParams);
    const totalCount = countResult[0]?.total || 0;

    res.status(200).json({ rows, limit, offset, count: rows.length, total: totalCount });
  } catch (err) {
    console.error('Error searching documents:', err);
    res.status(500).json({ error: 'Failed to search documents' });
  }
});

/* ------------------------------ summary ------------------------------ */
app.get('/documents/:id/summary', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid documentID' });
    }

    const pool = await getPool();

    const [rows] = await pool.query(
      `
        SELECT
          d.*,
          c.name AS countyName,
          GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors,
          GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees
        FROM Document d
        LEFT JOIN County c ON c.countyID = d.countyID
        LEFT JOIN Party p ON p.documentID = d.documentID
        WHERE d.documentID = ?
        GROUP BY d.documentID
      `,
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = rows[0];
    let summaryResult;
    try {
      summaryResult = await generateAiSummary(doc);
    } catch (err) {
      console.error('AI summary generation failed:', err);
      summaryResult = { summary: buildHeuristicSummary(doc) || '—', source: 'heuristic' };
    }

    res.json({ summary: summaryResult.summary, source: summaryResult.source });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});


/* -------------------------- update / delete --------------------------- */
app.put('/documents/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid documentID' });
    }

    const pool = await getPool();

    const updatable = new Set([
      'abstractCode', 'bookTypeID', 'subdivisionID', 'countyID',
      'instrumentNumber', 'book', 'volume', 'page',
      'instrumentType', 'remarks', 'lienAmount', 'legalDescription', 'subBlock',
      'abstractText', 'acres', 'fileStampDate', 'filingDate', 'nFileReference',
      'finalizedBy', 'exportFlag', 'propertyType', 'GFNNumber', 'marketShare',
      'sortArray', 'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes'
    ]);


    const body = req.body || {};
    const sets = [];
    const params = [];

    for (const [k, v] of Object.entries(body)) {
      if (!updatable.has(k)) continue;
      sets.push(`\`${k}\` = ?`);
      if (k === 'lienAmount' || k === 'acres') {
        params.push(toDecimalOrNull(v));
      } else if (k === 'exportFlag') {
        params.push(Number.isInteger(v) ? v : (v ? 1 : 0));
      } else {
        params.push(nn(v));
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const sql = `UPDATE Document SET ${sets.join(', ')} WHERE documentID = ?`;
    params.push(id);

    const [result] = await pool.query(sql, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ message: 'Document updated', documentID: id });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

app.delete('/documents/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid documentID' });
    }

    const s3_bucket_name = await getS3BucketName();
    const pool = await getPool();

    const [docs] = await pool.query('SELECT PRSERV, countyID FROM Document WHERE documentID = ?', [id]);
    if (docs.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const { PRSERV: prservPrefix, countyID } = docs[0];
    if (!prservPrefix) {
      return res.status(400).json({ error: 'PRSERV value missing for document' });
    }

    const [counties] = await pool.query('SELECT name FROM County WHERE countyID = ?', [countyID]);
    if (counties.length === 0) {
      return res.status(400).json({ error: 'County not found for document' });
    }

    const countyName = counties[0].name;

    const s3Prefix = `${countyName}/${prservPrefix}`;

    const listParams = {
      Bucket: s3_bucket_name,
      Prefix: s3Prefix,
    };

    const listedObjectsResponse = await s3.send(new ListObjectsV2Command(listParams));

    if (listedObjectsResponse.KeyCount > 0) {
      const objectsToDelete = listedObjectsResponse.Contents.map(obj => ({ Key: obj.Key }));

      const deleteParams = {
        Bucket: s3_bucket_name,
        Delete: {
          Objects: objectsToDelete,
          Quiet: true,
        },
      };

      await s3.send(new DeleteObjectsCommand(deleteParams));
    }

    const [result] = await pool.query('DELETE FROM Document WHERE documentID = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Document not found during deletion' });
    }

    res.json({ message: 'Document and associated S3 files deleted', documentID: id });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete document and images' });
  }
});

app.get('/documents/pdf', async (req, res) => {
  try {
    const userPrefix = req.query.prefix || '';
    const countyName = (req.query.countyName || 'Washington').trim();
    const download = req.query.download === 'true'; // Check if download mode is requested

    if (!userPrefix) {
      return res.status(400).json({ error: 'prefix query param is required' });
    }

    if (!countyName) {
      return res.status(400).json({ error: 'countyName query param is required' });
    }

    // Files are stored under "<county>/<PRSERV>.*"; try sensible variations if not found
    const baseCounty = countyName
      .replace(/\.\./g, '') // avoid path traversal
      .replace(/^\/+|\/+$/g, '') // drop leading/trailing slashes
      .trim();

    const variants = Array.from(new Set([
      baseCounty,
      baseCounty.toLowerCase(),
      baseCounty.toUpperCase(),
      baseCounty.replace(/\s+/g, '_'),
      baseCounty.replace(/\s+/g, ''),
      baseCounty.replace(/\s+/g, '-'),
      baseCounty.replace(/\s+County$/i, '').trim(),
      `${baseCounty.replace(/\s+County$/i, '').trim()} County`,
      `${baseCounty.replace(/\s+County$/i, '').trim()}_County`,
      `${baseCounty.replace(/\s+County$/i, '').trim()}-County`
    ].filter(Boolean)));

    let keys = [];
    const triedPrefixes = [];

    for (const candidate of variants) {
      const prefix = `${candidate}/${userPrefix}`; // allow any extension suffix
      triedPrefixes.push(prefix);
      const found = await listFilesByPrefixLocal(prefix);
      if (found.length > 0) {
        keys = found;
        console.log(`Found files with prefix: ${prefix}`);
        break;
      }
    }

    if (keys.length === 0) {
      console.error(`No files found for any prefix. Tried: ${JSON.stringify(triedPrefixes)}`);
      return res.status(404).json({
        error: 'No files found for prefix',
        tried: triedPrefixes
      });
    }

    // If the stored artifact is already a PDF, just return it directly
    const firstKey = keys[0];
    if (firstKey.toLowerCase().endsWith('.pdf')) {
      const pdfBuffer = await getObjectBufferLocal(firstKey);
      res.setHeader('Content-Type', 'application/pdf');
      const disposition = download ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="${userPrefix}.pdf"`);
      return res.send(pdfBuffer);
    }

    const pdfDoc = await PDFDocument.create();

    for (const key of keys) {
      const ext = key.toLowerCase();
      const isKnownImage = ext.endsWith('.tif') || ext.endsWith('.tiff') || ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp');
      const isNumberedExtension = /\.\d{3,}$/.test(ext); // .001, .002, etc. (common for TIFF pages)

      if (!isKnownImage && !isNumberedExtension) {
        console.warn('Skipping unsupported format for PDF merge:', key);
        continue;
      }

      try {
        // Download file from S3
        const imageBuffer = await getObjectBufferLocal(key);

        // Create sharp instance - treat numbered extensions as TIFF
        const image = sharp(imageBuffer);

        // Get number of pages (for multi-page TIFFs or single-page images)
        const metadata = await image.metadata();
        const pageCount = metadata.pages || 1;

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          // Extract single page
          const pngBuffer = await sharp(imageBuffer, { page: pageIndex }).png().toBuffer();

          // Embed PNG in PDF
          const pngImage = await pdfDoc.embedPng(pngBuffer);

          // Add a page and draw the image full page
          const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
          page.drawImage(pngImage, {
            x: 0,
            y: 0,
            width: pngImage.width,
            height: pngImage.height,
          });
        }
      } catch (err) {
        console.error(`Failed to process file ${key}:`, err.message);
        // Continue with other files instead of failing completely
      }
    }

    // Save and send the PDF
    const pdfBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    // Use 'inline' for preview or 'attachment' for download
    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${userPrefix}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

export default app;

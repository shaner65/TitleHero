import express from 'express';
import crypto from 'node:crypto';
import { getPool, getS3BucketName, getAIProcessorQueueName } from '../config.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { base36Encode } from '../lib/base36.js';
import { nn, toDecimalOrNull } from '../lib/normalize.js';
import { insertParties } from '../lib/db.js';
import { listFilesByPrefix, getObjectBuffer, deleteObjectsByPrefix, s3 } from '../lib/s3.js';
import { generateAiSummary, buildHeuristicSummary, executeSearch, buildSearchQuery, findKeysForPrefix, buildPdfFromKeys } from '../services/documents/index.js';
import { scheduleSyncDocumentToOpenSearch, scheduleDeleteDocumentFromOpenSearch } from '../services/documents/opensearchSync.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const sqs = new SQSClient({ region: 'us-east-2' });
const app = express();

function inferContentTypeFromName(fileName = '') {
  const lowerName = String(fileName).toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.tif') || lowerName.endsWith('.tiff')) return 'image/tiff';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return null;
}

/* ------------------------------ routes ----------------------------- */

app.get('/documents', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const [rows] = await pool.query('SELECT * FROM Document WHERE countyID = 1 ORDER BY documentID DESC LIMIT 100;');
  res.status(200).json(rows);
}));

app.get('/documents/status', asyncHandler(async (req, res) => {
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

  res.status(200).json({ statuses });
}));

app.post('/documents', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const {
    abstractCode = null, bookTypeID = null, subdivisionID = null, countyID = null,
    instrumentNumber = null, book = null, volume = null, page = null,
    grantor = null, grantee = null, instrumentType = null, remarks = null,
    lienAmount = null, legalDescription = null, subBlock = null, abstractText = null,
    acres = null, instrumentDate = null, filingDate = null,
    exportFlag = null, GFNNumber = null,
    marketShare = null, address = null, CADNumber = null,
    CADNumber2 = null, GLOLink = null, fieldNotes = null
  } = req.body || {};

  const [result] = await pool.query(
    `INSERT INTO Document (
      abstractCode, bookTypeID, subdivisionID, countyID,
      instrumentNumber, book, volume, \`page\`,
      instrumentType, remarks, lienAmount, legalDescription, subBlock,
      abstractText, acres, instrumentDate, filingDate,
      exportFlag, GFNNumber, marketShare,
      address, CADNumber, CADNumber2, GLOLink, fieldNotes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      nn(abstractCode), nn(bookTypeID), nn(subdivisionID), nn(countyID),
      nn(instrumentNumber), nn(book), nn(volume), nn(page),
      nn(instrumentType), nn(remarks), toDecimalOrNull(lienAmount), nn(legalDescription), nn(subBlock),
      nn(abstractText), toDecimalOrNull(acres), nn(instrumentDate), nn(filingDate),
      Number.isInteger(exportFlag) ? exportFlag : (exportFlag ? 1 : 0),
      nn(GFNNumber), nn(marketShare),
      nn(address), nn(CADNumber), nn(CADNumber2), nn(GLOLink), nn(fieldNotes)
    ]
  );

  const docId = result.insertId;
  await insertParties(pool, docId, 'Grantor', grantor);
  await insertParties(pool, docId, 'Grantee', grantee);
  scheduleSyncDocumentToOpenSearch(pool, docId);

  res.status(201).json({
    message: 'Document created successfully',
    documentID: result.insertId
  });
}));

app.post('/documents/create-batch', asyncHandler(async (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const pool = await getPool();
  const created = [];

  for (const file of files) {
    const [result] = await pool.execute(
      `INSERT INTO Document (exportFlag, scan_status, scan_pages_processed, scan_pages_total, scan_error, scan_batch_id)
       VALUES (0, 'pending', 0, NULL, NULL, NULL)`
    );
    const PRSERV = base36Encode(result.insertId);
    const extMatch = file.name.match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1] : '';
    const newFileName = ext ? `${PRSERV}.${ext}` : PRSERV;
    const documentID = result.insertId;
    scheduleSyncDocumentToOpenSearch(pool, documentID);
    created.push({
      documentID,
      PRSERV,
      originalName: file.name,
      newFileName,
      type: file.type || inferContentTypeFromName(file.name) || undefined,
    });
  }

  res.json({ documents: created });
}));

app.post('/documents/presign-batch', asyncHandler(async (req, res) => {
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
        ContentType: doc.type || inferContentTypeFromName(doc.newFileName) || 'application/octet-stream',
      });
      const url = await getSignedUrl(s3, command, { expiresIn: 3000 });
      return { documentID: doc.documentID, key, url };
    })
  );

  res.json({ uploads: urls });
}));

app.post('/documents/batch', asyncHandler(async (req, res) => {
  const { total } = req.body;
  if (total == null || typeof total !== 'number' || total < 1) {
    return res.status(400).json({ error: 'total (number >= 1) is required' });
  }

  const pool = await getPool();
  const batchId = crypto.randomUUID();
  await pool.execute(
    'INSERT INTO Document_Batch_Job (batch_id, status, documents_total) VALUES (?, ?, ?)',
    [batchId, 'pending', total]
  );
  res.json({ batchId });
}));

function computeBatchStatus(row) {
  const total = row.documents_total ?? 0;
  const dbUpdated = row.documents_db_updated ?? 0;
  const aiFailed = row.documents_ai_failed ?? 0;
  const dbFailed = row.documents_db_failed ?? 0;

  if (aiFailed > 0 || dbFailed > 0) return 'failed';
  if (total > 0 && dbUpdated >= total) return 'completed';
  return row.status || 'processing';
}

app.post('/documents/queue-batch', asyncHandler(async (req, res) => {
  const { uploads, batchId: existingBatchId } = req.body;
  const queueUrl = await getAIProcessorQueueName();
  const pool = await getPool();

  let batchId = existingBatchId;
  if (!batchId) {
    batchId = crypto.randomUUID();
    await pool.execute(
      'INSERT INTO Document_Batch_Job (batch_id, status, documents_total) VALUES (?, ?, ?)',
      [batchId, 'pending', uploads.length]
    );
  }
  await pool.execute(
    `UPDATE Document_Batch_Job
     SET status = 'processing',
         error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE batch_id = ?`,
    [batchId]
  );

  for (const item of uploads) {
    const s3Key = `${item.countyName}/${item.fileName}`;
    await pool.execute(
      `UPDATE Document
       SET scan_batch_id = ?,
           scan_status = 'pending',
           scan_pages_total = NULL,
           scan_pages_processed = 0,
           scan_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE documentID = ?`,
      [batchId, item.documentID]
    );
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        document_id: item.documentID,
        PRSERV: item.PRSERV,
        county_name: item.countyName,
        county_id: item.countyID,
        file_type: item.type || null,
        key: s3Key,
        batch_id: batchId,
      }),
    }));
  }

  res.json({ status: 'Queued all documents for processing', batchId });
}));

app.get('/documents/batch/:batchId/status', asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  if (!batchId) {
    return res.status(400).json({ error: 'batchId path param is required' });
  }

  const pool = await getPool();
  const [rows] = await pool.execute(
    `SELECT status, documents_total, documents_ai_processed, documents_ai_failed,
            documents_db_updated, documents_db_failed, error
     FROM Document_Batch_Job
     WHERE batch_id = ?`,
    [batchId]
  );
  if (!rows || rows.length === 0) {
    return res.status(404).json({ error: 'Batch not found' });
  }

  const row = rows[0];
  const status = computeBatchStatus(row);
  if (status !== row.status) {
    await pool.execute(
      `UPDATE Document_Batch_Job
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE batch_id = ?`,
      [status, batchId]
    );
  }

  const [documentRows] = await pool.execute(
    `SELECT documentID, scan_status, scan_pages_processed, scan_pages_total, scan_error
     FROM Document
     WHERE scan_batch_id = ?
     ORDER BY documentID ASC`,
    [batchId]
  );

  res.json({
    status,
    documentsTotal: row.documents_total,
    documentsAiProcessed: row.documents_ai_processed ?? 0,
    documentsAiFailed: row.documents_ai_failed ?? 0,
    documentsDbUpdated: row.documents_db_updated ?? 0,
    documentsDbFailed: row.documents_db_failed ?? 0,
    error: row.error ?? null,
    documents: (documentRows || []).map((doc) => ({
      documentID: doc.documentID,
      scanStatus: doc.scan_status ?? 'pending',
      scanPagesProcessed: doc.scan_pages_processed ?? 0,
      scanPagesTotal: doc.scan_pages_total ?? null,
      scanError: doc.scan_error ?? null,
    })),
  });
}));

app.get('/documents/search', asyncHandler(async (req, res) => {
  const pool = await getPool();
  const { rows, total } = await executeSearch(pool, req.query);
  const { limit, offset } = buildSearchQuery(req.query);
  res.status(200).json({ rows, limit, offset, count: rows.length, total });
}));

app.get('/documents/:id/summary', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid documentID' });
  }

  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT d.*, c.name AS countyName,
            GROUP_CONCAT(CASE WHEN p.role = 'Grantor' THEN p.name END SEPARATOR '; ') AS grantors,
            GROUP_CONCAT(CASE WHEN p.role = 'Grantee' THEN p.name END SEPARATOR '; ') AS grantees
     FROM Document d
     LEFT JOIN County c ON c.countyID = d.countyID
     LEFT JOIN Party p ON p.documentID = d.documentID
     WHERE d.documentID = ?
     GROUP BY d.documentID`,
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
}));

app.put('/documents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid documentID' });
  }

  const pool = await getPool();
  const updatable = new Set([
    'abstractCode', 'bookTypeID', 'subdivisionID', 'countyID',
    'instrumentNumber', 'book', 'volume', 'page',
    'instrumentType', 'remarks', 'lienAmount', 'legalDescription', 'subBlock',
    'abstractText', 'acres', 'instrumentDate', 'filingDate',
    'exportFlag', 'GFNNumber', 'marketShare',
    'address', 'CADNumber', 'CADNumber2', 'GLOLink', 'fieldNotes'
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

  params.push(id);
  const [result] = await pool.query(`UPDATE Document SET ${sets.join(', ')} WHERE documentID = ?`, params);
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: 'Document not found' });
  }

  scheduleSyncDocumentToOpenSearch(pool, id);

  res.json({ message: 'Document updated', documentID: id });
}));

app.delete('/documents/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid documentID' });
  }

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
  await deleteObjectsByPrefix(s3Prefix);

  const [result] = await pool.query('DELETE FROM Document WHERE documentID = ?', [id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: 'Document not found during deletion' });
  }

  scheduleDeleteDocumentFromOpenSearch(id);

  res.json({ message: 'Document and associated S3 files deleted', documentID: id });
}));

app.get('/documents/pdf', asyncHandler(async (req, res) => {
  const userPrefix = req.query.prefix || '';
  const countyName = (req.query.countyName || 'Washington').trim();
  const download = req.query.download === 'true';

  console.log(`PDF request - prefix: "${userPrefix}", countyName: "${countyName}"`);

  if (!userPrefix) {
    return res.status(400).json({ error: 'prefix query param is required' });
  }
  if (!countyName) {
    return res.status(400).json({ error: 'countyName query param is required' });
  }

  const { keys, triedPrefixes } = await findKeysForPrefix(userPrefix, countyName);
  console.log(`Found ${keys.length} keys for prefix "${userPrefix}". Tried prefixes: ${JSON.stringify(triedPrefixes)}`);
  
  if (keys.length === 0) {
    console.error(`No files found for any prefix. Tried: ${JSON.stringify(triedPrefixes)}`);
    return res.status(404).json({
      error: 'No files found for prefix',
      tried: triedPrefixes
    });
  }

  console.log(`Building PDF from keys:`, keys);
  const pdfBuffer = await buildPdfFromKeys(keys);
  console.log(`PDF built successfully, size: ${pdfBuffer.length} bytes`);

  res.setHeader('Content-Type', 'application/pdf');
  const disposition = download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${userPrefix}.pdf"`);
  res.send(pdfBuffer);
}));

export default app;

import express from 'express';
import { getS3BucketName, getPool, getTifProcessQueueName } from '../config.js';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const app = express();

const s3 = new S3Client({ region: 'us-east-2' });
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function listFilesByPrefixProcessing(prefix) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));
  const keys = (out.Contents || [])
    .map(o => o.Key)
    .filter(Boolean);
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  console.log(`[TIF Books] Listed ${keys.length} file(s) at prefix ${prefix}`);
  return keys;
}

app.post('/tif-books/presign-batch', async (req, res) => {
  try {
    let { bookId, countyName, files } = req.body || {};

    if (!countyName || typeof countyName !== 'string') {
      return res.status(400).json({ error: 'countyName is required' });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }

    if (!bookId || typeof bookId !== 'string' || !bookId.trim()) {
      const nowPart = Date.now().toString(36).toUpperCase();
      const randPart = Math.random().toString(36).slice(2, 8).toUpperCase();
      bookId = `BOOK_${nowPart}_${randPart}`;
    }

    const safeCounty = countyName
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    const processingPrefix = `processing/${safeCounty}/${bookId}/`;

    const pages = files.map((file) => {
      const name = file.name || 'page.tif';
      return {
        name,
        key: `${processingPrefix}${name}`,
        type: file.type || 'image/tiff',
        size: file.size ?? null,
      };
    });

    const bucket = await getS3BucketName();
    const uploads = await Promise.all(
      pages.map(async (page) => {
        const contentType =
          page.type ||
          (page.key.toLowerCase().endsWith('.tif') || page.key.toLowerCase().endsWith('.tiff')
            ? 'image/tiff'
            : 'application/octet-stream');
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: page.key,
          ContentType: contentType,
        });
        const url = await getSignedUrl(s3, command, { expiresIn: 3000 });
        return { key: page.key, url };
      }),
    );

    console.log(`[TIF Books] Presign-batch: bookId=${bookId}, ${pages.length} pages, county=${safeCounty}`);
    return res.json({
      bookId,
      processingPrefix,
      pages,
      uploads,
    });
  } catch (err) {
    console.error('[TIF Books] Presign-batch failed:', err);
    return res.status(500).json({ error: 'Failed to generate presigned URLs for TIF pages' });
  }
});

/**
 * Step 3: Enqueue a TIF book for processing.
 *
 * POST /tif-books/:bookId/process
 * {
 *   countyID: 1,
 *   countyName: "Washington"
 * }
 *
 * This:
 *  - Validates input and checks that TIF pages exist in S3
 *  - Creates a job record in TIF_Process_Job table with status 'pending'
 *  - Sends a message to the TIF process SQS queue
 *  - Returns 202 Accepted immediately (actual processing happens in background worker)
 */
app.post('/tif-books/:bookId/process', async (req, res) => {
  try {
    const { bookId } = req.params;
    const { countyID, countyName } = req.body || {};

    if (!bookId) {
      return res.status(400).json({ error: 'bookId path param is required' });
    }
    if (!countyName) {
      return res.status(400).json({ error: 'countyName is required in body' });
    }
    if (!countyID) {
      return res.status(400).json({ error: 'countyID is required in body' });
    }

    const safeCounty = countyName
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();
    const processingPrefix = `processing/${safeCounty}/${bookId}/`;

    const pageKeys = await listFilesByPrefixProcessing(processingPrefix);
    if (!pageKeys.length) {
      return res.status(404).json({
        error: 'No TIF pages found for book',
        prefix: processingPrefix,
      });
    }

    const pool = await getPool();
    await pool.execute(
      `INSERT INTO TIF_Process_Job (book_id, county_id, county_name, status, documents_queued_for_ai)
       VALUES (?, ?, ?, 'pending', NULL)
       ON DUPLICATE KEY UPDATE
         county_id = VALUES(county_id),
         county_name = VALUES(county_name),
         status = 'pending',
         documents_queued_for_ai = NULL,
         error = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [bookId, countyID, safeCounty]
    );

    const tifProcessQueueUrl = await getTifProcessQueueName();

    await sqs.send(new SendMessageCommand({
      QueueUrl: tifProcessQueueUrl,
      MessageBody: JSON.stringify({ bookId, countyID, countyName: safeCounty }),
    }));

    console.log(`[TIF Books] Process enqueued: bookId=${bookId}, ${pageKeys.length} pages`);
    return res.status(202).json({
      bookId,
      status: 'pending',
      message: 'Job created and queued for processing',
    });
  } catch (err) {
    console.error('[TIF Books] Process enqueue failed:', err);
    return res.status(500).json({ error: 'Failed to enqueue TIF book for processing' });
  }
});

/**
 * Get the status of a TIF book processing job.
 *
 * GET /tif-books/:bookId/process-status
 *
 * Returns:
 *  - 200: { status, documentsCreated?, error? }
 *  - 404: Job not found
 */
app.get('/tif-books/:bookId/process-status', async (req, res) => {
  try {
    const { bookId } = req.params;

    if (!bookId) {
      return res.status(400).json({ error: 'bookId path param is required' });
    }

    const pool = await getPool();
    const [rows] = await pool.execute(
      `SELECT status, documents_created, documents_queued_for_ai, error
       FROM TIF_Process_Job
       WHERE book_id = ?`,
      [bookId]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = rows[0];
    const response = {
      status: job.status,
    };

    if (job.status === 'completed' && job.documents_created !== null) {
      response.documentsCreated = job.documents_created;
    }

    if (job.documents_queued_for_ai !== null && job.documents_queued_for_ai !== undefined) {
      response.documentsQueuedForAi = job.documents_queued_for_ai;
    }

    if (job.status === 'failed' && job.error) {
      response.error = job.error;
    }

    return res.json(response);
  } catch (err) {
    console.error('[TIF Books] Process-status failed:', err);
    return res.status(500).json({ error: 'Failed to get job status' });
  }
});

export default app;


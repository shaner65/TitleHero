import express from 'express';
import { getS3BucketName, getAIProcessorQueueName, getPool } from '../config.js';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient } from '@aws-sdk/client-sqs';
import { processTifBook } from '../workers/tifBookSplitter.js';

const app = express();

const s3 = new S3Client({ region: 'us-east-2' });
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function listFilesByPrefixProcessing(prefix) {
  console.log(`[TIF Books] Listing files with prefix: ${prefix}`);
  const BUCKET = await getS3BucketName();
  console.log(`[TIF Books] Querying S3 bucket: ${BUCKET}`);
  
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));

  const keys = (out.Contents || [])
    .map(o => o.Key)
    .filter(Boolean);

  console.log(`[TIF Books] Found ${keys.length} raw file(s) before sorting`);

  // Keep numeric order like 0001.tif, 0002.tif, or page_1.tif, page_2.tif
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  console.log(`[TIF Books] Returning ${keys.length} sorted file key(s)`);
  return keys;
}

// Simple helper that mirrors base36Encode from documents.js so split
// documents get PRSERV-style identifiers compatible with existing flows.
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

/**
 * Create S3 keys in the processing folder and presign PUT URLs
 * for each TIF page in a book. No DB writes here.
 *
 * POST /tif-books/presign-batch
 * {
 *   bookId: "BOOK123",
 *   countyName: "Washington",
 *   files: [{ name, size, type }]
 * }
 *
 * → {
 *   bookId,
 *   processingPrefix,
 *   pages: [{ name, key, type, size }],
 *   uploads: [{ key, url }]
 * }
 */
app.post('/tif-books/presign-batch', async (req, res) => {
  try {
    console.log('[TIF Books] Step 1: Starting presign-batch request');
    let { bookId, countyName, files } = req.body || {};

    console.log('[TIF Books] Step 2: Validating request parameters');
    if (!countyName || typeof countyName !== 'string') {
      console.log('[TIF Books] ERROR: countyName is missing or invalid');
      return res.status(400).json({ error: 'countyName is required' });
    }

    if (!Array.isArray(files) || files.length === 0) {
      console.log('[TIF Books] ERROR: files array is missing or empty');
      return res.status(400).json({ error: 'files array is required' });
    }

    console.log(`[TIF Books] Step 3: Processing ${files.length} files for county: ${countyName}`);

    // If the frontend didn't provide a bookId, generate a unique one here.
    if (!bookId || typeof bookId !== 'string' || !bookId.trim()) {
      console.log('[TIF Books] Step 4: Generating new bookId (none provided)');
      const nowPart = Date.now().toString(36).toUpperCase();
      const randPart = Math.random().toString(36).slice(2, 8).toUpperCase();
      bookId = `BOOK_${nowPart}_${randPart}`;
      console.log(`[TIF Books] Generated bookId: ${bookId}`);
    } else {
      console.log(`[TIF Books] Step 4: Using provided bookId: ${bookId}`);
    }

    console.log('[TIF Books] Step 5: Sanitizing county name and creating processing prefix');
    const safeCounty = countyName
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();

    const processingPrefix = `processing/${safeCounty}/${bookId}/`;
    console.log(`[TIF Books] Processing prefix: ${processingPrefix}`);

    console.log('[TIF Books] Step 6: Creating page metadata for each file');
    const pages = files.map((file) => {
      const name = file.name || 'page.tif';
      const key = `${processingPrefix}${name}`;

      return {
        name,
        key,
        type: file.type || 'image/tiff',
        size: file.size ?? null,
      };
    });
    console.log(`[TIF Books] Created ${pages.length} page entries`);

    console.log('[TIF Books] Step 7: Getting S3 bucket name');
    const bucket = await getS3BucketName();
    console.log(`[TIF Books] Using bucket: ${bucket}`);

    console.log('[TIF Books] Step 8: Generating presigned URLs for each page');
    const uploads = await Promise.all(
      pages.map(async (page, index) => {
        const key = page.key;
        console.log(`[TIF Books]   Generating presigned URL ${index + 1}/${pages.length} for: ${key}`);

        const contentType =
          page.type ||
          (key.toLowerCase().endsWith('.tif') || key.toLowerCase().endsWith('.tiff')
            ? 'image/tiff'
            : 'application/octet-stream');

        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 3000 });

        return { key, url };
      }),
    );
    console.log(`[TIF Books] Step 9: Successfully generated ${uploads.length} presigned URLs`);

    console.log('[TIF Books] Step 10: Returning response with bookId, pages, and uploads');
    return res.json({
      bookId,
      processingPrefix,
      pages,
      uploads,
    });
  } catch (err) {
    console.error('[TIF Books] ERROR: TIF presign-batch failed:', err);
    return res.status(500).json({ error: 'Failed to generate presigned URLs for TIF pages' });
  }
});

/**
 * Step 3: process a TIF book that has been uploaded into the processing folder.
 *
 * POST /tif-books/:bookId/process
 * {
 *   countyID: 1,
 *   countyName: "Washington"
 * }
 *
 * This:
 *  - Lists all pages from processing/{countyName}/{bookId}/
 *  - Runs the vertical audit via processTifBook to detect document boundaries
 *  - Creates final Document rows, uploads per-document PDFs, and queues SQS
 */
app.post('/tif-books/:bookId/process', async (req, res) => {
  try {
    console.log('[TIF Books Process] Step 1: Starting process request');
    const { bookId } = req.params;
    const { countyID, countyName } = req.body || {};

    console.log(`[TIF Books Process] Step 2: Validating request parameters (bookId: ${bookId})`);
    if (!bookId) {
      console.log('[TIF Books Process] ERROR: bookId path param is missing');
      return res.status(400).json({ error: 'bookId path param is required' });
    }

    if (!countyName) {
      console.log('[TIF Books Process] ERROR: countyName is missing');
      return res.status(400).json({ error: 'countyName is required in body' });
    }

    if (!countyID) {
      console.log('[TIF Books Process] ERROR: countyID is missing');
      return res.status(400).json({ error: 'countyID is required in body' });
    }

    console.log(`[TIF Books Process] Step 3: Sanitizing county name (countyID: ${countyID}, countyName: ${countyName})`);
    const safeCounty = countyName
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '')
      .trim();

    const processingPrefix = `processing/${safeCounty}/${bookId}/`;
    console.log(`[TIF Books Process] Processing prefix: ${processingPrefix}`);

    console.log('[TIF Books Process] Step 4: Listing TIF pages from S3');
    const pageKeys = await listFilesByPrefixProcessing(processingPrefix);
    console.log(`[TIF Books Process] Found ${pageKeys.length} page(s) in S3`);

    if (!pageKeys.length) {
      console.log(`[TIF Books Process] ERROR: No TIF pages found for book at prefix: ${processingPrefix}`);
      return res.status(404).json({
        error: 'No TIF pages found for book',
        prefix: processingPrefix,
      });
    }

    console.log('[TIF Books Process] Step 5: Getting database pool and SQS queue URL');
    const pool = await getPool();
    const queueUrl = await getAIProcessorQueueName();
    console.log(`[TIF Books Process] Queue URL: ${queueUrl}`);

    console.log('[TIF Books Process] Step 6: Starting TIF book processing (detecting document boundaries, creating documents)');
    console.log(`[TIF Books Process] Processing ${pageKeys.length} pages for county ${countyID} (${safeCounty})`);
    
    const result = await processTifBook({
      pageKeys,
      countyID,
      countyName: safeCounty,
      queueUrl,
      pool,
      base36Encode,
      sqs,
    });

    const documentsCreated = result?.documentsCreated ?? 0;
    console.log(`[TIF Books Process] Step 7: Processing complete. Created ${documentsCreated} document(s)`);

    console.log('[TIF Books Process] Step 8: Returning success response');
    return res.json({
      status: 'processed',
      bookId,
      documentsCreated,
    });
  } catch (err) {
    console.error('[TIF Books Process] ERROR: TIF book process failed:', err);
    return res.status(500).json({ error: 'Failed to process TIF book' });
  }
});

export default app;


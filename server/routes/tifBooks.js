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
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));

  const keys = (out.Contents || [])
    .map(o => o.Key)
    .filter(Boolean);

  // Keep numeric order like 0001.tif, 0002.tif, or page_1.tif, page_2.tif
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
    let { bookId, countyName, files } = req.body || {};

    if (!countyName || typeof countyName !== 'string') {
      return res.status(400).json({ error: 'countyName is required' });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }

    // If the frontend didn't provide a bookId, generate a unique one here.
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
      const key = `${processingPrefix}${name}`;

      return {
        name,
        key,
        type: file.type || 'image/tiff',
        size: file.size ?? null,
      };
    });

    const bucket = await getS3BucketName();

    const uploads = await Promise.all(
      pages.map(async (page) => {
        const key = page.key;

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

    return res.json({
      bookId,
      processingPrefix,
      pages,
      uploads,
    });
  } catch (err) {
    console.error('TIF presign-batch failed:', err);
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

    // Kick off processing and await completion for now.
    const pool = await getPool();
    const queueUrl = await getAIProcessorQueueName();

    const result = await processTifBook({
      pageKeys,
      countyID,
      countyName: safeCounty,
      queueUrl,
      pool,
      base36Encode,
      sqs,
    });

    return res.json({
      status: 'processed',
      bookId,
      documentsCreated: result?.documentsCreated ?? 0,
    });
  } catch (err) {
    console.error('TIF book process failed:', err);
    return res.status(500).json({ error: 'Failed to process TIF book' });
  }
});

export default app;


import { getPool, getTifProcessQueueName } from '../../config.js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { listFilesByPrefix } from '../../lib/s3.js';

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });

function sanitizeCounty(countyName) {
  return countyName
    .replace(/\.\./g, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

/**
 * Enqueue a TIF book for processing.
 * Returns { bookId, status, message }.
 */
export async function enqueueProcess(bookId, countyID, countyName) {
  if (!bookId) {
    throw Object.assign(new Error('bookId path param is required'), { status: 400 });
  }
  if (!countyName) {
    throw Object.assign(new Error('countyName is required in body'), { status: 400 });
  }
  if (!countyID) {
    throw Object.assign(new Error('countyID is required in body'), { status: 400 });
  }

  const safeCounty = sanitizeCounty(countyName);
  const processingPrefix = `processing/${safeCounty}/${bookId}/`;

  const pageKeys = await listFilesByPrefix(processingPrefix, { logPrefix: 'TIF Books' });
  if (!pageKeys.length) {
    const err = new Error('No TIF pages found for book');
    err.status = 404;
    err.prefix = processingPrefix;
    throw err;
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

  return {
    bookId,
    status: 'pending',
    message: 'Job created and queued for processing',
  };
}

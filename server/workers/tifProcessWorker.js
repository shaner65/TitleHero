import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import {
  getPool,
  getTifProcessQueueName,
  getAIProcessorQueueName,
} from '../config.js';
import { processTifBook } from './tifBookSplitter.js';
import { base36Encode } from '../lib/base36.js';
import { listFilesByPrefix } from '../lib/s3.js';

const LOG_PREFIX = '[TIF Process Worker]';

/**
 * Parse and validate message body. Returns { bookId, countyID, countyName } or throws.
 */
function parseMessageBody(message) {
  const data = JSON.parse(message.Body);
  const { bookId, countyID, countyName } = data;
  if (!bookId || !countyID || !countyName) {
    throw new Error('Missing required fields in message');
  }
  return { bookId, countyID, countyName };
}

/**
 * Get current job status for a bookId. Returns status string or null if no row.
 */
async function getJobStatus(pool, bookId) {
  const [rows] = await pool.execute(
    `SELECT status FROM TIF_Process_Job WHERE book_id = ?`,
    [bookId]
  );
  return rows.length ? rows[0].status : null;
}

/**
 * Delete a message from the SQS queue.
 */
async function deleteQueueMessage(sqs, queueUrl, receiptHandle) {
  await sqs.send(new DeleteMessageCommand({
    QueueUrl: queueUrl,
    ReceiptHandle: receiptHandle,
  }));
}

/**
 * Process a single TIF book job. Updates job status and processes pages.
 */
async function processBookJob({ bookId, countyID, countyName }, { pool, sqs, aiProcessorQueueUrl }) {
  await pool.execute(
    `UPDATE TIF_Process_Job
     SET status = 'processing', updated_at = CURRENT_TIMESTAMP
     WHERE book_id = ?`,
    [bookId]
  );
  console.log(`${LOG_PREFIX} Processing bookId=${bookId}, county=${countyName}`);

  const processingPrefix = `processing/${countyName}/${bookId}/`;
  const pageKeys = await listFilesByPrefix(processingPrefix);
  if (!pageKeys.length) {
    throw new Error(`No TIF pages found for book at prefix: ${processingPrefix}`);
  }

  await pool.execute(
    `UPDATE TIF_Process_Job SET pages_total = ?, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
    [pageKeys.length, bookId]
  );

  const result = await processTifBook({
    bookId,
    pageKeys,
    countyID,
    countyName,
    queueUrl: aiProcessorQueueUrl,
    pool,
    base36Encode,
    sqs,
  });

  const documentsCreated = result?.documentsCreated ?? 0;
  await pool.execute(
    `UPDATE TIF_Process_Job
     SET status = 'completed',
         documents_created = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE book_id = ?`,
    [documentsCreated, bookId]
  );

  return documentsCreated;
}

/**
 * Mark a job as failed in the database.
 */
async function markJobFailed(pool, bookId, errorMessage) {
  const truncated = (errorMessage || '').substring(0, 1000);
  await pool.execute(
    `UPDATE TIF_Process_Job
     SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE book_id = ?`,
    [truncated, bookId]
  );
}

/**
 * Handle a single SQS message: parse, process, and delete (or handle failures).
 */
async function handleMessage(message, context) {
  const { pool, sqs, queueUrl } = context;
  const receiptHandle = message.ReceiptHandle;

  let jobData;
  try {
    jobData = parseMessageBody(message);
  } catch (err) {
    console.error(`${LOG_PREFIX} Invalid message, deleting:`, err.message);
    await deleteQueueMessage(sqs, queueUrl, receiptHandle);
    return;
  }

  const { bookId } = jobData;

  const existingStatus = await getJobStatus(pool, bookId);
  if (existingStatus === 'completed' || existingStatus === 'processing') {
    console.log(`${LOG_PREFIX} Skipping bookId=${bookId}, already ${existingStatus}`);
    await deleteQueueMessage(sqs, queueUrl, receiptHandle);
    return;
  }

  try {
    const documentsCreated = await processBookJob(jobData, context);
    await deleteQueueMessage(sqs, queueUrl, receiptHandle);
    console.log(`${LOG_PREFIX} Completed bookId=${bookId}, documentsCreated=${documentsCreated}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed bookId=${bookId}:`, err.message);
    await markJobFailed(pool, bookId, err.message);
    await deleteQueueMessage(sqs, queueUrl, receiptHandle);
    console.log(`${LOG_PREFIX} Job marked failed and message deleted for bookId=${bookId}`);
  }
}

/**
 * Poll the SQS queue and process messages.
 */
async function pollLoop(context) {
  const { sqs, queueUrl } = context;

  while (true) {
    try {
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 1200,
      }));

      const messages = response.Messages || [];
      if (messages.length === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const message of messages) {
        await handleMessage(message, context);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Unexpected error:`, err);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

async function main() {
  const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });
  const queueUrl = await getTifProcessQueueName();
  const pool = await getPool();
  const aiProcessorQueueUrl = await getAIProcessorQueueName();

  const context = {
    pool,
    sqs,
    queueUrl,
    aiProcessorQueueUrl,
  };

  console.log(`${LOG_PREFIX} started, polling SQS`);
  await pollLoop(context);
}

main().catch(console.error);

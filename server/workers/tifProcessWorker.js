import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  getPool,
  getTifProcessQueueName,
  getAIProcessorQueueName,
  getS3BucketName,
} from '../config.js';
import { processTifBook } from './tifBookSplitter.js';

let sqs;
let TIF_PROCESS_QUEUE;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

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

async function listFilesByPrefixProcessing(prefix) {
  console.log(`[TIF Process Worker] Listing files with prefix: ${prefix}`);
  const BUCKET = await getS3BucketName();
  console.log(`[TIF Process Worker] Querying S3 bucket: ${BUCKET}`);
  
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));

  const keys = (out.Contents || [])
    .map(o => o.Key)
    .filter(Boolean);

  console.log(`[TIF Process Worker] Found ${keys.length} raw file(s) before sorting`);

  // Keep numeric order like 0001.tif, 0002.tif, or page_1.tif, page_2.tif
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  console.log(`[TIF Process Worker] Returning ${keys.length} sorted file key(s)`);
  return keys;
}

async function main() {
  console.log('[TIF Process Worker] Started, polling SQS...');

  const awsRegion = process.env.AWS_REGION || 'us-east-2';
  sqs = new SQSClient({ region: awsRegion });

  TIF_PROCESS_QUEUE = await getTifProcessQueueName();
  console.log(`[TIF Process Worker] Queue URL: ${TIF_PROCESS_QUEUE}`);

  const pool = await getPool();
  const aiProcessorQueueUrl = await getAIProcessorQueueName();

  while (true) {
    try {
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: TIF_PROCESS_QUEUE,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 300, // 5 minutes - TIF processing can take a while
      });
      const response = await sqs.send(receiveCommand);

      const messages = response.Messages || [];
      if (messages.length === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const message of messages) {
        const receiptHandle = message.ReceiptHandle;
        const body = message.Body;

        let bookId, countyID, countyName;
        try {
          const data = JSON.parse(body);
          bookId = data.bookId;
          countyID = data.countyID;
          countyName = data.countyName;

          if (!bookId || !countyID || !countyName) {
            throw new Error('Missing required fields in message');
          }
        } catch (err) {
          console.error('[TIF Process Worker] ERROR: Failed to parse message:', err);
          // Delete malformed message
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          });
          await sqs.send(deleteCommand);
          continue;
        }

        try {
          console.log(`[TIF Process Worker] Processing book: ${bookId} for county ${countyID} (${countyName})`);

          // Update job status to 'processing'
          await pool.execute(
            `UPDATE TIF_Process_Job
             SET status = 'processing', updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ?`,
            [bookId]
          );
          console.log(`[TIF Process Worker] Updated job status to 'processing' for bookId: ${bookId}`);

          // List TIF pages from S3
          const processingPrefix = `processing/${countyName}/${bookId}/`;
          const pageKeys = await listFilesByPrefixProcessing(processingPrefix);

          if (!pageKeys.length) {
            throw new Error(`No TIF pages found for book at prefix: ${processingPrefix}`);
          }

          console.log(`[TIF Process Worker] Found ${pageKeys.length} page(s) for processing`);

          // Process the TIF book
          const result = await processTifBook({
            pageKeys,
            countyID,
            countyName,
            queueUrl: aiProcessorQueueUrl,
            pool,
            base36Encode,
            sqs,
          });

          const documentsCreated = result?.documentsCreated ?? 0;
          console.log(`[TIF Process Worker] Processing complete. Created ${documentsCreated} document(s)`);

          // Update job status to 'completed'
          await pool.execute(
            `UPDATE TIF_Process_Job
             SET status = 'completed',
                 documents_created = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ?`,
            [documentsCreated, bookId]
          );
          console.log(`[TIF Process Worker] Updated job status to 'completed' for bookId: ${bookId}`);

          // Delete message from queue
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          });
          await sqs.send(deleteCommand);
          console.log(`[TIF Process Worker] Message deleted from queue for bookId: ${bookId}`);

        } catch (err) {
          console.error(`[TIF Process Worker] ERROR: Failed to process book ${bookId}:`, err);

          // Update job status to 'failed'
          const errorMessage = err.message || String(err);
          await pool.execute(
            `UPDATE TIF_Process_Job
             SET status = 'failed',
                 error = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ?`,
            [errorMessage.substring(0, 1000), bookId] // Limit error message length
          );
          console.log(`[TIF Process Worker] Updated job status to 'failed' for bookId: ${bookId}`);

          // Delete message from queue (don't retry automatically - manual intervention needed)
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          });
          await sqs.send(deleteCommand);
          console.log(`[TIF Process Worker] Failed message deleted from queue for bookId: ${bookId}`);
        }
      }
    } catch (err) {
      console.error('[TIF Process Worker] Unexpected error:', err);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

main().catch(console.error);

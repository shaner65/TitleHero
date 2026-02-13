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
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix
  }));
  const keys = (out.Contents || [])
    .map(o => o.Key)
    .filter(Boolean);
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return keys;
}

async function main() {
  const awsRegion = process.env.AWS_REGION || 'us-east-2';
  sqs = new SQSClient({ region: awsRegion });
  TIF_PROCESS_QUEUE = await getTifProcessQueueName();
  const pool = await getPool();
  const aiProcessorQueueUrl = await getAIProcessorQueueName();
  console.log('[TIF Process Worker] started, polling SQS');

  while (true) {
    try {
      const response = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: TIF_PROCESS_QUEUE,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 300,
      }));

      const messages = response.Messages || [];
      if (messages.length === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      for (const message of messages) {
        const receiptHandle = message.ReceiptHandle;
  
        let bookId, countyID, countyName;
        try {
          const data = JSON.parse(message.Body);
          bookId = data.bookId;
          countyID = data.countyID;
          countyName = data.countyName;
          if (!bookId || !countyID || !countyName) {
            throw new Error('Missing required fields in message');
          }
        } catch (err) {
          console.error('[TIF Process Worker] Invalid message, deleting:', err.message);
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          }));
          continue;
        }

        try {
          await pool.execute(
            `UPDATE TIF_Process_Job
             SET status = 'processing', updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ?`,
            [bookId]
          );
          console.log(`[TIF Process Worker] Processing bookId=${bookId}, county=${countyName}`);

          const processingPrefix = `processing/${countyName}/${bookId}/`;
          const pageKeys = await listFilesByPrefixProcessing(processingPrefix);
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

          await sqs.send(new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          }));

          console.log(`[TIF Process Worker] Completed bookId=${bookId}, documentsCreated=${documentsCreated}`);
        } catch (err) {
          console.error(`[TIF Process Worker] Failed bookId=${bookId}:`, err.message);
          const errorMessage = (err.message || String(err)).substring(0, 1000);
          await pool.execute(
            `UPDATE TIF_Process_Job
             SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
             WHERE book_id = ?`,
            [errorMessage, bookId]
          );
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: TIF_PROCESS_QUEUE,
            ReceiptHandle: receiptHandle,
          }));
          console.log(`[TIF Process Worker] Job marked failed and message deleted for bookId=${bookId}`);
        }
      }
    } catch (err) {
      console.error('[TIF Process Worker] Unexpected error:', err);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

main().catch(console.error);

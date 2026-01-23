import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

import {
  getPool,
  getDbUpdaterQueueName
} from '../config.js';

import {
  isMessageProcessed,
  markMessageProcessed
} from './processMessage.js';

let sqs;
let DB_UPDATER_QUEUE;

async function insertRecord(connection, data) {
  const doc = data;

  const values = [
    doc.documentID,
    doc.abstractID || null,
    doc.abstractCode || null,
    doc.bookTypeID || null,
    doc.subdivisionID || null,
    doc.countyID || null,
    doc.instrumentNumber || null,
    doc.book || null,
    doc.volume || null,
    doc.page || null,
    doc.instrumentType || null,
    doc.remarks || null,
    doc.lienAmount || null,
    doc.legalDescription || null,
    doc.subBlock || null,
    doc.abstractText || null,
    doc.acres || null,
    doc.fileStampDate || null,
    doc.filingDate || null,
    doc.nFileReference || null,
    doc.finalizedBy || null,
    doc.exportFlag || 2,
    doc.propertyType || null,
    doc.GFNNumber || null,
    doc.marketShare || null,
    doc.sortArray || null,
    doc.address || null,
    doc.CADNumber || null,
    doc.CADNumber2 || null,
    doc.GLOLink || null,
    doc.fieldNotes || null,
    doc.PRSERV || null,
    doc.clerkNumber || null,
    JSON.stringify(doc.metadata || {}) || null,
  ];

  const sql = `
    INSERT INTO documents (
      documentID, abstractID, abstractCode, bookTypeID, subdivisionID, countyID,
      instrumentNumber, book, volume, page, instrumentType, remarks, lienAmount,
      legalDescription, subBlock, abstractText, acres, fileStampDate, filingDate,
      nFileReference, finalizedBy, exportFlag, propertyType, GFNNumber, marketShare,
      sortArray, address, CADNumber, CADNumber2, GLOLink, fieldNotes,
      PRSERV, clerkNumber, metadata, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
    )
    ON DUPLICATE KEY UPDATE
      abstractID=VALUES(abstractID),
      abstractCode=VALUES(abstractCode),
      bookTypeID=VALUES(bookTypeID),
      subdivisionID=VALUES(subdivisionID),
      countyID=VALUES(countyID),
      instrumentNumber=VALUES(instrumentNumber),
      book=VALUES(book),
      volume=VALUES(volume),
      page=VALUES(page),
      instrumentType=VALUES(instrumentType),
      remarks=VALUES(remarks),
      lienAmount=VALUES(lienAmount),
      legalDescription=VALUES(legalDescription),
      subBlock=VALUES(subBlock),
      abstractText=VALUES(abstractText),
      acres=VALUES(acres),
      fileStampDate=VALUES(fileStampDate),
      filingDate=VALUES(filingDate),
      nFileReference=VALUES(nFileReference),
      finalizedBy=VALUES(finalizedBy),
      exportFlag=VALUES(exportFlag),
      propertyType=VALUES(propertyType),
      GFNNumber=VALUES(GFNNumber),
      marketShare=VALUES(marketShare),
      sortArray=VALUES(sortArray),
      address=VALUES(address),
      CADNumber=VALUES(CADNumber),
      CADNumber2=VALUES(CADNumber2),
      GLOLink=VALUES(GLOLink),
      fieldNotes=VALUES(fieldNotes),
      PRSERV=VALUES(PRSERV),
      clerkNumber=VALUES(clerkNumber),
      metadata=VALUES(metadata),
      updated_at=NOW()
  `;

  await connection.execute(sql, values);

  // Insert grantors
  if (Array.isArray(doc.grantor)) {
    for (const name of doc.grantor) {
      if (name) {
        await connection.execute(
          'INSERT IGNORE INTO party (documentID, name, role, countyID) VALUES (?, ?, ?, ?)',
          [doc.documentID, name, 'Grantor', doc.countyID]
        );
      }
    }
  }

  // Insert grantees
  if (Array.isArray(doc.grantee)) {
    for (const name of doc.grantee) {
      if (name) {
        await connection.execute(
          'INSERT IGNORE INTO party (documentID, name, role, countyID) VALUES (?, ?, ?, ?)',
          [doc.documentID, name, 'Grantee', doc.countyID]
        );
      }
    }
  }
}

async function processMessage(data) {
  try {
    if (!data || !data.documentID) {
      console.error('Invalid message format: missing documentID or data');
      return false;
    }

    const pool = await getPool();
    const connection = await pool.getConnection();

    try {
      await insertRecord(connection, data);
    } finally {
      connection.release();
    }
    return true;
  } catch (err) {
    console.error('Error processing message:', err);
    return false;
  }
}

async function main() {
  console.log('DB Updater started, polling SQS...');

  const awsRegion = process.env.AWS_REGION || 'us-east-2';
  sqs = new SQSClient({ region: awsRegion });

  DB_UPDATER_QUEUE = await getDbUpdaterQueueName();

  while (true) {
    try {
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: DB_UPDATER_QUEUE,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: 30,
      });
      const response = await sqs.send(receiveCommand);

      const messages = response.Messages || [];
      if (messages.length === 0) {
        await new Promise(res => setTimeout(res, 5000));
        continue;
      }

      for (const message of messages) {
        const receiptHandle = message.ReceiptHandle;
        const body = message.Body;

        if (await isMessageProcessed(body, 'db-updater-queue')) {
          console.log('Duplicate message detected, deleting from queue.');
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: DB_UPDATER_QUEUE,
            ReceiptHandle: receiptHandle,
          });
          await sqs.send(deleteCommand);
          continue;
        }

        const data = JSON.parse(body);

        const success = await processMessage(data);
        if (!success) {
          console.log('Leaving message in queue for retry.');
        } else {
          await markMessageProcessed(body, 'db-updater-queue');
          const deleteCommand = new DeleteMessageCommand({
            QueueUrl: DB_UPDATER_QUEUE,
            ReceiptHandle: receiptHandle,
          });
          await sqs.send(deleteCommand);
        }
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      await new Promise(res => setTimeout(res, 10000));
    }
  }
}

main().catch(console.error);
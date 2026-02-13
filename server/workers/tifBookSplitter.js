import OpenAI from 'openai';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3BucketName, getOpenAPIKey } from '../config.js';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

async function getObjectBufferLocal(Key) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
  const buffer = out.Body?.transformToByteArray
    ? Buffer.from(await out.Body.transformToByteArray())
    : Buffer.from(await out.Body.arrayBuffer());
  console.log(`[TIF Splitter] Fetched S3 object: ${Key} (${buffer.length} bytes)`);
  return buffer;
}

async function prepareImageFromS3(key) {
  const buffer = await getObjectBufferLocal(key);
  const pngBuffer = await sharp(buffer)
    .resize(2500)
    .png()
    .toBuffer();
  console.log(`[TIF Splitter] Prepared image for AI: ${key} (${pngBuffer.length} bytes PNG)`);
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

async function runVerticalAudit(pageKeys) {
  const apiKey = await getOpenAPIKey();
  if (!apiKey) {
    console.error('[TIF Splitter] ERROR: OpenAI API key is not configured');
    throw new Error('OpenAI API key is not configured');
  }

  const openai = new OpenAI({ apiKey });
  const BATCH_SIZE = 1;
  const allFiles = [...pageKeys];
  let combinedResults = [];

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    if (!batch.length) break;

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    try {
      const images = await Promise.all(batch.map((key) => prepareImageFromS3(key)));

      const content = [
        {
          type: 'text',
          text: `
                You are a specialized Land Records Auditor.

                TASK:
                Scan each page for ALL official filing/recording stamps.

                DETECTION RULES:
                • A page may contain ZERO, ONE, or MULTIPLE valid filing stamps.
                • A valid stamp must clearly contain the word "FILED" (e.g., "FILED", "FILED ON", "FILED FOR RECORD").
                • If "FILED" (or a variation) appears close to "DULY RECORDED", "DULY NOTED", or similar wording,
                they MUST be treated as the SAME single stamp — not separate entries.
                • You MUST return EACH valid filing stamp as a separate entry.
                • Do NOT stop after finding the first one.
                • Scan the full Y-axis from 0% (top) to 100% (bottom).

                ANTI-HALLUCINATION RULES:
                • Only report stamps that are clearly visible and legible.
                • Do NOT guess, fabricate, or infer anything.
                • If no valid filing stamps are found, return stamps_detected: [].
                • Blurry, partial, or unreadable marks must NOT be reported.

                OUTPUT:
                • Each entry must include y_pos_percent, transcription, and visual_context.
            `,
        },
      ];

      images.forEach((url, index) => {
        const absPage = allFiles.indexOf(batch[index]) + 1;

        content.push({
          type: 'text',
          text: `IMAGE_IDENTIFIER: ${batch[index]} | PAGE_NUMBER: ${absPage}`,
        });
        content.push({ type: 'image_url', image_url: { url, detail: 'high' } });
      });

      const terminationSchema = {
        name: 'vertical_audit_results',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            pages: {
              type: 'array',
              description: 'Results for each page analyzed.',
              items: {
                type: 'object',
                properties: {
                  filename: {
                    type: 'string',
                    description: 'The image filename this result corresponds to.',
                  },
                  page_number: {
                    type: 'number',
                    description: 'Absolute page number in the full document set (1-based).',
                  },
                  stamps_detected: {
                    type: 'array',
                    description:
                      "ALL 'FILED FOR RECORD' stamps found on this page. May be empty or contain multiple entries. Do NOT collapse stamps into one.",
                    items: {
                      type: 'object',
                      properties: {
                        y_pos_percent: {
                          type: 'number',
                          description: 'Vertical position of the stamp from 0 (top) to 100 (bottom).',
                        },
                        transcription: {
                          type: 'string',
                          description: 'Full text of this single stamp only. Do not merge two stamps.',
                        },
                        visual_context: {
                          type: 'string',
                          description:
                            'What immediately follows the stamp (e.g., white space, body text, bottom of page).',
                        },
                      },
                      required: ['y_pos_percent', 'transcription', 'visual_context'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['filename', 'page_number', 'stamps_detected'],
                additionalProperties: false,
              },
            },
          },
          required: ['pages'],
          additionalProperties: false,
        },
      };

      const response = await openai.chat.completions.create({
        model: 'gpt-5',
        messages: [{ role: 'user', content }],
        response_format: { type: 'json_schema', json_schema: terminationSchema },
      });

      const raw = JSON.parse(response.choices[0].message.content);
      if (raw && Array.isArray(raw.pages)) {
        combinedResults = combinedResults.concat(raw.pages);
        const stampsFound = raw.pages.reduce((sum, p) => sum + (p.stamps_detected?.length || 0), 0);
        console.log(`[TIF Splitter] Vertical audit batch ${batchNum}: ${raw.pages.length} page(s), ${stampsFound} stamp(s) detected`);
      } else {
        console.warn(`[TIF Splitter] Vertical audit batch ${batchNum}: unexpected response format`);
      }
    } catch (error) {
      console.error(`[TIF Splitter] ERROR: Vertical audit batch ${batchNum} failed:`, error.message);
    }
  }

  // Normalize into { key, pageNumber, stamps: [...] }
  const pages = combinedResults.map((p) => {
    const pageNumber = Number(p.page_number);
    const key = pageKeys[pageNumber - 1] || null;
    return {
      key,
      pageNumber,
      stamps: Array.isArray(p.stamps_detected) ? p.stamps_detected : [],
    };
  });

  const totalStamps = pages.reduce((sum, p) => sum + p.stamps.length, 0);
  const filteredPages = pages.filter((p) => p.key);
  console.log(`[TIF Splitter] Vertical audit done: ${filteredPages.length} page(s), ${totalStamps} stamp(s) total`);
  return filteredPages;
}

/**
 * Compute logical document slices from per-page stamp detections.
 * Each stamp marks the END of the current document. Content below
 * the last stamp on a page belongs to the next document.
 */
function computeDocumentSlices(pages) {
  const documents = [];
  let currentDoc = null;

  const ensureCurrentDoc = () => {
    if (!currentDoc) {
      currentDoc = { slices: [] };
    }
  };

  for (const page of pages) {
    const stamps = [...(page.stamps || [])].sort(
      (a, b) => Number(a.y_pos_percent) - Number(b.y_pos_percent),
    );

    let yCursor = 0;

    if (!stamps.length) {
      ensureCurrentDoc();
      currentDoc.slices.push({
        key: page.key,
        pageNumber: page.pageNumber,
        yStartPercent: 0,
        yEndPercent: 100,
      });
      continue;
    }

    for (const stamp of stamps) {
      const y = Math.max(0, Math.min(100, Number(stamp.y_pos_percent)));

      if (y > yCursor) {
        ensureCurrentDoc();
        currentDoc.slices.push({
          key: page.key,
          pageNumber: page.pageNumber,
          yStartPercent: yCursor,
          yEndPercent: y,
        });
      }

      if (currentDoc && currentDoc.slices.length) {
        documents.push(currentDoc);
      }

      currentDoc = null;
      yCursor = y;
    }

    if (yCursor < 100) {
      ensureCurrentDoc();
      currentDoc.slices.push({
        key: page.key,
        pageNumber: page.pageNumber,
        yStartPercent: yCursor,
        yEndPercent: 100,
      });
    }
  }

  if (currentDoc && currentDoc.slices.length) {
    documents.push(currentDoc);
  }

  console.log(`[TIF Splitter] Document slices computed: ${documents.length} document(s) from ${pages.length} page(s)`);
  return documents;
}

function roundToNearest25(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(clamped / 25) * 25;
  return Math.max(0, Math.min(100, rounded));
}

async function renderSliceToPng(buffer, yStartPercent, yEndPercent) {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const height = metadata.height || 1;
  const width = metadata.width || 1;

  let snappedStart = roundToNearest25(yStartPercent);
  let snappedEnd = roundToNearest25(yEndPercent);

  if (snappedEnd <= snappedStart) {
    snappedEnd = Math.min(100, snappedStart + 25);
  }

  const yStartPx = Math.max(0, Math.round((height * snappedStart) / 100));
  let yEndPx = Math.max(yStartPx + 1, Math.round((height * snappedEnd) / 100));
  yEndPx = Math.min(height, yEndPx);
  const sliceHeight = Math.min(height - yStartPx, yEndPx - yStartPx);

  if (sliceHeight < 1) {
    return null;
  }

  const sliceBuffer = await sharp(buffer)
    .extract({ left: 0, top: yStartPx, width, height: sliceHeight })
    .png()
    .toBuffer();

  return { sliceBuffer, width, height: sliceHeight };
}

async function buildDocumentPdf(slices, pageCache) {
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    let pageEntry = pageCache.get(slice.key);

    if (!pageEntry) {
      const buffer = await getObjectBufferLocal(slice.key);
      pageEntry = { buffer };
      pageCache.set(slice.key, pageEntry);
    }

    const sliceResult = await renderSliceToPng(
      pageEntry.buffer,
      slice.yStartPercent,
      slice.yEndPercent,
    );

    if (sliceResult === null) {
      continue;
    }

    const { sliceBuffer } = sliceResult;
    const pngImage = await pdfDoc.embedPng(sliceBuffer);
    const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  console.log(`[TIF Splitter] PDF built: ${slices.length} slice(s), ${pdfBuffer.length} bytes`);
  return pdfBuffer;
}

async function uploadPdfToS3(buffer, countyName, PRSERV) {
  const BUCKET = await getS3BucketName();
  const key = `${countyName}/${PRSERV}.pdf`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    }),
  );
  console.log(`[TIF Splitter] PDF uploaded to S3: ${key}`);
  return key;
}

async function sendToAIProcessorQueue(sqs, queueUrl, payload) {
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(payload),
  });
  await sqs.send(command);
  console.log(`[TIF Splitter] Document queued for AI: documentID=${payload.document_id}, PRSERV=${payload.PRSERV}`);
}

export async function processTifBook({
  bookId,
  pageKeys,
  countyID,
  countyName,
  queueUrl,
  pool,
  base36Encode,
  sqs,
}) {
  console.log(`[TIF Splitter] Starting: bookId=${bookId}, ${pageKeys.length} page(s), county=${countyName}`);

  if (!Array.isArray(pageKeys) || !pageKeys.length) {
    console.error('[TIF Splitter] ERROR: pageKeys must be a non-empty array');
    throw new Error('pageKeys must be a non-empty array');
  }

  const verticalPages = await runVerticalAudit(pageKeys);

  if (!verticalPages.length) {
    console.error('[TIF Splitter] ERROR: Vertical audit returned no pages or stamps');
    throw new Error('Vertical audit returned no pages or stamps; refusing to process entire book as one document.');
  }

  const result = await finalizeDocuments(verticalPages, countyID, countyName, queueUrl, pool, base36Encode, sqs, bookId);
  console.log(`[TIF Splitter] Done: ${result.documentsCreated} document(s) created and queued`);
  return result;
}

async function finalizeDocuments(pages, countyID, countyName, queueUrl, pool, base36Encode, sqs, bookId) {
  const docs = computeDocumentSlices(pages);
  const pageCache = new Map();
  let documentsCreated = 0;
  const totalDocs = docs.length;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc.slices || !doc.slices.length) {
      continue;
    }

    const pdfBuffer = await buildDocumentPdf(doc.slices, pageCache);

    const [result] = await pool.execute(
      `
        INSERT INTO Document (countyID, exportFlag)
        VALUES (?, 1)
      `,
      [countyID],
    );

    const documentID = result.insertId;
    const PRSERV = base36Encode(documentID);

    const key = await uploadPdfToS3(pdfBuffer, countyName, PRSERV);

    // Queue for AI processor
    await sendToAIProcessorQueue(sqs, queueUrl, {
      document_id: documentID,
      PRSERV,
      county_name: countyName,
      county_id: countyID,
      key,
    });

    documentsCreated += 1;

    if (bookId) {
      await pool.execute(
        `UPDATE TIF_Process_Job SET documents_queued_for_ai = ?, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
        [documentsCreated, bookId]
      );
    }

    console.log(`[TIF Splitter] Document ${i + 1}/${totalDocs} finalized: ID=${documentID}, PRSERV=${PRSERV}`);
  }

  return { documentsCreated };
}
import OpenAI from 'openai';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3BucketName, getOpenAPIKey } from '../config.js';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

async function getObjectBufferLocal(Key) {
  console.log(`[TIF Splitter] Fetching object from S3: ${Key}`);
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
  const buffer = out.Body?.transformToByteArray
    ? Buffer.from(await out.Body.transformToByteArray())
    : Buffer.from(await out.Body.arrayBuffer());
  console.log(`[TIF Splitter] Retrieved ${buffer.length} bytes from S3`);
  return buffer;
}

async function prepareImageFromS3(key) {
  console.log(`[TIF Splitter] Preparing image for AI analysis: ${key}`);
  const buffer = await getObjectBufferLocal(key);

  console.log(`[TIF Splitter] Converting image to PNG (resized to 2500px max dimension)`);
  const pngBuffer = await sharp(buffer)
    .resize(2500)
    .png()
    .toBuffer();

  console.log(`[TIF Splitter] Image prepared: ${pngBuffer.length} bytes PNG, converted to base64`);
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

async function runVerticalAudit(pageKeys) {
  console.log(`[TIF Splitter] Starting vertical audit for ${pageKeys.length} page(s)`);
  const apiKey = await getOpenAPIKey();
  if (!apiKey) {
    console.error('[TIF Splitter] ERROR: OpenAI API key is not configured');
    throw new Error('OpenAI API key is not configured');
  }

  console.log('[TIF Splitter] Initializing OpenAI client');
  const openai = new OpenAI({ apiKey });

  const BATCH_SIZE = 1;
  const allFiles = [...pageKeys];
  let combinedResults = [];
  const totalBatches = Math.ceil(allFiles.length / BATCH_SIZE);
  console.log(`[TIF Splitter] Processing ${totalBatches} batch(es) of ${BATCH_SIZE} page(s) each`);

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    if (!batch.length) break;

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(`[TIF Splitter] Processing batch ${batchNum}/${totalBatches}`);

    try {
      console.log(`[TIF Splitter] Preparing ${batch.length} image(s) for AI analysis`);
      const images = await Promise.all(batch.map((key) => prepareImageFromS3(key)));
      console.log(`[TIF Splitter] Images prepared, sending to OpenAI GPT-5 for stamp detection`);

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

      console.log(`[TIF Splitter] Received response from OpenAI for batch ${batchNum}`);
      const raw = JSON.parse(response.choices[0].message.content);
      if (raw && Array.isArray(raw.pages)) {
        const stampsFound = raw.pages.reduce((sum, p) => sum + (p.stamps_detected?.length || 0), 0);
        console.log(`[TIF Splitter] Batch ${batchNum}: Found ${stampsFound} stamp(s) across ${raw.pages.length} page(s)`);
        combinedResults = combinedResults.concat(raw.pages);
      } else {
        console.warn(`[TIF Splitter] Batch ${batchNum}: Unexpected response format from OpenAI`);
      }
    } catch (error) {
      console.error(`[TIF Splitter] ERROR: Vertical audit batch ${batchNum} failed:`, error.message);
    }
  }

  console.log(`[TIF Splitter] Vertical audit complete. Processing ${combinedResults.length} page result(s)`);
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
  console.log(`[TIF Splitter] Normalized results: ${pages.length} page(s) with ${totalStamps} total stamp(s)`);
  const filteredPages = pages.filter((p) => p.key);
  console.log(`[TIF Splitter] Returning ${filteredPages.length} valid page(s)`);
  return filteredPages;
}

/**
 * Compute logical document slices from per-page stamp detections.
 * Each stamp marks the END of the current document. Content below
 * the last stamp on a page belongs to the next document.
 */
function computeDocumentSlices(pages) {
  console.log(`[TIF Splitter] Computing document slices from ${pages.length} page(s)`);
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
      // Whole page belongs to current document
      console.log(`[TIF Splitter] Page ${page.pageNumber} (${page.key}): No stamps found, adding entire page to current document`);
      ensureCurrentDoc();
      currentDoc.slices.push({
        key: page.key,
        pageNumber: page.pageNumber,
        yStartPercent: 0,
        yEndPercent: 100,
      });
      continue;
    }

    console.log(`[TIF Splitter] Page ${page.pageNumber} (${page.key}): Processing ${stamps.length} stamp(s)`);
    for (const stamp of stamps) {
      const y = Math.max(0, Math.min(100, Number(stamp.y_pos_percent)));
      console.log(`[TIF Splitter]   Stamp at ${y}%: "${stamp.transcription?.substring(0, 50)}..."`);

      if (y > yCursor) {
        // Content from yCursor -> y belongs to current doc
        ensureCurrentDoc();
        currentDoc.slices.push({
          key: page.key,
          pageNumber: page.pageNumber,
          yStartPercent: yCursor,
          yEndPercent: y,
        });
        console.log(`[TIF Splitter]   Added slice ${yCursor}%-${y}% to current document`);
      }

      // Stamp ends the current document
      if (currentDoc && currentDoc.slices.length) {
        console.log(`[TIF Splitter]   Finalizing document with ${currentDoc.slices.length} slice(s)`);
        documents.push(currentDoc);
      }

      currentDoc = null;
      yCursor = y;
    }

    // Anything after last stamp on this page starts/continues the next document
    if (yCursor < 100) {
      ensureCurrentDoc();
      currentDoc.slices.push({
        key: page.key,
        pageNumber: page.pageNumber,
        yStartPercent: yCursor,
        yEndPercent: 100,
      });
      console.log(`[TIF Splitter]   Added remaining slice ${yCursor}%-100% to next document`);
    }
  }

  if (currentDoc && currentDoc.slices.length) {
    console.log(`[TIF Splitter] Finalizing final document with ${currentDoc.slices.length} slice(s)`);
    documents.push(currentDoc);
  }

  console.log(`[TIF Splitter] Document slice computation complete: ${documents.length} document(s) created`);
  return documents;
}

function roundToNearest25(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(clamped / 25) * 25;
  return Math.max(0, Math.min(100, rounded));
}

async function renderSliceToPng(buffer, yStartPercent, yEndPercent) {
  console.log(`[TIF Splitter] Rendering slice: ${yStartPercent}% to ${yEndPercent}%`);
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const height = metadata.height || 1;
  const width = metadata.width || 1;
  console.log(`[TIF Splitter]   Image dimensions: ${width}x${height}px`);

  // Snap slice boundaries to the nearest 25% buckets (0, 25, 50, 75, 100)
  let snappedStart = roundToNearest25(yStartPercent);
  let snappedEnd = roundToNearest25(yEndPercent);

  if (snappedEnd <= snappedStart) {
    snappedEnd = Math.min(100, snappedStart + 25);
  }
  console.log(`[TIF Splitter]   Snapped boundaries: ${snappedStart}% to ${snappedEnd}%`);

  const yStartPx = Math.max(0, Math.round((height * snappedStart) / 100));
  const yEndPx = Math.max(yStartPx + 1, Math.round((height * snappedEnd) / 100));
  const sliceHeight = Math.min(height - yStartPx, yEndPx - yStartPx);
  console.log(`[TIF Splitter]   Pixel range: y=${yStartPx}px to y=${yEndPx}px (height=${sliceHeight}px)`);

  const sliceBuffer = await sharp(buffer)
    .extract({ left: 0, top: yStartPx, width, height: sliceHeight })
    .png()
    .toBuffer();

  console.log(`[TIF Splitter]   Slice rendered: ${sliceBuffer.length} bytes PNG`);
  return { sliceBuffer, width, height: sliceHeight };
}

async function buildDocumentPdf(slices, pageCache) {
  console.log(`[TIF Splitter] Building PDF document from ${slices.length} slice(s)`);
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    console.log(`[TIF Splitter] Processing slice ${i + 1}/${slices.length} (page ${slice.pageNumber}, ${slice.yStartPercent}%-${slice.yEndPercent}%)`);
    
    let pageEntry = pageCache.get(slice.key);

    if (!pageEntry) {
      console.log(`[TIF Splitter]   Cache miss for ${slice.key}, fetching from S3`);
      const buffer = await getObjectBufferLocal(slice.key);
      pageEntry = { buffer };
      pageCache.set(slice.key, pageEntry);
    } else {
      console.log(`[TIF Splitter]   Cache hit for ${slice.key}`);
    }

    const { sliceBuffer, width, height } = await renderSliceToPng(
      pageEntry.buffer,
      slice.yStartPercent,
      slice.yEndPercent,
    );

    console.log(`[TIF Splitter]   Embedding PNG slice into PDF (${width}x${height}px)`);
    const pngImage = await pdfDoc.embedPng(sliceBuffer);
    const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pngImage.width,
      height: pngImage.height,
    });
  }

  console.log(`[TIF Splitter] Saving PDF document`);
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);
  console.log(`[TIF Splitter] PDF document built: ${pdfBuffer.length} bytes`);
  return pdfBuffer;
}

async function uploadPdfToS3(buffer, countyName, PRSERV) {
  const BUCKET = await getS3BucketName();
  const key = `${countyName}/${PRSERV}.pdf`;
  console.log(`[TIF Splitter] Uploading PDF to S3: ${key} (${buffer.length} bytes)`);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/pdf',
    }),
  );

  console.log(`[TIF Splitter] PDF uploaded successfully to S3: ${key}`);
  return key;
}

async function sendToAIProcessorQueue(sqs, queueUrl, payload) {
  console.log(`[TIF Splitter] Sending document to AI processor queue: documentID=${payload.document_id}, PRSERV=${payload.PRSERV}`);
  const command = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(payload),
  });

  await sqs.send(command);
  console.log(`[TIF Splitter] Document queued successfully for AI processing`);
}

export async function processTifBook({
  pageKeys,
  countyID,
  countyName,
  queueUrl,
  pool,
  base36Encode,
  sqs,
}) {
  console.log(`[TIF Splitter] ===== Starting TIF book processing =====`);
  console.log(`[TIF Splitter] Input: ${pageKeys.length} page(s), countyID=${countyID}, countyName=${countyName}`);
  
  if (!Array.isArray(pageKeys) || !pageKeys.length) {
    console.error('[TIF Splitter] ERROR: pageKeys must be a non-empty array');
    throw new Error('pageKeys must be a non-empty array');
  }

  console.log(`[TIF Splitter] Step 1: Running vertical audit to detect filing stamps`);
  const verticalPages = await runVerticalAudit(pageKeys);

  if (!verticalPages.length) {
    console.error('[TIF Splitter] ERROR: Vertical audit returned no pages or stamps');
    throw new Error('Vertical audit returned no pages or stamps; refusing to process entire book as one document.');
  }

  console.log(`[TIF Splitter] Step 2: Finalizing documents (creating PDFs, DB records, queueing)`);
  const result = await finalizeDocuments(verticalPages, countyID, countyName, queueUrl, pool, base36Encode, sqs);
  console.log(`[TIF Splitter] ===== TIF book processing complete: ${result.documentsCreated} document(s) created =====`);
  return result;
}

async function finalizeDocuments(pages, countyID, countyName, queueUrl, pool, base36Encode, sqs) {
  console.log(`[TIF Splitter] Finalizing documents from ${pages.length} page(s)`);
  const docs = computeDocumentSlices(pages);
  const pageCache = new Map();

  let documentsCreated = 0;
  const totalDocs = docs.length;
  console.log(`[TIF Splitter] Processing ${totalDocs} document(s)`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc.slices || !doc.slices.length) {
      console.log(`[TIF Splitter] Skipping document ${i + 1}/${totalDocs}: no slices`);
      continue;
    }

    console.log(`[TIF Splitter] Processing document ${i + 1}/${totalDocs} (${doc.slices.length} slice(s))`);

    const pdfBuffer = await buildDocumentPdf(doc.slices, pageCache);

    // Create a new Document row
    console.log(`[TIF Splitter] Creating Document record in database (countyID=${countyID})`);
    const [result] = await pool.execute(
      `
        INSERT INTO Document (countyID, exportFlag)
        VALUES (?, 1)
      `,
      [countyID],
    );

    const documentID = result.insertId;
    const PRSERV = base36Encode(documentID);
    console.log(`[TIF Splitter] Document created: documentID=${documentID}, PRSERV=${PRSERV}`);

    // Upload PDF to final S3 location
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
    console.log(`[TIF Splitter] Document ${i + 1}/${totalDocs} finalized successfully`);
  }

  console.log(`[TIF Splitter] Finalization complete: ${documentsCreated} document(s) created and queued`);
  return { documentsCreated };
}
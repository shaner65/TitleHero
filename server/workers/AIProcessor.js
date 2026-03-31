import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import OpenAI from 'openai';
import { getS3BucketName } from '../config.js';
import { getDocumentPagesAsBase64 } from './documentPagesToBase64.js';

import {
    getOpenAPIKey,
    getDbUpdaterQueueName,
    getAIProcessorQueueName,
    getPool,
} from '../config.js';

import {
    isMessageProcessed,
    markMessageProcessed
} from './processMessage.js';

let sqs;
let AI_PROCESSOR_QUEUE;
let DB_UPDATER_QUEUE;

const s3Client = new S3Client({ region: "us-east-2" });

const PHASE1_BATCH_SIZE = 1;

const AI_PROCESSOR_VISIBILITY_TIMEOUT = 300;

async function getPresignedUrlsFromDocumentData(documentData) {
    if (!documentData.key) {
        console.error("No key found in documentData");
        return [];
    }

    const keys = Array.isArray(documentData.key) ? documentData.key : [documentData.key];

    const presignedUrls = await Promise.all(
        keys.map(async (key) => {
            try {
                const BUCKET = await getS3BucketName();

                const command = new GetObjectCommand({
                    Bucket: BUCKET,
                    Key: key,
                });

                const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3000 });
                return presignedUrl;
            } catch (error) {
                console.error("Error generating presigned URL for key:", key, error);
                return null;
            }
        })
    );

    // Filter out any failed URLs (nulls)
    const validUrls = presignedUrls.filter(url => url !== null);
    console.log("Generated presigned URLs:", validUrls);

    return validUrls;
}

async function getImageUrlsFromDocumentData(documentData) {
    try {
        return await getPresignedUrlsFromDocumentData(documentData);
    } catch (error) {
        console.log("Presigned Urls failed to generate:", error);
        return [];
    }
}

async function getDocumentPagesForAi(imageUrls, documentData) {
    const sourceUrl = Array.isArray(imageUrls) ? imageUrls[0] : imageUrls;
    if (!sourceUrl) {
        return [];
    }

    try {
        return await getDocumentPagesAsBase64(sourceUrl, documentData.PRSERV, documentData.file_type);
    } catch (error) {
        console.log("Document failed to convert to base64 pages:", error);
        return [];
    }
}

function hasMeaningfulExtraction(extractedRecord) {
    if (!extractedRecord || typeof extractedRecord !== "object") return false;

    const scalarFields = [
        "instrumentNumber", "book", "volume", "page", "instrumentType", "remarks",
        "lienAmount", "legalDescription", "subBlock", "abstractText", "acres",
        "instrumentDate", "filingDate", "GFNNumber", "marketShare", "address",
        "CADNumber", "CADNumber2", "GLOLink", "fieldNotes"
    ];

    for (const key of scalarFields) {
        const value = extractedRecord[key];
        if (value !== null && value !== undefined && value !== "") {
            return true;
        }
    }

    if (Array.isArray(extractedRecord.grantor) && extractedRecord.grantor.length > 0) return true;
    if (Array.isArray(extractedRecord.grantee) && extractedRecord.grantee.length > 0) return true;
    return false;
}

async function updateJobCounters(documentData, fields) {
    const pool = await getPool();

    if (documentData.book_id) {
        const sets = Object.keys(fields).map((field) => `${field} = COALESCE(${field}, 0) + 1`);
        if (sets.length > 0) {
            await pool.execute(
                `UPDATE TIF_Process_Job SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
                [documentData.book_id]
            );
        }
    }

    if (documentData.batch_id) {
        const sets = Object.keys(fields).map((field) => `${field} = COALESCE(${field}, 0) + 1`);
        if (sets.length > 0) {
            await pool.execute(
                `UPDATE Document_Batch_Job SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                [documentData.batch_id]
            );
        }
    }
}

async function updateDocumentScanProgress(documentId, fields) {
    if (!documentId) return;
    const pool = await getPool();
    const sets = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(fields, "scan_batch_id")) {
        sets.push("scan_batch_id = ?");
        values.push(fields.scan_batch_id);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "scan_pages_total")) {
        sets.push("scan_pages_total = ?");
        values.push(fields.scan_pages_total);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "scan_pages_processed")) {
        sets.push("scan_pages_processed = ?");
        values.push(fields.scan_pages_processed);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "scan_status")) {
        sets.push("scan_status = ?");
        values.push(fields.scan_status);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "scan_error")) {
        sets.push("scan_error = ?");
        values.push(fields.scan_error);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "increment_pages_processed") && fields.increment_pages_processed) {
        sets.push("scan_pages_processed = COALESCE(scan_pages_processed, 0) + 1");
    }

    if (sets.length === 0) return;

    values.push(documentId);
    await pool.execute(
        `UPDATE Document
         SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP
         WHERE documentID = ?`,
        values
    );
}

async function markFailedProgress(documentData, reason) {
    try {
        await updateDocumentScanProgress(documentData.document_id, {
            scan_status: "failed",
            scan_error: String(reason || "AI processing failed").slice(0, 1000),
        });
        await updateJobCounters(documentData, {
            documents_ai_failed: true
        });
        if (documentData.book_id) {
            const pool = await getPool();
            await pool.execute(
                `UPDATE TIF_Process_Job SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
                [String(reason || "AI processing failed").slice(0, 1000), documentData.book_id]
            );
        }
        if (documentData.batch_id) {
            const pool = await getPool();
            await pool.execute(
                `UPDATE Document_Batch_Job SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                [String(reason || "AI processing failed").slice(0, 1000), documentData.batch_id]
            );
        }
    } catch (err) {
        console.error("Failed to update AI failure counters:", err);
    }
}

const LAND_TITLE_FACTS_SCHEMA = {
    type: "object",
    properties: {
        instrumentNumber: { type: ["string", "null"] },
        book: { type: ["string", "null"] },
        volume: { type: ["string", "null"] },
        page: { type: ["string", "null"] },
        grantor: { type: "array", items: { type: "string" } },
        grantee: { type: "array", items: { type: "string" } },
        instrumentType: { type: ["string", "null"] },
        remarks: { type: ["string", "null"] },
        lienAmount: { type: ["number", "null"] },
        legalDescription: { type: ["string", "null"] },
        subBlock: { type: ["string", "null"] },
        abstractText: { type: ["string", "null"] },
        acres: { type: ["number", "null"] },
        instrumentDate: {
            type: ["string", "null"],
            description: "The date and time from the official clerk stamp. Format: YYYY-MM-DD"
        },
        filingDate: {
            type: ["string", "null"],
            description: "The official recording date listed by the county. Format: YYYY-MM-DD"
        },
        GFNNumber: { type: ["string", "null"] },
        marketShare: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
        CADNumber: { type: ["string", "null"] },
        CADNumber2: { type: ["string", "null"] },
        GLOLink: { type: ["string", "null"] },
        fieldNotes: { type: ["string", "null"] },
    },
    required: [
        "instrumentNumber", "book", "volume", "page", "grantor", "grantee",
        "instrumentType", "remarks", "lienAmount", "legalDescription", "subBlock",
        "abstractText", "acres", "instrumentDate", "filingDate",
        "GFNNumber", "marketShare",
        "address", "CADNumber", "CADNumber2", "GLOLink", "fieldNotes"
    ],
    additionalProperties: false
};

const PHASE1_DOCUMENT_SCHEMA = {
    name: "land_title_extraction",
    strict: true,
    schema: {
        type: "object",
        properties: {
            page_range: {
                type: "object",
                properties: {
                    start: { type: "integer" },
                    end: { type: "integer" }
                },
                required: ["start", "end"],
                additionalProperties: false
            },
            raw_text: { type: "string" },
            facts: LAND_TITLE_FACTS_SCHEMA
        },
        required: ["page_range", "raw_text", "facts"],
        additionalProperties: false
    }
};

const FINAL_DOCUMENT_SCHEMA = {
    name: "land_title_synthesized",
    strict: true,
    schema: LAND_TITLE_FACTS_SCHEMA
};

async function synthesizeFromPartials(openai, partialResults) {
    const payload = JSON.stringify(partialResults);
    const instruction = {
        type: "input_text",
        text: `
            You are reconciling extractions from one recorded land title instrument.
            The JSON array below contains ordered chunks.
            Each chunk has page_range, raw_text (OCR for that slice), and facts (structured fields visible on that slice).
            Your job: produce ONE consolidated record for the entire instrument.
            Merge narrative fields (remarks, legalDescription, abstractText, fieldNotes) sensibly across chunks in order.
            Deduplicate and normalize grantor and grantee names.
            For scalar fields (book, volume, page, instrument numbers, dates, etc.), prefer filing and recording stamps and header blocks when multiple values appear.
            Never invent data.
            Use null where still unknown.
            Normalize dates to YYYY-MM-DD.
            Use numbers for lienAmount and acres.
            Follow the JSON schema exactly.
            Return valid JSON only.
            Chunks JSON:
            ${payload}
        `
    };

    const resp = await openai.responses.create({
        model: "gpt-4.1-mini",
        text: {
            format: {
                type: "json_schema",
                ...FINAL_DOCUMENT_SCHEMA
            }
        },
        input: [
            {
                role: "user",
                content: [instruction]
            }
        ]
    });

    return JSON.parse(resp.output_text);
}

async function processDocument(imageUrls, documentData) { // ! used for running documents through AI
    const openai = new OpenAI({ apiKey: await getOpenAPIKey() });

    const batchSize = PHASE1_BATCH_SIZE;
    const batches = [];

    for (let i = 0; i < imageUrls.length; i += batchSize) {
        batches.push(imageUrls.slice(i, i + batchSize));
    }

    console.log(`Total pages: ${imageUrls.length}, PHASE1_BATCH_SIZE=${batchSize}`);
    console.log(`Processing in ${batches.length} batches...`);

    const partialResults = [];

    let failedBatches = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const startPage = i * batchSize + 1;
        const endPage = startPage + batch.length - 1;

        console.log(`Batch ${i + 1}/${batches.length} (pages ${startPage}-${endPage})`);

        let chunkHint;
        if (batchSize === 1) {
            chunkHint = `
                This is a single page of a larger instrument.
                Structured facts may be incomplete for the whole document.
                raw_text must be a complete transcription of everything visible on this page (printed and handwritten: headers, stamps, body, marginalia, notes).
                Use empty string for raw_text only if the page is blank.
                Follow the JSON schema exactly.
                Return valid JSON only.
            `;
        } else {
            chunkHint = `
                These pages are one contiguous slice of a single instrument.
                Extract from all images in this chunk.
                Combine visible legal and narrative text into facts and raw_text for this span.
                Follow the JSON schema exactly.
                Return valid JSON only.
            `;
        }

        const instruction = {
            type: "input_text",
            text: `
                You are reading pages ${startPage}-${endPage} of ONE recorded land title document.
                This is one contiguous slice of the same instrument.
                ${chunkHint}
                Output requirements:
                page_range: use start ${startPage} and end ${endPage}.
                raw_text: verbatim-style transcription of all visible text on this slice (OCR).
                Do not omit stamps, margins, or notes.
                facts: for every schema field, fill in anything clearly visible on this slice only.
                Use null or empty arrays where absent on this slice.
                Do not skip fields because other pages might hold the answer.
                List all grantors and grantees named on this slice.
                Normalize dates to YYYY-MM-DD.
                Use decimals for money and acreage.
                Do not invent data.
                Prefer transcribing what you see in raw_text over guessing facts.
                Follow the JSON schema exactly.
                Return valid JSON only.
            `
        };

        const imagesInput = batch.map(url => ({
            type: "input_image",
            image_url: url
        }));

        try {
            const resp = await openai.responses.create({
                model: "gpt-4.1-mini",
                text: {
                    format: {
                        type: "json_schema",
                        ...PHASE1_DOCUMENT_SCHEMA
                    }
                },
                input: [
                    {
                        role: "user",
                        content: [instruction, ...imagesInput]
                    }
                ]
            });

            const parsed = JSON.parse(resp.output_text);
            parsed.page_range = { start: startPage, end: endPage };

            partialResults.push(parsed);
            await updateDocumentScanProgress(documentData?.document_id, {
                increment_pages_processed: true,
            });

            console.log(`Batch ${i + 1} done`);

            console.log(`Parsed batch ${i + 1} values: ${JSON.stringify(parsed)}`);

        } catch (err) {
            console.error(`Batch ${i + 1} failed:`, err);
            failedBatches += 1;
        }
    }

    if (partialResults.length === 0) {
        return {
            success: false,
            error: `All AI batches failed (${failedBatches}/${batches.length}).`
        };
    }

    let finalDocument;
    try {
        const synthesized = await synthesizeFromPartials(openai, partialResults);
        if (synthesized && hasMeaningfulExtraction(synthesized)) {
            finalDocument = synthesized;
            console.log("Synthesis produced final document.");
        } else {
            console.log("Synthesis empty or not meaningful; falling back to merged facts.");
            finalDocument = await finalizeDocument(partialResults);
        }
    } catch (err) {
        console.error("Synthesis failed, using merge fallback:", err);
        finalDocument = await finalizeDocument(partialResults);
    }

    if (!hasMeaningfulExtraction(finalDocument)) {
        return {
            success: false,
            error: "AI extraction returned no meaningful fields."
        };
    }

    return {
        success: true,
        result: finalDocument
    };
}

async function finalizeDocument(partialResults) {
    function mergeArraysUnique(arrays) {
        const set = new Set();
        for (const arr of arrays) {
            if (Array.isArray(arr)) {
                for (const item of arr) {
                    if (item !== null && item !== undefined) set.add(item);
                }
            }
        }
        return Array.from(set);
    }

    function mergeScalars(fields) {
        for (const val of fields) {
            if (val !== null && val !== undefined && val !== '') return val;
        }
        return null;
    }

    const mergedFacts = partialResults.reduce(
        (acc, part) => {
            const facts = part.facts || {};
            acc.instrumentNumber = mergeScalars([acc.instrumentNumber, facts.instrumentNumber]);
            acc.book = mergeScalars([acc.book, facts.book]);
            acc.volume = mergeScalars([acc.volume, facts.volume]);
            acc.page = mergeScalars([acc.page, facts.page]);
            acc.grantor = mergeArraysUnique([acc.grantor, facts.grantor]);
            acc.grantee = mergeArraysUnique([acc.grantee, facts.grantee]);
            acc.instrumentType = mergeScalars([acc.instrumentType, facts.instrumentType]);
            acc.remarks = mergeScalars([acc.remarks, facts.remarks]);
            acc.lienAmount = mergeScalars([acc.lienAmount, facts.lienAmount]);
            acc.legalDescription = mergeScalars([acc.legalDescription, facts.legalDescription]);
            acc.subBlock = mergeScalars([acc.subBlock, facts.subBlock]);
            acc.abstractText = mergeScalars([acc.abstractText, facts.abstractText]);
            acc.acres = mergeScalars([acc.acres, facts.acres]);
            acc.instrumentDate = mergeScalars([acc.instrumentDate,facts.instrumentDate]);
            acc.filingDate = mergeScalars([acc.filingDate, facts.filingDate]);
            acc.GFNNumber = mergeScalars([acc.GFNNumber, facts.GFNNumber]);
            acc.marketShare = mergeScalars([acc.marketShare, facts.marketShare]);
            acc.address = mergeScalars([acc.address, facts.address]);
            acc.CADNumber = mergeScalars([acc.CADNumber, facts.CADNumber]);
            acc.CADNumber2 = mergeScalars([acc.CADNumber2, facts.CADNumber2]);
            acc.GLOLink = mergeScalars([acc.GLOLink, facts.GLOLink]);
            acc.fieldNotes = mergeScalars([acc.fieldNotes, facts.fieldNotes]);

            return acc;
        },
        {
            instrumentNumber: null,
            book: null,
            volume: null,
            page: null,
            grantor: [],
            grantee: [],
            instrumentType: null,
            remarks: null,
            lienAmount: null,
            legalDescription: null,
            subBlock: null,
            abstractText: null,
            acres: null,
            instrumentDate: null,
            filingDate: null,
            GFNNumber: null,
            marketShare: null,
            address: null,
            CADNumber: null,
            CADNumber2: null,
            GLOLink: null,
            fieldNotes: null,
        }
    );

    const finalDocument = {
        instrumentNumber: mergedFacts.instrumentNumber,
        book: mergedFacts.book,
        volume: mergedFacts.volume,
        page: mergedFacts.page,
        grantor: mergedFacts.grantor,
        grantee: mergedFacts.grantee,
        instrumentType: mergedFacts.instrumentType,
        remarks: mergedFacts.remarks,
        lienAmount: mergedFacts.lienAmount,
        legalDescription: mergedFacts.legalDescription,
        subBlock: mergedFacts.subBlock,
        abstractText: mergedFacts.abstractText,
        acres: mergedFacts.acres,
        instrumentDate: mergedFacts.instrumentDate,
        filingDate: mergedFacts.filingDate,
        GFNNumber: mergedFacts.GFNNumber,
        marketShare: mergedFacts.marketShare,
        address: mergedFacts.address,
        CADNumber: mergedFacts.CADNumber,
        CADNumber2: mergedFacts.CADNumber2,
        GLOLink: mergedFacts.GLOLink,
        fieldNotes: mergedFacts.fieldNotes,
    };

    return finalDocument;
}

async function sendToDbUpdaterQueue(extractedRecord, documentData) {
    const messageBody = JSON.stringify({
        ...extractedRecord,
        ...documentData
    });

    const sendCommand = new SendMessageCommand({
        QueueUrl: DB_UPDATER_QUEUE,
        MessageBody: messageBody,
    });
    await sqs.send(sendCommand);
}

async function getAiProcessorMessages() {
    const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: AI_PROCESSOR_QUEUE,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: AI_PROCESSOR_VISIBILITY_TIMEOUT,
    });
    const response = await sqs.send(receiveCommand);
    return response.Messages || [];
}

async function deleteAiProcessorMessage(receiptHandle) {
    await sqs.send(
        new DeleteMessageCommand({
            QueueUrl: AI_PROCESSOR_QUEUE,
            ReceiptHandle: receiptHandle,
        })
    );
}

async function completeSuccessfulAiJob({ extractedRecord, documentData, sqsMessageBody, receiptHandle }) {
    console.log('Document job metadata:', JSON.stringify(documentData, null, 2));
    console.log('Extracted land title record:', JSON.stringify(extractedRecord, null, 2));

    await sendToDbUpdaterQueue(extractedRecord, documentData);
    await markMessageProcessed(sqsMessageBody, 'ai-processor-queue');
    await updateDocumentScanProgress(documentData.document_id, {
        scan_status: "ai_done",
        scan_error: null,
    });

    try {
        await updateJobCounters(documentData, { documents_ai_processed: true });
        if (documentData.batch_id) {
            const pool = await getPool();
            await pool.execute(
                `UPDATE Document_Batch_Job SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                [documentData.batch_id]
            );
        }
    } catch (err) {
        console.error('Failed to update progress counters:', err);
    }

    await deleteAiProcessorMessage(receiptHandle);
    console.log('Processed and deleted message successfully.');
}

async function completeFailedAiJob({ documentData, sqsMessageBody, imageUrls, reason, receiptHandle }) {
    await markFailedProgress(documentData, reason);
    console.log(
        `Failed to process document with image URLs: ${imageUrls}. Reason: ${reason}`
    );
    await markMessageProcessed(sqsMessageBody, 'ai-processor-queue');
    await deleteAiProcessorMessage(receiptHandle);
}

async function main() {
    console.log('AI Processor started, polling SQS...');

    const awsRegion = process.env.AWS_REGION || 'us-east-2';
    sqs = new SQSClient({ region: awsRegion });

    DB_UPDATER_QUEUE = await getDbUpdaterQueueName();
    AI_PROCESSOR_QUEUE = await getAIProcessorQueueName();

    while (true) {
        try {
            const messages = await getAiProcessorMessages();

            if (messages.length === 0) {
                await new Promise((r) => setTimeout(r, 5000));
                continue;
            }

            for (const message of messages) {
                const receiptHandle = message.ReceiptHandle;
                const sqsMessageBody = message.Body;

                let alreadyProcessed = false;
                try {
                    alreadyProcessed = await isMessageProcessed(sqsMessageBody, 'ai-processor-queue');
                } catch (err) {
                    console.error('Failed to check duplicate message:', err);
                    continue;
                }

                if (alreadyProcessed) {
                    console.log('Duplicate message detected, deleting from queue.');
                    await deleteAiProcessorMessage(receiptHandle);
                    continue;
                }

                const documentData = JSON.parse(sqsMessageBody);

                const imageUrls = await getImageUrlsFromDocumentData(documentData);

                const base64EncodedImages = await getDocumentPagesForAi(imageUrls, documentData);

                if (base64EncodedImages.length === 0) {
                    console.log(`No image URLs found in message: ${sqsMessageBody}`);
                    await markFailedProgress(documentData, "No pages were available for AI processing.");
                    await deleteAiProcessorMessage(receiptHandle);
                    continue;
                }

                await updateDocumentScanProgress(documentData.document_id, {
                    scan_batch_id: documentData.batch_id || null,
                    scan_pages_total: base64EncodedImages.length,
                    scan_pages_processed: 0,
                    scan_status: "processing",
                    scan_error: null,
                });

                const aiProcessResult = await processDocument(base64EncodedImages, documentData);

                if (aiProcessResult?.success && aiProcessResult.result) {
                    await completeSuccessfulAiJob({
                        extractedRecord: aiProcessResult.result,
                        documentData,
                        sqsMessageBody,
                        receiptHandle,
                    });
                } else {
                    const reason = aiProcessResult?.error || "AI processing failed";
                    await completeFailedAiJob({
                        documentData,
                        sqsMessageBody,
                        imageUrls,
                        reason,
                        receiptHandle,
                    });
                }
            }
        } catch (err) {
            console.error('Unexpected error:', err);
            await new Promise((r) => setTimeout(r, 10000));
        }
    }
}

main().catch(console.error);
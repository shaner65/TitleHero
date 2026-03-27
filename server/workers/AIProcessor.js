import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import OpenAI from 'openai';
import { getS3BucketName } from '../config.js';
import { getPdfPagesAsBase64 } from './pdfUrlToPng.js';

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

async function getPresignedUrlsFromData(body) {
    const data = JSON.parse(body);

    if (!data.key) {
        console.error("No key found in data");
        return [];
    }

    const keys = Array.isArray(data.key) ? data.key : [data.key];

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

function hasMeaningfulExtraction(document) {
    if (!document || typeof document !== "object") return false;

    const scalarFields = [
        "instrumentNumber", "book", "volume", "page", "instrumentType", "remarks",
        "lienAmount", "legalDescription", "subBlock", "abstractText", "acres",
        "instrumentDate", "filingDate", "GFNNumber", "marketShare", "address",
        "CADNumber", "CADNumber2", "GLOLink", "fieldNotes"
    ];

    for (const key of scalarFields) {
        const value = document[key];
        if (value !== null && value !== undefined && value !== "") {
            return true;
        }
    }

    if (Array.isArray(document.grantor) && document.grantor.length > 0) return true;
    if (Array.isArray(document.grantee) && document.grantee.length > 0) return true;
    return false;
}

async function updateJobCounters(data, fields) {
    const pool = await getPool();

    if (data.book_id) {
        const sets = Object.keys(fields).map((field) => `${field} = COALESCE(${field}, 0) + 1`);
        if (sets.length > 0) {
            await pool.execute(
                `UPDATE TIF_Process_Job SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
                [data.book_id]
            );
        }
    }

    if (data.batch_id) {
        const sets = Object.keys(fields).map((field) => `${field} = COALESCE(${field}, 0) + 1`);
        if (sets.length > 0) {
            await pool.execute(
                `UPDATE Document_Batch_Job SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                [data.batch_id]
            );
        }
    }
}

async function markFailedProgress(data, reason) {
    try {
        await updateJobCounters(data, {
            documents_ai_failed: true
        });
        if (data.book_id) {
            const pool = await getPool();
            await pool.execute(
                `UPDATE TIF_Process_Job SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE book_id = ?`,
                [String(reason || "AI processing failed").slice(0, 1000), data.book_id]
            );
        }
        if (data.batch_id) {
            const pool = await getPool();
            await pool.execute(
                `UPDATE Document_Batch_Job SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                [String(reason || "AI processing failed").slice(0, 1000), data.batch_id]
            );
        }
    } catch (err) {
        console.error("Failed to update AI failure counters:", err);
    }
}

export async function processDocument(imageUrls) {
    const openai = new OpenAI({ apiKey: await getOpenAPIKey() });

    const BATCH_SIZE = 10;
    const batches = [];

    for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
        batches.push(imageUrls.slice(i, i + BATCH_SIZE));
    }

    console.log(`Total pages: ${imageUrls.length}`);
    console.log(`Processing in ${batches.length} batches...`);

    const partialResults = [];

    const documentSchema = {
        name: "land_title_extraction",
        strict: true,
        schema: {
            type: "object",
            properties: {
                raw_text: { type: "string" },
                facts: {
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
                        exportFlag: { type: ["integer", "null"] },
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
                        "exportFlag", "GFNNumber", "marketShare",
                        "address", "CADNumber", "CADNumber2", "GLOLink", "fieldNotes"
                    ],
                    additionalProperties: false
                }
            },
            required: ["raw_text", "facts"],
            additionalProperties: false
        }
    };

    let failedBatches = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const startPage = i * BATCH_SIZE + 1;
        const endPage = startPage + batch.length - 1;

        console.log(`Batch ${i + 1}/${batches.length} (pages ${startPage}-${endPage})`);

        const instruction = {
            type: "input_text",
            text: `
        You are reading pages ${startPage}-${endPage} of ONE recorded land title document.
        Perform OCR and extract relevant facts.
        Follow the schema exactly. Do not invent data. Use null if unknown.
        Rules: normalize dates to YYYY-MM-DD; decimals for money/acreage.
        `
        // Return valid JSON only.
        };

        const imagesInput = batch.map(url => ({
            type: "image_url",
            image_url: { url }
        }));

        try {
            const resp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: instruction.text
                            },
                            ...imagesInput
                        ]
                    }
                ]
            });

            const parsed = JSON.parse(resp.choices[0].message.content);

            partialResults.push(parsed);

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

    console.log("Merging batch results into final schema…");
    const finalDocument = await finalizeDocument(partialResults);
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
            acc.exportFlag = mergeScalars([acc.exportFlag, facts.exportFlag]);
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
            exportFlag: null,
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
        exportFlag: mergedFacts.exportFlag,
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

async function sendToDbUpdaterQueue(aiResult, data) {
    const messageBody = JSON.stringify({
        ...aiResult,
        ...data
    });

    const sendCommand = new SendMessageCommand({
        QueueUrl: DB_UPDATER_QUEUE,
        MessageBody: messageBody,
    });
    await sqs.send(sendCommand);
}

async function main() {
    console.log('AI Processor started, polling SQS...');

    const awsRegion = process.env.AWS_REGION || 'us-east-2';
    sqs = new SQSClient({ region: awsRegion });

    DB_UPDATER_QUEUE = await getDbUpdaterQueueName();
    AI_PROCESSOR_QUEUE = await getAIProcessorQueueName();

    while (true) {
        try {
            const receiveCommand = new ReceiveMessageCommand({
                QueueUrl: AI_PROCESSOR_QUEUE,
                MaxNumberOfMessages: 1,
                WaitTimeSeconds: 10,
                VisibilityTimeout: 30,
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

                let alreadyProcessed = false;

                try {
                    alreadyProcessed = await isMessageProcessed(body, 'ai-processor-queue');
                } catch (err) {
                    console.error('Failed to check duplicate message:', err);
                    continue;
                }

                if (alreadyProcessed) {
                    console.log('Duplicate message detected, deleting from queue.');

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });

                    await sqs.send(deleteCommand);
                    continue;
                }

                const data = JSON.parse(body);

                // TODO add png tif jpg doc
                let imageUrls = [];
                try {
                    imageUrls = await getPresignedUrlsFromData(body);
                } catch (error) {
                    console.log("Presigned Urls failed to generate:", error)
                }

                console.log("Image urls finished:", imageUrls.length);

                let base64EncodedImages = [];
                try {
                    base64EncodedImages = await getPdfPagesAsBase64(imageUrls, data.PRSERV);
                } catch (error) {
                    console.log("PDF failed to convert to base64:", error);
                }

                console.log("Base64 urls finished:", base64EncodedImages.length);

                if (base64EncodedImages.length === 0) {
                    console.log(`No image URLs found in message: ${body}`);
                    await markFailedProgress(data, "No pages were available for AI processing.");

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);

                    continue;
                }

                let aiProcessResult;
                try {
                    aiProcessResult = await processDocument(base64EncodedImages);
                } catch (error) {
                    console.log("AI result failed:", error);
                }

                if (aiProcessResult?.success && aiProcessResult.result) {
                    const aiResult = aiProcessResult.result;
                    console.log('Data being sent:', JSON.stringify(data, null, 2));
                    console.log('AI Result:', JSON.stringify(aiResult, null, 2));

                    await sendToDbUpdaterQueue(aiResult, data);

                    await markMessageProcessed(body, 'ai-processor-queue');

                    // Update progress counters for book (TIF) or PDF batch
                    try {
                        await updateJobCounters(data, { documents_ai_processed: true });
                        if (data.batch_id) {
                            const pool = await getPool();
                            await pool.execute(
                                `UPDATE Document_Batch_Job SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE batch_id = ?`,
                                [data.batch_id]
                            );
                        }
                    } catch (err) {
                        console.error('Failed to update progress counters:', err);
                    }

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);

                    console.log('Processed and deleted message successfully.');
                } else {
                    const reason = aiProcessResult?.error || "AI processing failed";
                    await markFailedProgress(data, reason);
                    console.log(
                        `Failed to process document with image URLs: ${imageUrls}. Reason: ${reason}`
                    );
                    await markMessageProcessed(body, 'ai-processor-queue');
                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);
                }
            }
        } catch (err) {
            console.error('Unexpected error:', err);
            await new Promise((r) => setTimeout(r, 10000));
        }
    }
}

main().catch(console.error);
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
    console.log("Generated presigned URLs:",
        validUrls.map(url => url.length > 60 ? url.slice(0, 60) + "..." : url)
    );

    return validUrls;
}

async function processDocument(imageUrls) {
    const openai = new OpenAI({ apiKey: await getOpenAPIKey() });

    const instruction = {
        type: 'input_text',
        text:
            "You are an expert data extraction AI specializing in Texas land title records. " +
            "Read ALL images (they form one recorded document), perform OCR, and return ONLY JSON with this shape: " +
            '{ "lookups": { "Abstract": {"name": "...", "code": null }, "BookType": {"name": "..."}, ' +
            '"Subdivision": {"name": "..."}, "County": {"name": "..."} }, ' +
            '"document": { /* fields as specified */ }, ' +
            '"ai_extraction": { "accuracy": 0.0, "fieldsExtracted": { "supporting_keys": "..." }, "extraction_notes": [] } } ' +
            "Rules: normalize dates to YYYY-MM-DD; decimals for money/acreage; nulls for unknown; do not invent data. " +
            "IMPORTANT: The 'grantor' and 'grantee' fields should be arrays of strings, listing all grantors and grantees respectively."
    };

    const imagesInput = imageUrls.map((url) => ({
        type: 'input_image',
        image_url: url,
    }));

    const responseFormat = {
        type: 'json_schema',
        name: 'title_packet',
        schema: {
            type: 'object',
            additionalProperties: false,
            required: ['lookups', 'document', 'ai_extraction'],
            properties: {
                lookups: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['Abstract', 'BookType', 'Subdivision', 'County'],
                    properties: {
                        Abstract: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['name', 'code'],
                            properties: {
                                name: { type: ['string', 'null'] },
                                code: { type: ['string', 'null'] },
                            },
                        },
                        BookType: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['name'],
                            properties: { name: { type: ['string', 'null'] } },
                        },
                        Subdivision: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['name'],
                            properties: { name: { type: ['string', 'null'] } },
                        },
                        County: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['name'],
                            properties: { name: { type: ['string', 'null'] } },
                        },
                    },
                },
                document: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'instrumentNumber',
                        'book',
                        'volume',
                        'page',
                        'grantor',
                        'grantee',
                        'instrumentType',
                        'remarks',
                        'lienAmount',
                        'legalDescription',
                        'subBlock',
                        'abstractText',
                        'acres',
                        'fileStampDate',
                        'filingDate',
                        'nFileReference',
                        'finalizedBy',
                        'exportFlag',
                        'propertyType',
                        'GFNNumber',
                        'marketShare',
                        'sortArray',
                        'address',
                        'CADNumber',
                        'CADNumber2',
                        'GLOLink',
                        'fieldNotes',
                    ],
                    properties: {
                        instrumentNumber: { type: ['string', 'null'] },
                        book: { type: ['string', 'null'] },
                        volume: { type: ['string', 'null'] },
                        page: { type: ['string', 'null'] },
                        grantor: {
                            type: 'array',
                            items: { type: ['string', 'null'] },
                        },
                        grantee: {
                            type: 'array',
                            items: { type: ['string', 'null'] },
                        },
                        instrumentType: { type: ['string', 'null'] },
                        remarks: { type: ['string', 'null'] },
                        lienAmount: { type: ['number', 'null'] },
                        legalDescription: { type: ['string', 'null'] },
                        subBlock: { type: ['string', 'null'] },
                        abstractText: { type: ['string', 'null'] },
                        acres: { type: ['number', 'null'] },
                        fileStampDate: { type: ['string', 'null'] },
                        filingDate: { type: ['string', 'null'] },
                        nFileReference: { type: ['string', 'null'] },
                        finalizedBy: { type: ['string', 'null'] },
                        exportFlag: { type: 'integer' },
                        propertyType: { type: ['string', 'null'] },
                        GFNNumber: { type: ['string', 'null'] },
                        marketShare: { type: ['string', 'null'] },
                        sortArray: { type: ['string', 'null'] },
                        address: { type: ['string', 'null'] },
                        CADNumber: { type: ['string', 'null'] },
                        CADNumber2: { type: ['string', 'null'] },
                        GLOLink: { type: ['string', 'null'] },
                        fieldNotes: { type: ['string', 'null'] },
                    },
                },
                ai_extraction: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['accuracy', 'fieldsExtracted', 'extraction_notes'],
                    properties: {
                        accuracy: { type: 'number' },
                        fieldsExtracted: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['supporting_keys'],
                            properties: {
                                supporting_keys: { type: ['string', 'null'] },
                            },
                        },
                        extraction_notes: {
                            type: 'array',
                            items: { type: 'string' },
                        },
                    },
                },
            },
        },
    };

    try {
        const resp = await openai.responses.create({
            model: 'gpt-4.1-mini',
            input: [{ role: 'user', content: [instruction, ...imagesInput] }],
            text: { format: responseFormat },
        });
        return resp;
    } catch (err) {
        console.error('OpenAI API call failed:', err);
        return null;
    }
}

async function sendToDbUpdaterQueue(aiResult, data) {
    const parsed = JSON.parse(aiResult.output_text);

    const { grantor, grantee, ...restDocument } = parsed.document;

    const messageBody = JSON.stringify({
        ...restDocument,
        grantor,
        grantee,
        lookups: parsed.lookups,
        ai_extraction: parsed.ai_extraction,
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
                let imageUrls;
                try {
                    imageUrls = await getPresignedUrlsFromData(body);
                } catch (error) {
                    console.log("Presigned Urls failed to generate:", error)
                }

                let base64EncodedImages;
                try {
                    base64EncodedImages = await getPdfPagesAsBase64(imageUrls, data.PRSERV);
                } catch (error) {
                    console.log("PDF failed to convert to base64:", error);
                }

                if (base64EncodedImages.length === 0) {
                    console.log(`No image URLs found in message: ${body}`);

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);

                    continue;
                }

                const aiResult = await processDocument(base64EncodedImages);

                if (aiResult) {
                    console.log('📦 Data being sent:', JSON.stringify(data, null, 2));
                    console.log('🤖 AI Result:', JSON.stringify(aiResult, null, 2));

                    await sendToDbUpdaterQueue(aiResult, data);

                    await markMessageProcessed(body, 'ai-processor-queue');

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);

                    console.log('Processed and deleted message successfully.');
                } else {
                    console.log(
                        `Failed to process document with image URLs: ${imageUrls}. Leaving message in queue for retry.`
                    );
                }
            }
        } catch (err) {
            console.error('Unexpected error:', err);
            await new Promise((r) => setTimeout(r, 10000));
        }
    }
}

main().catch(console.error);
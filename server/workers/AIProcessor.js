const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const OpenAI = require('openai');
const { getS3BucketName } = require('../config');
const fetch = require("node-fetch");
const pdfjsLib = require("pdfjs-dist");
const { createCanvas } = require("canvas");
import fetch from 'node-fetch';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const {
    getOpenAPIKey,
    getDbUpdaterQueueName,
    getAIProcessorQueueName,
} = require('../config');

const {
    isMessageProcessed,
    markMessageProcessed
} = require('./processMessage');

let sqs;
let AI_PROCESSOR_QUEUE;
let DB_UPDATER_QUEUE;

const s3Client = new S3Client({ region: "us-east-2" });


async function getBase64ImageURLs(imageUrls) {
  const allBase64Images = [];

  for (const url of imageUrls) {
    // Fetch PDF bytes from presigned URL
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch PDF from ${url}`);
    const pdfBytes = await res.arrayBuffer();

    // Load PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const numPages = pdfDoc.getPageCount();

    // Process each page
    for (let i = 0; i < numPages; i++) {
      // Create a new PDF with just one page
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
      newPdf.addPage(copiedPage);
      const singlePagePdfBytes = await newPdf.save();

      // Convert single-page PDF buffer to WebP buffer with sharp
      const webpBuffer = await sharp(Buffer.from(singlePagePdfBytes), { density: 300 })
        .webp()
        .toBuffer();

      // Convert to base64 data URL
      const base64Image = `data:image/webp;base64,${webpBuffer.toString('base64')}`;
      allBase64Images.push(base64Image);
    }
  }

  return allBase64Images;
}

async function getPresignedUrlsFromData(body) {
    const data = JSON.parse(body);

    if (!data.image_urls || !Array.isArray(data.image_urls)) {
        console.error("No image_urls array found in data");
        return [];
    }

    const presignedUrls = await Promise.all(
        data.image_urls.map(async (originalUrl) => {
            try {
                const urlObj = new URL(originalUrl);
                const key = urlObj.pathname.slice(1);

                const BUCKET = await getS3BucketName();

                const command = new GetObjectCommand({
                    Bucket: BUCKET,
                    Key: key,
                });

                const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
                return presignedUrl;
            } catch (error) {
                console.error("Error generating presigned URL for:", originalUrl, error);
                return null; // Return null or handle error accordingly
            }
        })
    );

    // Filter out any failed URLs (nulls)
    const validUrls = presignedUrls.filter(url => url !== null);
    console.log("Generated presigned URLs:", validUrls);

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
    const { grantor, grantee, ...restAIResult } = aiResult;

    const messageBody = JSON.stringify({
        ...restAIResult,
        grantor,
        grantee,
        ...data,
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

                if (await isMessageProcessed(body, 'ai-processor-queue')) {
                    console.log('Duplicate message detected, deleting from queue.');

                    const deleteCommand = new DeleteMessageCommand({
                        QueueUrl: AI_PROCESSOR_QUEUE,
                        ReceiptHandle: receiptHandle,
                    });
                    await sqs.send(deleteCommand);

                    continue;
                }

                const data = JSON.parse(body);

                const imageUrls = await getPresignedUrlsFromData(body);

                const base64EncodedImages = await getBase64ImageURLs(imageUrls);

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
import OpenAI from "openai";
import sharp from "sharp";
import path from "path";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEST_FILES_DIR = "./test-files";

const BATCH_SIZE = 1;

/**
 * Prepares image with high resolution.
 * No heavy filtering since stamps are clean.
 */
async function prepareImage(filename) {
    const filePath = path.join(TEST_FILES_DIR, filename);
    if (!fs.existsSync(filePath)) throw new Error(`File missing: ${filePath}`);

    const buffer = await sharp(filePath)
        .resize(2500)
        .png()
        .toBuffer();

    return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function detectEndings(tifPaths, batchNum, allFiles) {
    try {
        console.log(`\n--- Batch ${batchNum}: RAW Vertical Axis Audit ---`);
        const images = await Promise.all(tifPaths.map(file => prepareImage(file)));

        const content = [{
            type: "text",
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
            `
        }];

        images.forEach((url, index) => {
            const absPage = allFiles.indexOf(tifPaths[index]) + 1;

            content.push({
                type: "text",
                text: `IMAGE_IDENTIFIER: ${tifPaths[index]} | PAGE_NUMBER: ${absPage}`
            });
            content.push({ type: "image_url", image_url: { url, detail: "high" } });
        });

        const terminationSchema = {
            name: "vertical_audit_results",
            strict: true,
            schema: {
                type: "object",
                properties: {
                    pages: {
                        type: "array",
                        description: "Results for each page analyzed.",
                        items: {
                            type: "object",
                            properties: {
                                filename: {
                                    type: "string",
                                    description: "The image filename this result corresponds to."
                                },
                                page_number: {
                                    type: "number",
                                    description: "Absolute page number in the full document set (1-based)."
                                },
                                stamps_detected: {
                                    type: "array",
                                    description: "ALL 'FILED FOR RECORD' stamps found on this page. May be empty or contain multiple entries. Do NOT collapse stamps into one.",
                                    items: {
                                        type: "object",
                                        properties: {
                                            y_pos_percent: {
                                                type: "number",
                                                description: "Vertical position of the stamp from 0 (top) to 100 (bottom)."
                                            },
                                            transcription: {
                                                type: "string",
                                                description: "Full text of this single stamp only. Do not merge two stamps."
                                            },
                                            visual_context: {
                                                type: "string",
                                                description: "What immediately follows the stamp (e.g., white space, body text, bottom of page)."
                                            }
                                        },
                                        required: ["y_pos_percent", "transcription", "visual_context"],
                                        additionalProperties: false
                                    }
                                }
                            },
                            required: ["filename", "page_number", "stamps_detected"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["pages"],
                additionalProperties: false
            }
        };

        const response = await openai.chat.completions.create({
            model: "gpt-5",
            messages: [{ role: "user", content }],
            response_format: { type: "json_schema", json_schema: terminationSchema },
        });

        const usage = response.usage || {};

        return {
            data: JSON.parse(response.choices[0].message.content),
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
        };

    } catch (error) {
        console.error("Batch Error:", error.message);
        return { data: null, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    }
}

async function run() {
    const allFiles = Array.from({ length: 15 }, (_, i) => {
        const fileNum = (i + 2).toString().padStart(4, "0");
        const pageNum = i + 1;
        return `${fileNum}_${pageNum}.tif`;
        // const fileNum = (i + 1).toString().padStart(4, "0");
        // return `OFFICIAL_RECORDS_250_${fileNum}.tif`;
    });

    let combinedResults = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
        const batch = allFiles.slice(i, i + BATCH_SIZE);
        if (batch.length === 0) break;

        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const { data: rawBatch, inputTokens, outputTokens } = await detectEndings(batch, batchNum, allFiles);

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;

        if (rawBatch && rawBatch.pages) {
            combinedResults = combinedResults.concat(rawBatch.pages);
        }

        console.log(`Batch ${batchNum} tokens: input=${inputTokens}, output=${outputTokens}, total=${inputTokens + outputTokens}`);
    }

    console.log("\n=== COMBINED FINAL RESULTS ===");
    console.dir(combinedResults, { depth: null });

    console.log(`\n=== TOTAL TOKENS USED ===`);
    console.log(`Input tokens: ${totalInputTokens}`);
    console.log(`Output tokens: ${totalOutputTokens}`);
    console.log(`Overall total tokens: ${totalInputTokens + totalOutputTokens}`);
}

run();

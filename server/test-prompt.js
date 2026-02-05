import OpenAI from "openai";
import sharp from "sharp";
import path from 'path';
import fs from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEST_FILES_DIR = './test-files';

async function prepareImage(filename) {
    const filePath = path.join(TEST_FILES_DIR, filename);
    if (!fs.existsSync(filePath)) throw new Error(`File missing: ${filePath}`);
    const buffer = await sharp(filePath).png().toBuffer();
    return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function testDocumentBoundary(tifPaths) {
    try {
        const images = await Promise.all(tifPaths.map(file => prepareImage(file)));

        const content = [
            {
                type: "text",
                text: `You are a high-precision Texas Land Records Indexer. Analyze these ${tifPaths.length} pages.

                ### THE STAMP-FIRST RULE (Crucial for Overlapping Docs):
                1. Every "FILED FOR RECORD" stamp represents the legal end of ONE document.
                2. If a physical page has TWO stamps, you MUST output TWO document objects.
                3. A new document typically starts immediately after a stamp (Middle) or at the Top of a page.

                ### START ANCHORS:
                - "THE STATE OF .." or "COUNTY OF..."
                - Bold Titles (WARRANTY DEED, DEED OF TRUST, RELEASE).

                ### SPATIAL MAPPING:
                - TOP: Y-axis 0-30%
                - MIDDLE: Y-axis 31-70%
                - BOTTOM: Y-axis 71-100%

                ### TASK:
                List every document. If a document starts and ends on the same page, record it as such. If a page has a stamp in the middle and another at the bottom, treat them as two separate filings.`
            }
        ];

        images.forEach((url, index) => {
            content.push({ type: "text", text: `--- PHYSICAL PAGE ${index + 1} (File: ${tifPaths[index]}) ---` });
            content.push({ type: "image_url", image_url: { url, detail: "high" } });
        });

        const multiDocumentSchema = {
            name: "split_aware_indexing",
            strict: true,
            schema: {
                type: "object",
                properties: {
                    documents: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                document_type: { type: "string" },
                                start_page: { type: "number" },
                                start_section: { type: "string", enum: ["Top", "Middle", "Bottom"] },
                                end_page: { type: "number" },
                                end_section: { type: "string", enum: ["Top", "Middle", "Bottom"] },
                                stamp_details: { type: "string", description: "Transcribe the Time or Instrument # from the stamp to differentiate it." },
                                spatial_reasoning: { type: "string", description: "Why did you split here? (e.g., 'Found second stamp at bottom of page 9')" }
                            },
                            required: ["document_type", "start_page", "start_section", "end_page", "end_section", "stamp_details", "spatial_reasoning"],
                            additionalProperties: false
                        }
                    }
                },
                required: ["documents"],
                additionalProperties: false
            }
        };

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content }],
            response_format: { type: "json_schema", json_schema: multiDocumentSchema },
            temperature: 0
        });

        console.log(`\n--- TOKEN USAGE ---`);
        console.log(`Input Tokens:  ${response.usage.prompt_tokens}`);
        console.log(`Output Tokens: ${response.usage.completion_tokens}`);
        console.log(`Total Tokens:  ${response.usage.total_tokens}`);

        const result = JSON.parse(response.choices[0].message.content);
        console.table(result.documents);

    } catch (error) {
        console.error("Error:", error.message);
    }
}

const filesToTest = Array.from({ length: 10 }, (_, i) => {
    const fileNum = (i + 2).toString().padStart(4, '0');
    const pageNum = i + 1;
    return `${fileNum}_${pageNum}.tif`;
});

testDocumentBoundary(filesToTest);

// 25-29 tif for 242 folder
// 4.1-mini not strong enough
// 4o costly but works
// 5-mini works good, failed one time
// this version is good for documents but fails at higher counts

// also fails for the file 0013_12 since it has the file for report at the top
import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { sync } from 'glob'

async function downloadFile(url, path) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error("Downloaded file is empty");

    await fs.promises.writeFile(path, buffer);

    const stats = await fs.promises.stat(path);
    if (stats.size === 0) throw new Error("Written temp file is empty");
  } catch (error) {
    const truncatedUrl = url.length > 60 ? url.slice(0, 60) + "…" : url;
    console.error(`Failed to download file from ${truncatedUrl}:`, error);
    throw error;  // rethrow so calling code can handle it
  }
}

function isPdfBuffer(buffer) {
  return buffer.slice(0, 5).toString("utf8") === "%PDF-";
}

function isTiffBuffer(buffer) {
  if (buffer.length < 4) return false;
  const littleEndianTiff = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
  const bigEndianTiff = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
  return littleEndianTiff || bigEndianTiff;
}

function isTiffUrl(url) {
  return /\.tiff?(?:\?|$)/i.test(url);
}

function isPdfType(fileType = "") {
  return String(fileType).toLowerCase().includes("application/pdf");
}

function isTiffType(fileType = "") {
  const normalized = String(fileType).toLowerCase();
  return normalized.includes("image/tiff") || normalized.includes("image/tif");
}

function pdfPageToBase64(tempPdfPath, PRSERV, pageNum) {
  const tempPngPrefix = `temp_page_${PRSERV}_${pageNum}`;
  const cmd = `pdftoppm -png -f ${pageNum} -l ${pageNum} "${tempPdfPath}" "${tempPngPrefix}"`;

  return new Promise((resolve, reject) => {
    console.log(`Running pdftoppm for page ${pageNum}...`);

    exec(cmd, { timeout: 30000 }, async (error, stdout, stderr) => {
      if (error) {
        console.error(`pdftoppm error on page ${pageNum}`);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
        return reject(error);
      }

      try {
        const files = sync(`${tempPngPrefix}-*.png`);
        if (files.length === 0) {
          const msg = `No output PNG found for page ${pageNum}`;
          console.error(msg);
          return reject(new Error(msg));
        }

        const tempPngPath = files[0];
        console.log(`Processing PNG: ${tempPngPath}`);

        const buffer = await sharp(tempPngPath).resize(800).toBuffer();

        if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath);

        const base64Image = buffer.toString('base64');
        resolve(`data:image/png;base64,${base64Image}`);
      } catch (err) {
        console.error(`Error processing PNG for page ${pageNum}:`, err);
        reject(err);
      }
    });
  });
}

async function tiffPagesToBase64(tempPath) {
  const metadata = await sharp(tempPath, { pages: -1, failOn: "none" }).metadata();
  const pageCount = metadata.pages || 1;
  const base64Images = [];

  for (let pageNum = 0; pageNum < pageCount; pageNum++) {
    const buffer = await sharp(tempPath, { page: pageNum, failOn: "none" })
      .resize(800)
      .png()
      .toBuffer();
    base64Images.push(`data:image/png;base64,${buffer.toString("base64")}`);
  }

  return base64Images;
}

export async function getPdfPagesAsBase64(pdfUrl, PRSERV) {
  const tempPdfPath = `temp_${PRSERV}.pdf`;

  try {
    await downloadFile(pdfUrl, tempPdfPath);
  } catch (error) {
    console.log("Error downloading file:", error);
    return [];
  }

  const base64Images = await getPdfPagesAsBase64FromPath(tempPdfPath, PRSERV);

  if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

  return base64Images;
}

async function getPdfPagesAsBase64FromPath(tempPdfPath, PRSERV) {
  let pdfDoc;
  try {
    const pdfBuffer = await fs.promises.readFile(tempPdfPath);
    pdfDoc = await PDFDocument.load(pdfBuffer);
  } catch (error) {
    console.error("Error reading or loading PDF file:", error);
    return [];
  }

  const totalPages = pdfDoc.getPageCount();
  const base64Images = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    try {
      const base64Image = await pdfPageToBase64(tempPdfPath, PRSERV, pageNum);
      base64Images.push(base64Image);
    } catch (error) {
      console.error(`Failed to convert page ${pageNum} to base64:`, error);
    }
  }

  return base64Images;
}

export async function getDocumentPagesAsBase64(fileUrl, PRSERV, fileType = null) {
  const tempFilePath = `temp_${PRSERV}.bin`;

  try {
    await downloadFile(fileUrl, tempFilePath);
  } catch (error) {
    console.log("Error downloading file:", error);
    return [];
  }

  try {
    const fileBuffer = await fs.promises.readFile(tempFilePath);
    if (isPdfType(fileType) || isPdfBuffer(fileBuffer)) {
      return await getPdfPagesAsBase64FromPath(tempFilePath, PRSERV);
    }

    if (isTiffType(fileType) || isTiffBuffer(fileBuffer) || isTiffUrl(fileUrl)) {
      return await tiffPagesToBase64(tempFilePath);
    }

    console.error("Unsupported file format for AI processing");
    return [];
  } catch (error) {
    console.error("Failed to process document pages:", error);
    return [];
  } finally {
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
}

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
    if (!buffer.length) throw new Error("Downloaded PDF is empty");

    await fs.promises.writeFile(path, buffer);

    const stats = await fs.promises.stat(path);
    if (stats.size === 0) throw new Error("Written temp PDF is empty");
  } catch (error) {
    const truncatedUrl = url.length > 60 ? url.slice(0, 60) + "…" : url;
    console.error(`Failed to download file from ${truncatedUrl}:`, error);
    throw error;  // rethrow so calling code can handle it
  }
}

function pdfPageToBase64(tempPdfPath, PRSERV, pageNum) {
  const tempPngPrefix = `temp_page_${PRSERV}_${pageNum}`;
  const cmd = `pdftoppm -png -f ${pageNum} -l ${pageNum} "${tempPdfPath}" "${tempPngPrefix}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, async (error) => {
      if (error) {
        console.error(`Error running pdftoppm on page ${pageNum}:`, error);
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
        const buffer = await sharp(tempPngPath).resize(800).toBuffer();

        if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath);

        const base64Image = buffer.toString('base64');
        resolve(`data:image/png;base64,${base64Image}`);
      } catch (err) {
        if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath);
        console.error(`Error processing PNG for page ${pageNum}:`, err);
        reject(err);
      }
    });
  });
}

export async function getPdfPagesAsBase64(pdfUrl, PRSERV) {
  const tempPdfPath = `temp_${PRSERV}.pdf`;

  try {
    await downloadFile(pdfUrl, tempPdfPath);
  } catch (error) {
    console.log("Error downloading file:", error);
    return [];
  }

  let pdfDoc;
  try {
    const pdfBuffer = await fs.promises.readFile(tempPdfPath);
    pdfDoc = await PDFDocument.load(pdfBuffer);
  } catch (error) {
    console.error("Error reading or loading PDF file:", error);
    if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
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

  if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

  return base64Images;
}
import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { sync } from 'glob'

async function downloadFile(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded PDF is empty");

  await fs.promises.writeFile(path, buffer);

  const stats = await fs.promises.stat(path);
  if (stats.size === 0) throw new Error("Written temp PDF is empty");
}

function pdfPageToBase64(tempPdfPath, PRSERV, pageNum) {
  const tempPngPrefix = `temp_page_${PRSERV}_${pageNum}`;
  const cmd = `pdftoppm -png -f ${pageNum} -l ${pageNum} "${tempPdfPath}" "${tempPngPrefix}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, async (error) => {
      if (error) {
        return reject(error);
      }

      const files = sync(`${tempPngPrefix}-*.png`);
      if (files.length === 0) throw new Error('No output PNG found');

      const tempPngPath = files[0];

      try {
        const buffer = await sharp(tempPngPath)
          .resize(800)
          .toBuffer();

        if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath);

        const base64Image = buffer.toString('base64');
        resolve(`data:image/png;base64,${base64Image}`);
      } catch (err) {
        if (fs.existsSync(tempPngPath)) fs.unlinkSync(tempPngPath);
        reject(err);
      }
    });
  });
}

export async function getPdfPagesAsBase64(pdfUrl, PRSERV) {
  const tempPdfPath = `temp_${PRSERV}.pdf`;

  await downloadFile(pdfUrl, tempPdfPath);

  const pdfBuffer = await fs.promises.readFile(tempPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  const base64Images = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const base64Image = await pdfPageToBase64(tempPdfPath, PRSERV, pageNum);
    base64Images.push(base64Image);
  }

  if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

  return base64Images;
}
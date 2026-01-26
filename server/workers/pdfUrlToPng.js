import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import sharp from 'sharp';

async function downloadFile(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);

  const fileStream = fs.createWriteStream(path);
  await new Promise((resolve, reject) => {
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}

export async function pdfUrlToPngBase64(url, pageNum = 1) {
  const tempPdfPath = 'temp.pdf';

  await downloadFile(url, tempPdfPath);

  return new Promise((resolve, reject) => {
    const cmd = `pdftoppm -png -f ${pageNum} -l ${pageNum} "${tempPdfPath}" temp_page`;

    exec(cmd, async (error) => {
      if (error) {
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
        return reject(error);
      }

      const tempFile = `temp_page-${pageNum}.png`;

      try {
        const buffer = await sharp(tempFile)
          .resize(800)
          .toBuffer();

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);

        const base64Image = buffer.toString('base64');
        resolve(base64Image);
      } catch (err) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
        reject(err);
      }
    });
  });
}
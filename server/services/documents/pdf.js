import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { listFilesByPrefix, getObjectBuffer } from '../../lib/s3.js';

/**
 * Get county name variants for S3 prefix lookup.
 */
function getCountyVariants(countyName) {
  const baseCounty = countyName
    .replace(/\.\./g, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();

  return Array.from(new Set([
    baseCounty,
    baseCounty.toLowerCase(),
    baseCounty.toUpperCase(),
    baseCounty.replace(/\s+/g, '_'),
    baseCounty.replace(/\s+/g, ''),
    baseCounty.replace(/\s+/g, '-'),
    baseCounty.replace(/\s+County$/i, '').trim(),
    `${baseCounty.replace(/\s+County$/i, '').trim()} County`,
    `${baseCounty.replace(/\s+County$/i, '').trim()}_County`,
    `${baseCounty.replace(/\s+County$/i, '').trim()}-County`
  ].filter(Boolean)));
}

/**
 * Find S3 keys for a document prefix, trying county name variants.
 * Returns { keys, triedPrefixes }.
 */
export async function findKeysForPrefix(userPrefix, countyName) {
  const variants = getCountyVariants(countyName);
  const triedPrefixes = [];

  for (const candidate of variants) {
    const prefix = `${candidate}/${userPrefix}`;
    triedPrefixes.push(prefix);
    const found = await listFilesByPrefix(prefix);
    if (found.length > 0) {
      console.log(`Found files with prefix: ${prefix}`);
      return { keys: found, triedPrefixes };
    }
  }

  return { keys: [], triedPrefixes };
}

/**
 * Build PDF from S3 keys (images merged into single PDF).
 * If first key is PDF, returns it directly. Otherwise converts images to PDF.
 */
export async function buildPdfFromKeys(keys) {
  const firstKey = keys[0];
  if (firstKey.toLowerCase().endsWith('.pdf')) {
    return await getObjectBuffer(firstKey);
  }

  const pdfDoc = await PDFDocument.create();

  for (const key of keys) {
    const ext = key.toLowerCase();
    const isKnownImage = ext.endsWith('.tif') || ext.endsWith('.tiff') || ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp');
    const isNumberedExtension = /\.\d{3,}$/.test(ext);

    if (!isKnownImage && !isNumberedExtension) {
      console.warn('Skipping unsupported format for PDF merge:', key);
      continue;
    }

    try {
      const imageBuffer = await getObjectBuffer(key);
      const image = sharp(imageBuffer);
      const metadata = await image.metadata();
      const pageCount = metadata.pages || 1;

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const pngBuffer = await sharp(imageBuffer, { page: pageIndex }).png().toBuffer();
        const pngImage = await pdfDoc.embedPng(pngBuffer);
        const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
        page.drawImage(pngImage, {
          x: 0, y: 0,
          width: pngImage.width,
          height: pngImage.height,
        });
      }
    } catch (err) {
      console.error(`Failed to process file ${key}:`, err.message);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

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
  console.log(`buildPdfFromKeys called with ${keys.length} keys:`, keys);
  
  const firstKey = keys[0];
  if (firstKey.toLowerCase().endsWith('.pdf')) {
    console.log(`First key is PDF, returning directly: ${firstKey}`);
    return await getObjectBuffer(firstKey);
  }

  const pdfDoc = await PDFDocument.create();
  let pagesAdded = 0;

  for (const key of keys) {
    const ext = key.toLowerCase();
    const isKnownImage = ext.endsWith('.tif') || ext.endsWith('.tiff') || ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp');
    const isNumberedExtension = /\.\d{3,}$/.test(ext);

    if (!isKnownImage && !isNumberedExtension) {
      console.warn('Skipping unsupported format for PDF merge:', key);
      continue;
    }

    try {
      console.log(`Processing file: ${key}`);
      const imageBuffer = await getObjectBuffer(key);
      console.log(`Got buffer for ${key}, size: ${imageBuffer.length} bytes`);
      
      // For numbered extensions (.001, .002, etc.), try to detect format from buffer
      // These are typically TIFF files
      let sharpOptions = { failOn: 'none' }; // Be lenient with malformed metadata
      if (isNumberedExtension) {
        // Check magic bytes to determine format
        const header = imageBuffer.slice(0, 4);
        const isTiff = (header[0] === 0x49 && header[1] === 0x49) || // Little-endian TIFF (II)
                       (header[0] === 0x4D && header[1] === 0x4D);   // Big-endian TIFF (MM)
        if (isTiff) {
          console.log(`Detected TIFF format for numbered file: ${key}`);
          // Sharp should auto-detect TIFF, but let's be explicit
        } else {
          console.log(`Unknown format for numbered file ${key}, header bytes:`, header);
        }
      }
      
      const image = sharp(imageBuffer, sharpOptions);
      const metadata = await image.metadata();
      console.log(`Image metadata for ${key}:`, JSON.stringify(metadata));
      const pageCount = metadata.pages || 1;

      for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const pngBuffer = await sharp(imageBuffer, { page: pageIndex, failOn: 'none' }).png().toBuffer();
        const pngImage = await pdfDoc.embedPng(pngBuffer);
        const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
        page.drawImage(pngImage, {
          x: 0, y: 0,
          width: pngImage.width,
          height: pngImage.height,
        });
        pagesAdded++;
      }
      console.log(`Successfully processed ${key}, added ${pageCount} page(s)`);
    } catch (err) {
      console.error(`Failed to process file ${key}:`, err.message);
      console.error(`Full error:`, err);
    }
  }

  console.log(`PDF generation complete. Total pages added: ${pagesAdded}`);
  
  if (pagesAdded === 0) {
    console.error('No pages were added to PDF! Keys were:', keys);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

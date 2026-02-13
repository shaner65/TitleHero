import { getS3BucketName } from '../../config.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

function sanitizeCounty(countyName) {
  return countyName
    .replace(/\.\./g, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function generateBookId() {
  const nowPart = Date.now().toString(36).toUpperCase();
  const randPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BOOK_${nowPart}_${randPart}`;
}

/**
 * Generate presigned URLs for TIF book upload.
 * Returns { bookId, processingPrefix, pages, uploads }.
 */
export async function presignBatch(body) {
  let { bookId, countyName, files } = body || {};

  if (!countyName || typeof countyName !== 'string') {
    throw Object.assign(new Error('countyName is required'), { status: 400 });
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw Object.assign(new Error('files array is required'), { status: 400 });
  }

  if (!bookId || typeof bookId !== 'string' || !bookId.trim()) {
    bookId = generateBookId();
  }

  const safeCounty = sanitizeCounty(countyName);
  const processingPrefix = `processing/${safeCounty}/${bookId}/`;

  const pages = files.map((file) => ({
    name: file.name || 'page.tif',
    key: `${processingPrefix}${file.name || 'page.tif'}`,
    type: file.type || 'image/tiff',
    size: file.size ?? null,
  }));

  const bucket = await getS3BucketName();
  const uploads = await Promise.all(
    pages.map(async (page) => {
      const contentType =
        page.type ||
        (page.key.toLowerCase().endsWith('.tif') || page.key.toLowerCase().endsWith('.tiff')
          ? 'image/tiff'
          : 'application/octet-stream');
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: page.key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(s3, command, { expiresIn: 3000 });
      return { key: page.key, url };
    })
  );

  console.log(`[TIF Books] Presign-batch: bookId=${bookId}, ${pages.length} pages, county=${safeCounty}`);

  return {
    bookId,
    processingPrefix,
    pages,
    uploads,
  };
}

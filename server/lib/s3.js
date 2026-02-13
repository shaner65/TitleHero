import { getS3BucketName } from '../config.js';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });

/**
 * List files by S3 prefix, sorted numeric-aware (e.g. PR123.1.tif, PR123.2.tif).
 * @param {string} prefix - S3 prefix
 * @param {{ logPrefix?: string }} options - optional: logPrefix for tifBooks logging
 */
export async function listFilesByPrefix(prefix, options = {}) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  const keys = (out.Contents || []).map(o => o.Key).filter(Boolean);
  keys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (options.logPrefix) {
    console.log(`[${options.logPrefix}] Listed ${keys.length} file(s) at prefix ${prefix}`);
  }
  return keys;
}

/**
 * Get object buffer from S3. Handles both transformToByteArray and arrayBuffer body patterns.
 */
export async function getObjectBuffer(key) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return out.Body?.transformToByteArray
    ? Buffer.from(await out.Body.transformToByteArray())
    : Buffer.from(await out.Body.arrayBuffer());
}

/**
 * Create a folder marker in S3 (empty object with trailing slash).
 */
export async function createFolderMarker(key) {
  const BUCKET = await getS3BucketName();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key.endsWith('/') ? key : `${key}/`,
    Body: Buffer.from(''),
    ContentType: 'application/x-directory',
  }));
}

/**
 * Delete all objects with the given prefix.
 */
export async function deleteObjectsByPrefix(prefix) {
  const BUCKET = await getS3BucketName();
  const out = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  if (out.KeyCount > 0) {
    const objectsToDelete = out.Contents.map(obj => ({ Key: obj.Key }));
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: objectsToDelete,
        Quiet: true,
      },
    }));
  }
}

export { s3 };

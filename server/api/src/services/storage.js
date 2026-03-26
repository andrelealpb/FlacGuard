import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, unlinkSync, existsSync, statSync } from 'fs';
import { basename } from 'path';

const S3_ENDPOINT   = process.env.S3_ENDPOINT;
const S3_BUCKET     = process.env.S3_BUCKET;
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_REGION     = process.env.S3_REGION || 'us-east-1';
const S3_RECORDINGS_PREFIX = process.env.S3_RECORDINGS_PREFIX || 'recordings';
const S3_FACES_PREFIX      = process.env.S3_FACES_PREFIX || 'faces';
const S3_WATCHLIST_PREFIX  = process.env.S3_WATCHLIST_PREFIX || 'watchlist';

let s3 = null;

function getClient() {
  if (s3) return s3;
  if (!isS3Configured()) return null;
  s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: true, // Required for Contabo, MinIO, etc.
  });
  return s3;
}

/**
 * Check if S3 is configured. If not, all operations fall back to local disk.
 */
export function isS3Configured() {
  return !!(S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY);
}

/**
 * Build S3 key for a recording file.
 * Format: recordings/{tenantId}/{cameraId}/{YYYY-MM-DD}/{filename}
 */
export function buildRecordingKey(tenantId, cameraId, filename) {
  const date = new Date().toISOString().slice(0, 10);
  return `${S3_RECORDINGS_PREFIX}/${tenantId}/${cameraId}/${date}/${filename}`;
}

/**
 * Build S3 key for a face image.
 * Format: faces/{tenantId}/{cameraId}/{YYYY-MM-DD}/{filename}
 */
export function buildFaceImageKey(tenantId, cameraId, filename) {
  const date = new Date().toISOString().slice(0, 10);
  return `${S3_FACES_PREFIX}/${tenantId}/${cameraId}/${date}/${filename}`;
}

/**
 * Build S3 key for a watchlist photo.
 * Format: watchlist/{tenantId}/{watchlistId}.jpg
 */
export function buildWatchlistKey(tenantId, watchlistId, ext = 'jpg') {
  return `${S3_WATCHLIST_PREFIX}/${tenantId}/${watchlistId}.${ext}`;
}

/**
 * Upload a local file to S3.
 * Returns the S3 key on success, null on failure.
 */
export async function uploadFile(localPath, s3Key, contentType = 'application/octet-stream') {
  const client = getClient();
  if (!client) return null;

  try {
    const fileSize = statSync(localPath).size;
    const body = createReadStream(localPath);

    await client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
      ContentLength: fileSize,
    }));

    console.log(`[S3] Uploaded ${s3Key} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
    return s3Key;
  } catch (err) {
    console.error(`[S3] Upload failed for ${s3Key}:`, err.message);
    return null;
  }
}

/**
 * Upload a recording to S3, then delete local file on success.
 * Returns { s3Key } or null if S3 not configured or upload failed.
 */
export async function uploadRecording(localPath, tenantId, cameraId) {
  if (!isS3Configured()) return null;
  if (!existsSync(localPath)) return null;

  const filename = basename(localPath);
  const s3Key = buildRecordingKey(tenantId, cameraId, filename);
  const result = await uploadFile(localPath, s3Key, 'video/mp4');

  if (result) {
    try {
      unlinkSync(localPath);
      console.log(`[S3] Deleted local file: ${localPath}`);
    } catch (err) {
      console.error(`[S3] Failed to delete local file ${localPath}:`, err.message);
    }
    return { s3Key };
  }

  return null;
}

/**
 * Upload a face image to S3. Does NOT delete local file (may still be needed).
 */
export async function uploadFaceImage(localPath, tenantId, cameraId) {
  if (!isS3Configured()) return null;
  if (!existsSync(localPath)) return null;

  const filename = basename(localPath);
  const s3Key = buildFaceImageKey(tenantId, cameraId, filename);
  const result = await uploadFile(localPath, s3Key, 'image/jpeg');
  return result ? { s3Key } : null;
}

/**
 * Upload a watchlist photo to S3.
 */
export async function uploadWatchlistPhoto(localPath, tenantId, watchlistId) {
  if (!isS3Configured()) return null;
  if (!existsSync(localPath)) return null;

  const s3Key = buildWatchlistKey(tenantId, watchlistId);
  const result = await uploadFile(localPath, s3Key, 'image/jpeg');
  return result ? { s3Key } : null;
}

/**
 * Generate a pre-signed URL for reading an S3 object.
 * Default expiry: 1 hour.
 * Optional overrides: { ResponseContentDisposition, ResponseContentType, ... }
 */
export async function getPresignedUrl(s3Key, expiresIn = 3600, overrides = {}) {
  const client = getClient();
  if (!client || !s3Key) return null;

  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ...overrides,
    });
    return await getSignedUrl(client, command, { expiresIn });
  } catch (err) {
    console.error(`[S3] Presigned URL failed for ${s3Key}:`, err.message);
    return null;
  }
}

/**
 * Delete a single object from S3.
 */
export async function deleteObject(s3Key) {
  const client = getClient();
  if (!client || !s3Key) return false;

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    }));
    console.log(`[S3] Deleted ${s3Key}`);
    return true;
  } catch (err) {
    console.error(`[S3] Delete failed for ${s3Key}:`, err.message);
    return false;
  }
}

/**
 * Delete all objects under a prefix (e.g., all recordings for a camera).
 */
export async function deleteByPrefix(prefix) {
  const client = getClient();
  if (!client || !prefix) return 0;

  let deleted = 0;
  let continuationToken;

  try {
    do {
      const list = await client.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of list.Contents || []) {
        await deleteObject(obj.Key);
        deleted++;
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : null;
    } while (continuationToken);
  } catch (err) {
    console.error(`[S3] deleteByPrefix failed for ${prefix}:`, err.message);
  }

  return deleted;
}

import AWS from "aws-sdk";
import fs from "fs/promises";
import { isBackupFile, listLocalBackups } from "../backup.js";
import { getBackupConfig, getS3Config } from "../config.js";
import logger from "../logger.js";

let s3Client = null;
let lastConfig = null;

/**
 * Initialize S3 client
 * Re-creates client if configuration changes
 */
function getS3Client() {
  const config = getS3Config();

  // Create a config signature to detect changes
  const configSignature = JSON.stringify({
    accessKeyId: config.accessKeyId,
    region: config.region,
    endpoint: config.endpoint,
    s3ForcePathStyle: config.s3ForcePathStyle,
  });

  // Re-create client if config changed or doesn't exist
  if (!s3Client || lastConfig !== configSignature) {
    const s3Options = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
    };

    // Support for S3-compatible services (Supabase, MinIO, etc.)
    if (config.endpoint) {
      s3Options.endpoint = config.endpoint;
    }

    if (config.s3ForcePathStyle) {
      s3Options.s3ForcePathStyle = true;
    }

    s3Client = new AWS.S3(s3Options);
    lastConfig = configSignature;
  }

  return s3Client;
}

function getRootPrefix() {
  const config = getS3Config();
  return config.prefix ? config.prefix.replace(/\/$/, "") + "/" : "";
}

function buildKey(connectionId, filename) {
  return `${getRootPrefix()}${connectionId}/${filename}`;
}

/**
 * Check if S3 is configured
 */
export function isS3Configured() {
  const config = getS3Config();
  return !!(config.accessKeyId && config.secretAccessKey && config.bucket);
}

/**
 * Upload backup to S3
 */
export async function uploadToS3(filepath, connectionId, filename) {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const s3 = getS3Client();
  const config = getS3Config();
  const fileContent = await fs.readFile(filepath);

  const params = {
    Bucket: config.bucket,
    Key: buildKey(connectionId, filename),
    Body: fileContent,
    ContentType: "application/octet-stream",
  };

  try {
    await s3.upload(params).promise();
    return true;
  } catch (error) {
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

/**
 * List backups from S3, for one connection or all of them.
 * Keys are laid out as <prefix>/<connectionId>/<filename>.
 */
export async function listS3Backups(connectionId = null) {
  if (!isS3Configured()) {
    return [];
  }

  const s3 = getS3Client();
  const config = getS3Config();
  const rootPrefix = getRootPrefix();
  const searchPrefix = connectionId ? `${rootPrefix}${connectionId}/` : rootPrefix;

  try {
    const items = [];
    let continuationToken;

    do {
      const data = await s3
        .listObjectsV2({
          Bucket: config.bucket,
          Prefix: searchPrefix,
          ContinuationToken: continuationToken,
        })
        .promise();

      for (const item of data.Contents || []) {
        const parts = item.Key.slice(rootPrefix.length).split("/");
        if (parts.length !== 2 || !isBackupFile(parts[1])) continue;
        items.push({
          connectionId: parts[0],
          filename: parts[1],
          size: item.Size,
          date: item.LastModified,
          location: "remote",
          format: parts[1].split(".").pop().toLowerCase(),
        });
      }

      continuationToken = data.IsTruncated ? data.NextContinuationToken : null;
    } while (continuationToken);

    return items;
  } catch (error) {
    logger.error("Failed to list S3 backups", error);
    return [];
  }
}

/**
 * Download backup from S3
 */
export async function downloadFromS3(connectionId, filename, destinationPath) {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const s3 = getS3Client();
  const config = getS3Config();

  try {
    const data = await s3
      .getObject({ Bucket: config.bucket, Key: buildKey(connectionId, filename) })
      .promise();
    await fs.writeFile(destinationPath, data.Body);
    return true;
  } catch (error) {
    throw new Error(`S3 download failed: ${error.message}`);
  }
}

/**
 * Delete backup from S3
 */
export async function deleteFromS3(connectionId, filename) {
  if (!isS3Configured()) {
    throw new Error("S3 is not configured");
  }

  const s3 = getS3Client();
  const config = getS3Config();

  try {
    await s3
      .deleteObject({
        Bucket: config.bucket,
        Key: buildKey(connectionId, filename),
      })
      .promise();
    return true;
  } catch (error) {
    throw new Error(`S3 delete failed: ${error.message}`);
  }
}

/**
 * List all backups from local and remote storage
 */
export async function listAllBackups(connectionId = null) {
  const storage = getBackupConfig().storage;

  let localBackups = [];
  let remoteBackups = [];

  if (storage === "local" || storage === "both") {
    localBackups = await listLocalBackups(connectionId);
  }

  if ((storage === "remote" || storage === "both") && isS3Configured()) {
    remoteBackups = await listS3Backups(connectionId);
  }

  const backupMap = new Map();
  const keyOf = (backup) => `${backup.connectionId}/${backup.filename}`;

  for (const backup of localBackups) {
    backupMap.set(keyOf(backup), { ...backup, location: "local" });
  }

  for (const backup of remoteBackups) {
    const key = keyOf(backup);
    if (backupMap.has(key)) {
      backupMap.set(key, { ...backupMap.get(key), location: "both" });
    } else {
      backupMap.set(key, { ...backup, location: "remote" });
    }
  }

  return Array.from(backupMap.values()).sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );
}

/**
 * Compute statistics for a list of backups
 */
export function computeBackupStats(allBackups) {
  const stats = {
    total: allBackups.length,
    local: 0,
    remote: 0,
    totalSize: 0,
  };

  for (const backup of allBackups) {
    stats.totalSize += backup.size;

    if (backup.location === "local") {
      stats.local++;
    } else if (backup.location === "remote") {
      stats.remote++;
    } else if (backup.location === "both") {
      stats.local++;
      stats.remote++;
    }
  }

  return stats;
}

/**
 * Get backup statistics
 */
export async function getBackupStats(connectionId = null) {
  return computeBackupStats(await listAllBackups(connectionId));
}

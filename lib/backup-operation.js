import { createBackup } from "./backup.js";
import { getBackupConfig } from "./config.js";
import { getConnection } from "./connections.js";
import logger from "./logger.js";
import {
  addOperationStep,
  completeOperation,
  failOperation,
  startOperation,
} from "./operation-log.js";
import { isS3Configured, uploadToS3 } from "./storage/s3.js";

const DETAIL_LABELS = {
  tables: "Table",
  sequences: "Sequence",
  collections: "Collection",
};

/**
 * Log one info step per backed up / restored object (tables, collections, ...)
 */
export function logObjectDetails(base, details, verb) {
  for (const [key, label] of Object.entries(DETAIL_LABELS)) {
    for (const name of details?.[key] || []) {
      addOperationStep({
        ...base,
        status: "info",
        step: `${label} ${verb}`,
        details: name,
      });
    }
  }
}

export function resolveLocation(storage) {
  if (storage === "local" || !isS3Configured()) return "local";
  return storage === "remote" ? "remote" : "both";
}

/**
 * Create a backup for a connection, upload to S3 when configured, and record
 * every step in the operation log.
 */
export async function runBackupOperation(connectionId, format) {
  const connection = await getConnection(connectionId);
  const backupConfig = getBackupConfig();
  const base = {
    type: "backup",
    connectionId,
    connectionTitle: connection.title,
  };
  const operationId = startOperation("backup", null, base);
  base.operationId = operationId;

  try {
    addOperationStep({
      ...base,
      status: "in_progress",
      step: "Creating backup file",
      details: `${connection.type} / ${connection.database}`,
    });

    const result = await createBackup(connectionId, format);
    base.filename = result.filename;
    logger.info(
      `Backup created for "${connection.title}": ${result.filename} (${result.size} bytes)`,
    );
    addOperationStep({
      ...base,
      status: "success",
      step: "Backup file created",
      details: `${result.size} bytes, format: ${result.format}`,
    });
    logObjectDetails(base, result.details, "backed up");

    const location = resolveLocation(backupConfig.storage);
    if (location !== "local") {
      addOperationStep({
        ...base,
        status: "in_progress",
        step: "Uploading backup to S3",
      });
      await uploadToS3(result.path, connectionId, result.filename);
      logger.info(`Backup uploaded to S3: ${connectionId}/${result.filename}`);
      addOperationStep({ ...base, status: "success", step: "Backup uploaded to S3" });
    }

    completeOperation({ ...base, step: `Backup completed (${location})` });
    return { ...result, location };
  } catch (error) {
    failOperation({ ...base, step: "Backup failed", errorMessage: error.message });
    throw error;
  }
}

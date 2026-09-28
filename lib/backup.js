import fs from "fs/promises";
import path from "path";
import { getBackupConfig } from "./config.js";
import { getConnection } from "./connections.js";
import { BACKUP_EXTENSIONS, getDriver } from "./drivers/index.js";
import logger from "./logger.js";

const CONNECTION_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

function assertConnectionId(connectionId) {
  if (!CONNECTION_ID_PATTERN.test(String(connectionId || ""))) {
    throw new Error("Invalid connection id");
  }
}

export function isBackupFile(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  return BACKUP_EXTENSIONS.includes(ext);
}

/**
 * Generate backup filename with timestamp
 */
export function generateBackupFilename(connection, format) {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");
  const driver = getDriver(connection.type);
  const database = connection.database.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `backup_${connection.type}_${database}_${timestamp}.${driver.extension(format)}`;
}

/**
 * Get local backup directory for a connection
 */
export function getConnectionBackupDir(connectionId) {
  assertConnectionId(connectionId);
  return path.join(getBackupConfig().localPath, connectionId);
}

/**
 * Ensure backup directory exists (root, or a connection's folder)
 */
export async function ensureBackupDir(connectionId = null) {
  const dir = connectionId
    ? getConnectionBackupDir(connectionId)
    : getBackupConfig().localPath;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Create a backup for a connection using its driver
 */
export async function createBackup(connectionId, format) {
  const connection = await getConnection(connectionId);
  const driver = getDriver(connection.type);
  const backupConfig = getBackupConfig();
  const backupDir = await ensureBackupDir(connectionId);

  const backupFormat = driver.resolveFormat(format || backupConfig.format);
  const filename = generateBackupFilename(connection, backupFormat);
  const filepath = path.join(backupDir, filename);

  try {
    const details = await driver.backup(connection, filepath, backupFormat);
    const stats = await fs.stat(filepath);

    return {
      connection,
      filename,
      path: filepath,
      size: stats.size,
      format: backupFormat,
      details,
    };
  } catch (error) {
    try {
      await fs.unlink(filepath);
    } catch {}
    throw new Error(`Backup failed: ${error.message}`);
  }
}

/**
 * Restore a target connection from a backup file that belongs to a source
 * connection of the same database type.
 * @param {string} customPath - Optional file path (used for temporary S3 downloads)
 */
export async function restoreBackup(
  targetConnectionId,
  sourceConnectionId,
  filename,
  customPath = null,
) {
  const target = await getConnection(targetConnectionId);
  const source = await getConnection(sourceConnectionId);

  if (target.type !== source.type) {
    throw new Error(
      `Cannot restore a ${source.type} backup into a ${target.type} database`,
    );
  }

  const driver = getDriver(target.type);
  const safeName = path.basename(filename);
  const ext = safeName.toLowerCase().split(".").pop();
  if (!driver.formats.includes(ext)) {
    throw new Error(`.${ext} files cannot be restored into ${driver.label}`);
  }

  const filepath = customPath || getLocalBackupPath(sourceConnectionId, safeName);
  try {
    await fs.access(filepath);
  } catch {
    throw new Error(`Backup file not found: ${safeName}`);
  }

  try {
    const details = await driver.restore(target, filepath, source);
    return { success: true, target, source, details };
  } catch (error) {
    throw new Error(`Restore failed: ${error.message}`);
  }
}

async function listBackupsInDir(dir, connectionId) {
  const backups = [];
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return backups;
  }

  for (const file of files) {
    if (!isBackupFile(file)) continue;
    const stats = await fs.stat(path.join(dir, file));
    if (!stats.isFile()) continue;
    backups.push({
      connectionId,
      filename: file,
      size: stats.size,
      date: stats.mtime,
      location: "local",
      format: file.split(".").pop().toLowerCase(),
    });
  }

  return backups;
}

/**
 * List local backup files, for one connection or all connection folders
 */
export async function listLocalBackups(connectionId = null) {
  if (connectionId) {
    return listBackupsInDir(getConnectionBackupDir(connectionId), connectionId);
  }

  const root = await ensureBackupDir();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && CONNECTION_ID_PATTERN.test(e.name))
      .map((e) => listBackupsInDir(path.join(root, e.name), e.name)),
  );
  return results.flat();
}

/**
 * Delete local backup file
 */
export async function deleteLocalBackup(connectionId, filename) {
  const filepath = getLocalBackupPath(connectionId, filename);
  try {
    await fs.unlink(filepath);
    return true;
  } catch (error) {
    throw new Error(`Failed to delete local backup: ${error.message}`);
  }
}

/**
 * Get local backup file path
 */
export function getLocalBackupPath(connectionId, filename) {
  return path.join(getConnectionBackupDir(connectionId), path.basename(filename));
}

/**
 * Apply retention policy - delete backups older than configured days
 */
export async function applyRetentionPolicy() {
  const backupConfig = getBackupConfig();
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - backupConfig.retentionDays);

  let deletedCount = 0;

  const { listAllBackups, deleteFromS3 } = await import("./storage/s3.js");
  const allBackups = await listAllBackups();

  for (const backup of allBackups) {
    if (new Date(backup.date) >= retentionDate) continue;

    try {
      if (backup.location === "local" || backup.location === "both") {
        await deleteLocalBackup(backup.connectionId, backup.filename);
      }
      if (backup.location === "remote" || backup.location === "both") {
        await deleteFromS3(backup.connectionId, backup.filename);
      }

      deletedCount++;
      logger.info(
        `Deleted old backup: ${backup.connectionId}/${backup.filename}`,
      );
    } catch (error) {
      logger.error(`Failed to delete old backup ${backup.filename}`, error);
    }
  }

  return deletedCount;
}

import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs/promises";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// Import libraries
import {
  deleteLocalBackup,
  ensureBackupDir,
  getLocalBackupPath,
  restoreBackup,
} from "./lib/backup.js";
import {
  logObjectDetails,
  runBackupOperation,
} from "./lib/backup-operation.js";
import {
  getBackupConfig,
  getConfigMode,
  getDatabaseConfig,
  getManualConfig,
  getS3Config,
  resetManualConfig,
  setConfigMode,
  setManualBackupConfig,
  setManualDatabaseConfig,
  setManualS3Config,
} from "./lib/config.js";
import {
  assertConnectionAvailable,
  buildConnection,
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  toPublicConnection,
  updateConnection,
} from "./lib/connections.js";
import {
  getDriver,
  isExtensionAllowed,
  listDriverInfo,
} from "./lib/drivers/index.js";
import logger from "./lib/logger.js";
import {
  addOperationStep,
  clearOperationLogs,
  completeOperation,
  failOperation,
  getGroupedOperationLogs,
  initializeOperationLogs,
  startOperation,
} from "./lib/operation-log.js";
import {
  getSchedulerStatus,
  initializeScheduler,
  startScheduler,
  stopScheduler,
} from "./lib/scheduler.js";
import {
  computeBackupStats,
  deleteFromS3,
  downloadFromS3,
  isS3Configured,
  listAllBackups,
} from "./lib/storage/s3.js";
import {
  validateBackupConfig,
  validateConfigMode,
  validateConnection,
  validateConnectionId,
  validateCreateBackup,
  validateFilename,
  validateManualDatabaseConfig,
  validateRestore,
  validateS3Config,
  validateScheduler,
  sanitizeFilename,
} from "./lib/validation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 7050;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
  },
  fileFilter: (_req, file, cb) => {
    if (/\.(sql|dump|archive)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only .sql, .dump and .archive backup files are allowed"));
    }
  },
});

// Rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // More strict limit for sensitive operations
  message: {
    success: false,
    message: "Too many requests, please try again later",
  },
});

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "cdn.jsdelivr.net"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
app.use(cors());
app.use(compression());
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(limiter); // Apply rate limiting to all routes

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function sendError(res, error, fallbackMessage) {
  logger.error(fallbackMessage, error);
  res.status(error.status || 500).json({
    success: false,
    message: error.message,
  });
}

/**
 * Locate a backup file locally, or download it from S3 to a temp path.
 * Returns { filepath, isTemporary } or null when not found.
 */
async function resolveBackupFile(connectionId, filename, onRemoteDownload) {
  const backupConfig = getBackupConfig();
  const localPath = getLocalBackupPath(connectionId, filename);

  try {
    await fs.access(localPath);
    return { filepath: localPath, isTemporary: false };
  } catch {}

  if (
    (backupConfig.storage === "remote" || backupConfig.storage === "both") &&
    isS3Configured()
  ) {
    onRemoteDownload?.();
    const tempPath = path.join(
      os.tmpdir(),
      `restore_${Date.now()}_${filename}`,
    );
    await downloadFromS3(connectionId, filename, tempPath);
    return { filepath: tempPath, isTemporary: true };
  }

  return null;
}

// ==================== CONNECTION ENDPOINTS ====================

/**
 * GET /api/connections - List saved connections with backup summary
 */
app.get("/api/connections", async (req, res) => {
  try {
    const connections = await listConnections();
    const backups = await listAllBackups();

    const summary = new Map();
    for (const backup of backups) {
      const entry = summary.get(backup.connectionId) || {
        backupCount: 0,
        lastBackupAt: null,
      };
      entry.backupCount++;
      if (!entry.lastBackupAt || new Date(backup.date) > new Date(entry.lastBackupAt)) {
        entry.lastBackupAt = backup.date;
      }
      summary.set(backup.connectionId, entry);
    }

    res.json({
      success: true,
      drivers: listDriverInfo(),
      connections: connections.map((conn) => ({
        ...conn,
        backupCount: summary.get(conn.id)?.backupCount || 0,
        lastBackupAt: summary.get(conn.id)?.lastBackupAt || null,
      })),
    });
  } catch (error) {
    sendError(res, error, "Error listing connections");
  }
});

/**
 * POST /api/connections/test - Test an unsaved connection form.
 * When `id` is provided, a blank password falls back to the stored one.
 */
app.post(
  "/api/connections/test",
  strictLimiter,
  validateConnection,
  async (req, res) => {
    try {
      const existing = req.body.id ? await getConnection(req.body.id) : null;
      const candidate = buildConnection(req.body, existing);
      const result = await getDriver(candidate.type).testConnection(candidate);
      res.json({ success: true, message: "Connection successful", ...result });
    } catch (error) {
      sendError(res, error, "Connection test failed");
    }
  },
);

/**
 * POST /api/connections - Test and save a new connection
 */
app.post(
  "/api/connections",
  strictLimiter,
  validateConnection,
  async (req, res) => {
    try {
      const candidate = buildConnection(req.body);
      await assertConnectionAvailable(candidate);
      await getDriver(candidate.type).testConnection(candidate);
      const conn = await createConnection(req.body);
      logger.info(`Connection saved: ${conn.title} (${conn.type})`);
      res.status(201).json({
        success: true,
        message: `Connection "${conn.title}" saved`,
        connection: toPublicConnection(conn),
      });
    } catch (error) {
      sendError(res, error, "Error saving connection");
    }
  },
);

/**
 * PUT /api/connections/:id - Test and update a saved connection
 */
app.put(
  "/api/connections/:id",
  strictLimiter,
  validateConnectionId,
  validateConnection,
  async (req, res) => {
    try {
      const existing = await getConnection(req.params.id);
      const candidate = buildConnection(req.body, existing);
      await assertConnectionAvailable(candidate, req.params.id);
      await getDriver(candidate.type).testConnection(candidate);
      const conn = await updateConnection(req.params.id, req.body);
      res.json({
        success: true,
        message: `Connection "${conn.title}" updated`,
        connection: toPublicConnection(conn),
      });
    } catch (error) {
      sendError(res, error, "Error updating connection");
    }
  },
);

/**
 * DELETE /api/connections/:id - Delete a saved connection (backups are kept)
 */
app.delete(
  "/api/connections/:id",
  strictLimiter,
  validateConnectionId,
  async (req, res) => {
    try {
      const conn = await deleteConnection(req.params.id);
      res.json({
        success: true,
        message: `Connection "${conn.title}" deleted`,
      });
    } catch (error) {
      sendError(res, error, "Error deleting connection");
    }
  },
);

/**
 * POST /api/connections/:id/test - Test a saved connection
 */
app.post(
  "/api/connections/:id/test",
  strictLimiter,
  validateConnectionId,
  async (req, res) => {
    try {
      const conn = await getConnection(req.params.id);
      const result = await getDriver(conn.type).testConnection(conn);
      res.json({ success: true, message: "Connection successful", ...result });
    } catch (error) {
      sendError(res, error, "Connection test failed");
    }
  },
);

/**
 * GET /api/connections/:id/backups - List backup files for a connection
 */
app.get(
  "/api/connections/:id/backups",
  validateConnectionId,
  async (req, res) => {
    try {
      await getConnection(req.params.id);
      const backups = await listAllBackups(req.params.id);
      res.json({ success: true, backups });
    } catch (error) {
      sendError(res, error, "Error listing connection backups");
    }
  },
);

/**
 * POST /api/connections/:id/backups - Create an instant backup
 */
app.post(
  "/api/connections/:id/backups",
  strictLimiter,
  validateCreateBackup,
  async (req, res) => {
    try {
      const result = await runBackupOperation(req.params.id, req.body.format);
      res.status(201).json({
        success: true,
        message: `Backup of "${result.connection.title}" created successfully`,
        filename: result.filename,
        size: result.size,
        format: result.format,
        location: result.location,
      });
    } catch (error) {
      sendError(res, error, "Error creating backup");
    }
  },
);

/**
 * POST /api/connections/:id/restore - Restore a connection from a backup
 * belonging to `sourceConnectionId` (same database type).
 */
app.post(
  "/api/connections/:id/restore",
  strictLimiter,
  validateRestore,
  async (req, res) => {
    const targetId = req.params.id;
    const { sourceConnectionId } = req.body;
    const safeFilename = path.basename(req.body.filename);
    let base = null;
    let resolved = null;

    try {
      const target = await getConnection(targetId);
      const source = await getConnection(sourceConnectionId);
      if (target.type !== source.type) {
        return res.status(400).json({
          success: false,
          message: `Cannot restore a ${source.type} backup into a ${target.type} database`,
        });
      }

      base = {
        type: "restore",
        filename: safeFilename,
        connectionId: targetId,
        connectionTitle: target.title,
      };
      base.operationId = startOperation("restore", safeFilename, base);
      addOperationStep({
        ...base,
        status: "in_progress",
        step: "Restore request accepted",
        details:
          source.id === target.id ? null : `Source: ${source.title}`,
      });

      resolved = await resolveBackupFile(sourceConnectionId, safeFilename, () =>
        addOperationStep({
          ...base,
          status: "in_progress",
          step: "Downloading backup from S3",
        }),
      );

      if (!resolved) {
        failOperation({
          ...base,
          step: "Restore failed",
          errorMessage: "Backup file not found",
        });
        return res.status(404).json({
          success: false,
          message: "Backup file not found",
        });
      }

      addOperationStep({ ...base, status: "in_progress", step: "Restoring database" });
      const result = await restoreBackup(
        targetId,
        sourceConnectionId,
        safeFilename,
        resolved.isTemporary ? resolved.filepath : null,
      );
      logObjectDetails(base, result.details, "restored");
      completeOperation({ ...base, step: "Database restored successfully" });

      res.json({
        success: true,
        message: `"${target.title}" restored from ${safeFilename}`,
      });
    } catch (error) {
      if (base) {
        failOperation({
          ...base,
          step: "Restore failed",
          errorMessage: error.message,
        });
      }
      sendError(res, error, "Error restoring backup");
    } finally {
      if (resolved?.isTemporary) {
        fs.unlink(resolved.filepath).catch((err) =>
          logger.error("Failed to clean up temporary file", err),
        );
      }
    }
  },
);

// ==================== BACKUP ENDPOINTS ====================

/**
 * GET /api/backups - List all backups (optionally ?connectionId=)
 */
app.get("/api/backups", async (req, res) => {
  try {
    const connectionId = req.query.connectionId || null;
    if (connectionId && !/^[a-zA-Z0-9-]+$/.test(connectionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid connection id",
      });
    }

    const backups = await listAllBackups(connectionId);
    res.json({
      success: true,
      backups,
      stats: computeBackupStats(backups),
    });
  } catch (error) {
    sendError(res, error, "Error listing backups");
  }
});

/**
 * GET /api/operations - List operation logs
 */
app.get("/api/operations", (req, res) => {
  try {
    const operations = getGroupedOperationLogs(
      req.query.limit,
      req.query.stepsPerOperation,
    );
    res.json({
      success: true,
      operations,
    });
  } catch (error) {
    logger.error("Error listing operation logs", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * DELETE /api/operations - Clear all operation logs
 */
app.delete("/api/operations", strictLimiter, async (req, res) => {
  try {
    await clearOperationLogs();
    res.json({
      success: true,
      message: "Operation logs cleared",
    });
  } catch (error) {
    logger.error("Error clearing operation logs", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/backups/upload - Upload a backup file for a connection
 */
app.post(
  "/api/backups/upload",
  strictLimiter,
  upload.single("backupFile"),
  async (req, res) => {
    let base = null;
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Backup file is required",
        });
      }

      const connectionId = String(req.body.connectionId || "");
      if (!/^[a-zA-Z0-9-]+$/.test(connectionId)) {
        return res.status(400).json({
          success: false,
          message: "Target connection is required",
        });
      }

      const connection = await getConnection(connectionId);
      const driver = getDriver(connection.type);
      if (!isExtensionAllowed(connection.type, req.file.originalname)) {
        return res.status(400).json({
          success: false,
          message: `${driver.label} accepts only ${driver.formats
            .map((f) => `.${f}`)
            .join(", ")} files`,
        });
      }

      base = {
        type: "upload",
        connectionId,
        connectionTitle: connection.title,
      };
      base.operationId = startOperation("upload", null, base);
      addOperationStep({
        ...base,
        status: "in_progress",
        step: "Validating uploaded file",
        details: req.file.originalname,
      });

      const sanitizedOriginal = sanitizeFilename(req.file.originalname);
      const extension = sanitizedOriginal.split(".").pop().toLowerCase();
      const baseName = sanitizedOriginal.replace(/\.(sql|dump|archive)$/i, "");
      const finalName = `${baseName || "uploaded_backup"}_${Date.now()}.${extension}`;
      await ensureBackupDir(connectionId);
      await fs.writeFile(getLocalBackupPath(connectionId, finalName), req.file.buffer);
      base.filename = finalName;

      addOperationStep({
        ...base,
        status: "success",
        step: "Backup file uploaded to local storage",
        details: `${req.file.size} bytes`,
      });
      completeOperation({ ...base, step: "Upload completed" });

      res.status(201).json({
        success: true,
        message: "Backup file uploaded successfully",
        filename: finalName,
        size: req.file.size,
      });
    } catch (error) {
      if (base) {
        failOperation({
          ...base,
          step: "Upload failed",
          errorMessage: error.message,
        });
      }
      sendError(res, error, "Error uploading backup file");
    }
  },
);

/**
 * DELETE /api/backups/:connectionId/:filename - Delete backup
 */
app.delete(
  "/api/backups/:connectionId/:filename",
  strictLimiter,
  validateFilename,
  async (req, res) => {
    try {
      const { connectionId } = req.params;
      const filename = path.basename(req.params.filename);
      const backupConfig = getBackupConfig();

      let deletedLocal = false;
      let deletedRemote = false;

      if (backupConfig.storage === "local" || backupConfig.storage === "both") {
        try {
          await deleteLocalBackup(connectionId, filename);
          deletedLocal = true;
        } catch (error) {
          logger.error("Failed to delete local backup", error);
        }
      }

      if (
        (backupConfig.storage === "remote" ||
          backupConfig.storage === "both") &&
        isS3Configured()
      ) {
        try {
          await deleteFromS3(connectionId, filename);
          deletedRemote = true;
        } catch (error) {
          logger.error("Failed to delete remote backup", error);
        }
      }

      if (deletedLocal || deletedRemote) {
        res.json({
          success: true,
          message: "Backup deleted successfully",
          deletedLocal,
          deletedRemote,
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Backup not found or could not be deleted",
        });
      }
    } catch (error) {
      sendError(res, error, "Error deleting backup");
    }
  },
);

/**
 * GET /api/backups/:connectionId/:filename/download - Download backup
 */
app.get(
  "/api/backups/:connectionId/:filename/download",
  validateFilename,
  async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      let resolved = null;
      try {
        resolved = await resolveBackupFile(req.params.connectionId, filename);
      } catch (error) {
        logger.error("Failed to download from S3", error);
      }

      if (!resolved) {
        return res.status(404).json({
          success: false,
          message: "Backup file not found",
        });
      }

      res.download(resolved.filepath, filename, (err) => {
        if (err) {
          logger.error("Error sending file", err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: "Failed to download backup",
            });
          }
        }

        if (resolved.isTemporary) {
          fs.unlink(resolved.filepath).catch((unlinkErr) =>
            logger.error("Failed to clean up temp file", unlinkErr),
          );
        }
      });
    } catch (error) {
      sendError(res, error, "Error downloading backup");
    }
  },
);

// ==================== CONFIG ENDPOINTS ====================

/**
 * GET /api/config - Get current database configuration
 */
app.get("/api/config", (req, res) => {
  try {
    const config = getDatabaseConfig();

    // Don't expose password
    res.json({
      success: true,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database,
      },
    });
  } catch (error) {
    logger.error("Error getting config", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==================== CONFIG MODE ENDPOINTS ====================

/**
 * GET /api/config/mode - Get configuration mode
 */
app.get("/api/config/mode", (req, res) => {
  try {
    const mode = getConfigMode();
    const manualConfig = getManualConfig();

    // Also get ENV config for display purposes
    let envConfig = null;
    if (mode === "env") {
      try {
        const dbConfig = getDatabaseConfig();
        const backupConfig = getBackupConfig();
        const s3Config = isS3Configured() ? getS3Config() : null;

        envConfig = {
          database: {
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            database: dbConfig.database,
            schema: dbConfig.schema || "",
            excludeTables: dbConfig.excludeTables || [],
            sslMode: dbConfig.sslMode || "off",
          },
          backup: {
            enabled: backupConfig.enabled,
            schedule: backupConfig.schedule,
            retentionDays: backupConfig.retentionDays,
            format: backupConfig.format,
            storage: backupConfig.storage,
          },
          s3: s3Config
            ? {
                bucket: s3Config.bucket,
                region: s3Config.region || "",
                prefix: s3Config.prefix || "",
                endpoint: s3Config.endpoint || "",
                forcePathStyle: s3Config.forcePathStyle || false,
              }
            : null,
        };
      } catch (error) {
        logger.error("Error getting ENV config", error);
      }
    }

    res.json({
      success: true,
      mode,
      manualConfig: mode === "manual" ? manualConfig : null,
      envConfig: mode === "env" ? envConfig : null,
    });
  } catch (error) {
    logger.error("Error getting config mode", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/config/mode - Set configuration mode
 */
app.post("/api/config/mode", strictLimiter, validateConfigMode, (req, res) => {
  try {
    const { mode } = req.body;

    if (!mode || (mode !== "env" && mode !== "manual")) {
      return res.status(400).json({
        success: false,
        message: 'Mode must be "env" or "manual"',
      });
    }

    setConfigMode(mode);

    res.json({
      success: true,
      message: `Configuration mode set to ${mode.toUpperCase()}`,
      mode,
    });
  } catch (error) {
    logger.error("Error setting config mode", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/config/reset - Reset manual configuration
 */
app.post("/api/config/reset", (req, res) => {
  try {
    const mode = getConfigMode();

    if (mode !== "manual") {
      return res.status(400).json({
        success: false,
        message: "Can only reset configuration in Manual mode",
      });
    }

    // Reset manual config by calling the reset function
    resetManualConfig();

    res.json({
      success: true,
      message: "Manual configuration has been reset",
    });
  } catch (error) {
    logger.error("Error resetting config", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/config/manual/database - Set manual database config
 */
app.post(
  "/api/config/manual/database",
  strictLimiter,
  validateManualDatabaseConfig,
  async (req, res) => {
    try {
      const {
        host,
        port,
        user,
        password,
        database,
        schema,
        excludeTables,
        sslMode,
      } = req.body;

      if (!host || !port || !user || !password || !database) {
        return res.status(400).json({
          success: false,
          message: "All fields are required",
        });
      }

      const config = setManualDatabaseConfig({
        host,
        port,
        user,
        password,
        database,
        schema,
        excludeTables,
        sslMode,
      });

      logger.info("Manual database configuration saved");

      res.json({
        success: true,
        message: "Manual database configuration saved",
        config: {
          host: config.host,
          port: config.port,
          user: config.user,
          database: config.database,
          schema: config.schema,
          excludeTables: config.excludeTables,
          sslMode: config.sslMode,
        },
      });
    } catch (error) {
      logger.error("Error setting manual database config", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/config/manual/backup - Set manual backup config
 */
app.post(
  "/api/config/manual/backup",
  strictLimiter,
  validateBackupConfig,
  (req, res) => {
    try {
      const { auto, schedule, retentionDays, storage, localPath, format } =
        req.body;

      const config = setManualBackupConfig({
        auto,
        schedule,
        retentionDays,
        storage,
        localPath,
        format,
      });

      res.json({
        success: true,
        message: "Manual backup configuration saved",
        config,
      });
    } catch (error) {
      logger.error("Error setting manual backup config", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/config/manual/s3 - Set manual S3 config
 */
app.post(
  "/api/config/manual/s3",
  strictLimiter,
  validateS3Config,
  (req, res) => {
    try {
      const {
        accessKeyId,
        secretAccessKey,
        region,
        bucket,
        prefix,
        endpoint,
        s3ForcePathStyle,
      } = req.body;

      const config = setManualS3Config({
        accessKeyId,
        secretAccessKey,
        region,
        bucket,
        prefix,
        endpoint,
        s3ForcePathStyle,
      });

      res.json({
        success: true,
        message: "Manual S3 configuration saved",
        config: {
          accessKeyId: config.accessKeyId,
          region: config.region,
          bucket: config.bucket,
          endpoint: config.endpoint,
          s3ForcePathStyle: config.s3ForcePathStyle,
        },
      });
    } catch (error) {
      logger.error("Error setting manual S3 config", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

// ==================== STORAGE CONFIG ENDPOINTS ====================

/**
 * GET /api/storage/config - Get storage configuration
 */
app.get("/api/storage/config", (req, res) => {
  try {
    const backupConfig = getBackupConfig();

    res.json({
      success: true,
      config: {
        storage: backupConfig.storage || "local",
        retentionDays: backupConfig.retentionDays || 7,
        s3: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
          // Don't expose secret key
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? "********" : "",
          region: process.env.AWS_REGION || "us-east-1",
          bucket: process.env.AWS_S3_BUCKET || "",
          prefix: process.env.AWS_S3_PREFIX || "",
          endpoint: process.env.AWS_S3_ENDPOINT || "",
          s3ForcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
        },
      },
    });
  } catch (error) {
    logger.error("Error getting storage config", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/storage/config - Update S3 storage configuration
 */
app.post("/api/storage/config", (req, res) => {
  try {
    const {
      accessKeyId,
      secretAccessKey,
      region,
      bucket,
      prefix,
      endpoint,
      s3ForcePathStyle,
    } = req.body;

    // Update environment variables for runtime configuration
    if (accessKeyId) process.env.AWS_ACCESS_KEY_ID = accessKeyId;
    if (secretAccessKey) process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
    if (region) process.env.AWS_REGION = region;
    if (bucket) process.env.AWS_S3_BUCKET = bucket;
    if (typeof prefix !== "undefined") process.env.AWS_S3_PREFIX = prefix;
    if (endpoint) process.env.AWS_S3_ENDPOINT = endpoint;
    if (typeof s3ForcePathStyle !== "undefined") {
      process.env.AWS_S3_FORCE_PATH_STYLE = s3ForcePathStyle ? "true" : "false";
    }

    res.json({
      success: true,
      message: "Storage configuration updated successfully",
    });
  } catch (error) {
    logger.error("Error updating storage config", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==================== SCHEDULER ENDPOINTS ====================

/**
 * GET /api/scheduler - Get scheduler status
 */
app.get("/api/scheduler", (req, res) => {
  try {
    const status = getSchedulerStatus();

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    logger.error("Error getting scheduler status", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/scheduler - Start scheduler
 */
app.post("/api/scheduler", strictLimiter, validateScheduler, (req, res) => {
  try {
    const { schedule } = req.body;

    const result = startScheduler(schedule);

    res.json({
      success: true,
      message: "Scheduler started successfully",
      ...result,
    });
  } catch (error) {
    logger.error("Error starting scheduler", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * DELETE /api/scheduler - Stop scheduler
 */
app.delete("/api/scheduler", (req, res) => {
  try {
    const result = stopScheduler();

    res.json({
      success: true,
      message: "Scheduler stopped successfully",
      ...result,
    });
  } catch (error) {
    logger.error("Error stopping scheduler", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ==================== ERROR HANDLERS ====================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error("Unhandled error", err);
  res.status(500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  logger.info(`DB Backup Manager running on http://localhost:${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

  initializeOperationLogs().catch((error) => {
    logger.error("Failed to initialize operation logs", error);
  });

  // Initialize scheduler if auto-backup is enabled
  initializeScheduler();
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  stopScheduler();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully...");
  stopScheduler();
  process.exit(0);
});

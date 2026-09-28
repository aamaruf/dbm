import { body, param, validationResult } from "express-validator";
import cron from "node-cron";

/**
 * Middleware to handle validation errors
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }
  next();
};

const BACKUP_FILENAME_PATTERN = /^[a-zA-Z0-9._-]+\.(sql|dump|archive)$/;
const BACKUP_FILENAME_MESSAGE =
  "Invalid backup filename. Only .sql, .dump or .archive files are allowed";
const CONNECTION_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

const connectionIdParam = param("id")
  .matches(CONNECTION_ID_PATTERN)
  .withMessage("Invalid connection id");

/**
 * Validation rules for routes with a :id connection parameter
 */
export const validateConnectionId = [connectionIdParam, validate];

/**
 * Validation rules for creating / updating / testing a connection
 */
export const validateConnection = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("type")
    .isIn(["postgres", "mysql", "mongodb"])
    .withMessage('Type must be "postgres", "mysql" or "mongodb"'),
  body("host").trim().notEmpty().withMessage("Host is required"),
  body("port")
    .isInt({ min: 1, max: 65535 })
    .withMessage("Port must be between 1 and 65535"),
  body("user").optional().trim(),
  body("password").optional(),
  body("database").trim().notEmpty().withMessage("Database name is required"),
  body("options").optional().isObject().withMessage("Options must be an object"),
  validate,
];

/**
 * Validation rules for backup creation
 */
export const validateCreateBackup = [
  connectionIdParam,
  body("format")
    .optional()
    .isIn(["sql", "dump", "archive"])
    .withMessage('Format must be "sql", "dump" or "archive"'),
  validate,
];

/**
 * Validation rules for restore
 */
export const validateRestore = [
  connectionIdParam,
  body("sourceConnectionId")
    .matches(CONNECTION_ID_PATTERN)
    .withMessage("Source connection is required"),
  body("filename")
    .trim()
    .notEmpty()
    .withMessage("Filename is required")
    .matches(BACKUP_FILENAME_PATTERN)
    .withMessage(BACKUP_FILENAME_MESSAGE),
  validate,
];

/**
 * Validation rules for :connectionId/:filename parameters
 */
export const validateFilename = [
  param("connectionId")
    .matches(CONNECTION_ID_PATTERN)
    .withMessage("Invalid connection id"),
  param("filename")
    .trim()
    .notEmpty()
    .withMessage("Filename is required")
    .matches(BACKUP_FILENAME_PATTERN)
    .withMessage(BACKUP_FILENAME_MESSAGE),
  validate,
];

/**
 * Validation rules for manual database config
 */
export const validateManualDatabaseConfig = [
  body("host").trim().notEmpty().withMessage("Host is required"),
  body("port")
    .isInt({ min: 1, max: 65535 })
    .withMessage("Port must be between 1 and 65535"),
  body("user").trim().notEmpty().withMessage("User is required"),
  body("password").optional().trim(),
  body("database").trim().notEmpty().withMessage("Database name is required"),
  body("schema").optional().trim(),
  body("excludeTables").optional(),
  body("sslMode")
    .optional()
    .isIn(["on", "off"])
    .withMessage('SSL Mode must be either "on" or "off"'),
  validate,
];

/**
 * Validation rules for backup config
 */
export const validateBackupConfig = [
  body("auto").optional().isBoolean().withMessage("Auto must be a boolean"),
  body("schedule")
    .optional()
    .custom((value) => {
      if (!cron.validate(value)) {
        throw new Error("Invalid cron expression");
      }
      return true;
    }),
  body("retentionDays")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Retention days must be between 1 and 365"),
  body("storage")
    .optional()
    .isIn(["local", "remote", "both"])
    .withMessage('Storage must be "local", "remote", or "both"'),
  body("localPath").optional().trim(),
  body("format")
    .optional()
    .isIn(["sql", "dump"])
    .withMessage('Format must be "sql" or "dump"'),
  validate,
];

/**
 * Validation rules for S3 config
 */
export const validateS3Config = [
  body("accessKeyId").optional().trim(),
  body("secretAccessKey").optional().trim(),
  body("region").optional().trim(),
  body("bucket").optional().trim(),
  body("prefix").optional().trim(),
  body("endpoint")
    .optional()
    .trim()
    .custom((value) => {
      if (
        value &&
        !value.startsWith("http://") &&
        !value.startsWith("https://")
      ) {
        throw new Error("Endpoint must start with http:// or https://");
      }
      return true;
    }),
  body("s3ForcePathStyle").optional().isBoolean(),
  validate,
];

/**
 * Validation rules for config mode
 */
export const validateConfigMode = [
  body("mode")
    .isIn(["env", "manual"])
    .withMessage('Mode must be either "env" or "manual"'),
  validate,
];

/**
 * Validation rules for scheduler
 */
export const validateScheduler = [
  body("schedule")
    .optional()
    .custom((value) => {
      if (value && !cron.validate(value)) {
        throw new Error("Invalid cron expression");
      }
      return true;
    }),
  validate,
];

/**
 * Sanitize filename to prevent path traversal
 */
export const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "");
};

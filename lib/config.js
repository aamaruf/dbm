import dotenv from "dotenv";
dotenv.config();

// Temporary in-memory configuration override
let tempConfig = null;

// Configuration mode: 'env' or 'manual'
let configMode = process.env.CONFIG_MODE || "env";

// Manual configuration storage
let manualConfig = {
  database: null,
  backup: null,
  s3: null,
};

/**
 * Get current database configuration
 * Strict mode: only use the config source based on mode
 */
export function getDatabaseConfig() {
  // Manual mode - only use manual config
  if (configMode === "manual") {
    if (!manualConfig.database) {
      throw new Error(
        "Manual database configuration not set. Please configure in Settings.",
      );
    }
    return manualConfig.database;
  }

  // ENV mode - only use environment variables
  const excludeTablesEnv = process.env.DB_EXCLUDE_TABLES || "";
  const excludeTables = excludeTablesEnv
    ? excludeTablesEnv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t)
    : [];

  return {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432"),
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "postgres",
    schema: process.env.DB_SCHEMA || null,
    excludeTables: excludeTables,
    sslMode:
      (process.env.DB_SSL || "off").toLowerCase() === "on" ? "on" : "off",
  };
}

/**
 * Set temporary database configuration (runtime override)
 */
export function setTempConfig(config) {
  tempConfig = {
    host: config.host,
    port: parseInt(config.port),
    user: config.user,
    password: config.password,
    database: config.database,
  };
  return tempConfig;
}

/**
 * Clear temporary configuration
 */
export function clearTempConfig() {
  tempConfig = null;
}

/**
 * Get backup configuration
 * Strict mode: only use the config source based on mode
 */
export function getBackupConfig() {
  // Manual mode - only use manual config
  if (configMode === "manual") {
    if (!manualConfig.backup) {
      // Return defaults for manual mode if not configured yet
      return {
        auto: false,
        schedule: "0 2 * * *",
        retentionDays: 7,
        storage: "local",
        localPath: "./backups",
        format: "sql",
      };
    }
    return manualConfig.backup;
  }

  // ENV mode - only use environment variables
  return {
    auto: process.env.BACKUP_AUTO === "true",
    schedule: process.env.BACKUP_SCHEDULE || "0 2 * * *",
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || "7"),
    storage: process.env.BACKUP_STORAGE || "local",
    localPath: process.env.BACKUP_LOCAL_PATH || "./backups",
    format: process.env.BACKUP_FORMAT || "sql", // sql or dump
  };
}

/**
 * Auto-detect if force path style should be used based on endpoint
 */
function shouldForcePathStyle(endpoint) {
  if (!endpoint) return false;

  const endpointLower = endpoint.toLowerCase();

  // Force path-style for known S3-compatible services
  const forcePathStyleServices = [
    "supabase.co",
    "minio",
    "localhost",
    "127.0.0.1",
    "digitaloceanspaces.com",
  ];

  return forcePathStyleServices.some((service) =>
    endpointLower.includes(service),
  );
}

/**
 * Get S3 configuration
 * Strict mode: only use the config source based on mode
 */
export function getS3Config() {
  let config;

  // Manual mode - only use manual config (can be null if not needed)
  if (configMode === "manual") {
    if (!manualConfig.s3) {
      return {
        accessKeyId: null,
        secretAccessKey: null,
        region: "us-east-1",
        bucket: null,
        prefix: "",
        endpoint: null,
        s3ForcePathStyle: false,
      };
    }
    config = manualConfig.s3;
  } else {
    // ENV mode - only use environment variables
    config = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || "us-east-1",
      bucket: process.env.AWS_S3_BUCKET,
      prefix: process.env.AWS_S3_PREFIX || "",
      endpoint: process.env.AWS_S3_ENDPOINT,
      s3ForcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
    };
  }

  // Auto-detect forcePathStyle if endpoint is set and forcePathStyle is not explicitly configured
  if (config.endpoint && !config.s3ForcePathStyle) {
    config.s3ForcePathStyle = shouldForcePathStyle(config.endpoint);
  }

  return config;
}

/**
 * Get configuration mode
 */
export function getConfigMode() {
  return configMode;
}

/**
 * Set configuration mode
 */
export function setConfigMode(mode) {
  if (mode !== "env" && mode !== "manual") {
    throw new Error('Invalid config mode. Must be "env" or "manual"');
  }
  configMode = mode;
  return configMode;
}

/**
 * Set manual database configuration
 */
export function setManualDatabaseConfig(config) {
  if (configMode !== "manual") {
    throw new Error(
      "Cannot set manual config when in ENV mode. Switch to Manual mode first.",
    );
  }

  // Validate required fields
  if (!config.host || !config.user || !config.database) {
    throw new Error("Host, User, and Database are required fields.");
  }

  // Parse excludeTables if it's a comma-separated string
  let excludeTables = [];
  if (config.excludeTables) {
    if (typeof config.excludeTables === "string") {
      excludeTables = config.excludeTables
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t);
    } else if (Array.isArray(config.excludeTables)) {
      excludeTables = config.excludeTables;
    }
  }

  manualConfig.database = {
    host: config.host,
    port: parseInt(config.port) || 5432,
    user: config.user,
    password: config.password || "",
    database: config.database,
    schema: config.schema || null,
    excludeTables: excludeTables,
    sslMode: config.sslMode === "on" ? "on" : "off",
  };
  return manualConfig.database;
}

/**
 * Set manual backup configuration
 */
export function setManualBackupConfig(config) {
  if (configMode !== "manual") {
    throw new Error(
      "Cannot set manual config when in ENV mode. Switch to Manual mode first.",
    );
  }

  manualConfig.backup = {
    auto: config.auto || false,
    schedule: config.schedule || "0 2 * * *",
    retentionDays: parseInt(config.retentionDays) || 7,
    storage: config.storage || "local",
    localPath: config.localPath || "./backups",
    format: config.format || "sql",
  };
  return manualConfig.backup;
}

/**
 * Set manual S3 configuration
 */
export function setManualS3Config(config) {
  if (configMode !== "manual") {
    throw new Error(
      "Cannot set manual config when in ENV mode. Switch to Manual mode first.",
    );
  }

  // Validate required fields if provided
  if (config.accessKeyId || config.bucket) {
    if (!config.accessKeyId || !config.bucket) {
      throw new Error(
        "Both Access Key ID and Bucket are required for S3 configuration.",
      );
    }
  }

  // Auto-detect forcePathStyle based on endpoint if not explicitly set
  let forcePathStyle = config.s3ForcePathStyle || false;
  if (config.endpoint && !config.s3ForcePathStyle) {
    forcePathStyle = shouldForcePathStyle(config.endpoint);
  }

  manualConfig.s3 = {
    accessKeyId: config.accessKeyId || null,
    secretAccessKey: config.secretAccessKey || null,
    region: config.region || "us-east-1",
    bucket: config.bucket || null,
    prefix: config.prefix || "",
    endpoint: config.endpoint || null,
    s3ForcePathStyle: forcePathStyle,
  };
  return manualConfig.s3;
}

/**
 * Get all manual configuration
 */
export function getManualConfig() {
  return {
    mode: configMode,
    database: manualConfig.database,
    backup: manualConfig.backup,
    s3: manualConfig.s3,
  };
}

/**
 * Reset manual configuration to initial state
 */
export function resetManualConfig() {
  if (configMode !== "manual") {
    throw new Error("Can only reset configuration in Manual mode");
  }

  manualConfig = {
    database: null,
    backup: null,
    s3: null,
  };

  return true;
}

/**
 * Detect if database is local
 */
export function isLocalDatabase(host) {
  const localHosts = ["localhost", "127.0.0.1", "postgres", "::1"];
  return localHosts.includes(host);
}

/**
 * Get SSL mode for database connection
 * When sslMode is 'on': use 'require' for remote hosts, 'prefer' for local
 * When sslMode is 'off': use 'disable'
 */
export function getSSLMode(host) {
  const dbConfig = getDatabaseConfig();

  if (dbConfig.sslMode === "on") {
    return isLocalDatabase(host) ? "prefer" : "require";
  }

  return "disable";
}

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getConfigMode, getDatabaseConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../data");
const CONNECTIONS_FILE = path.join(DATA_DIR, "connections.json");

export const DEFAULT_CONNECTION_ID = "default";
export const DB_TYPES = ["postgres", "mysql", "mongodb"];

let connections = null;

export class ConnectionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function loadConnections() {
  if (connections) {
    return connections;
  }

  try {
    const content = await fs.readFile(CONNECTIONS_FILE, "utf8");
    const parsed = JSON.parse(content);
    connections = Array.isArray(parsed) ? parsed : [];
  } catch {
    connections = [];
  }

  return connections;
}

async function persistConnections() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    CONNECTIONS_FILE,
    JSON.stringify(connections, null, 2),
    "utf8",
  );
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeOptions(type, options = {}) {
  if (type === "postgres") {
    return {
      schema: options.schema?.trim() || null,
      excludeTables: parseList(options.excludeTables),
      sslMode: options.sslMode === "on" ? "on" : "off",
    };
  }
  if (type === "mysql") {
    return {
      excludeTables: parseList(options.excludeTables),
      sslMode: options.sslMode === "on" ? "on" : "off",
    };
  }
  return {
    authSource: options.authSource?.trim() || "admin",
    excludeCollections: parseList(options.excludeCollections),
    tls: options.tls === true || options.tls === "on",
    srv: options.srv === true || options.srv === "on",
  };
}

function uniqueKey(conn) {
  return [
    conn.type,
    String(conn.host).trim().toLowerCase(),
    Number(conn.port),
    String(conn.database).trim(),
  ].join("|");
}

function toPublic(conn) {
  const publicConn = { ...conn, hasPassword: Boolean(conn.password) };
  delete publicConn.password;
  return publicConn;
}

/**
 * Pinned connection derived from the existing ENV / Manual database config.
 * Returns null when nothing is configured.
 */
export function getDefaultConnection() {
  const mode = getConfigMode();
  if (mode === "env" && !process.env.DB_HOST) {
    return null;
  }

  let dbConfig;
  try {
    dbConfig = getDatabaseConfig();
  } catch {
    return null;
  }

  return {
    id: DEFAULT_CONNECTION_ID,
    title: `Default (${mode.toUpperCase()})`,
    type: "postgres",
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    options: {
      schema: dbConfig.schema || null,
      excludeTables: dbConfig.excludeTables || [],
      sslMode: dbConfig.sslMode || "off",
    },
    isDefault: true,
  };
}

/**
 * List all connections (Default first) without passwords
 */
export async function listConnections({ includeSecrets = false } = {}) {
  const saved = await loadConnections();
  const defaultConn = getDefaultConnection();
  const all = defaultConn ? [defaultConn, ...saved] : [...saved];
  return includeSecrets ? all : all.map(toPublic);
}

/**
 * Get a connection (with password) by id
 */
export async function getConnection(id) {
  if (id === DEFAULT_CONNECTION_ID) {
    const defaultConn = getDefaultConnection();
    if (!defaultConn) {
      throw new ConnectionError("Default connection is not configured", 404);
    }
    return defaultConn;
  }

  const saved = await loadConnections();
  const conn = saved.find((c) => c.id === id);
  if (!conn) {
    throw new ConnectionError("Connection not found", 404);
  }
  return conn;
}

export function toPublicConnection(conn) {
  return toPublic(conn);
}

/**
 * Build a normalized connection object from request input.
 * `existing` supplies the stored password when the input leaves it blank.
 */
export function buildConnection(input, existing = null) {
  const type = input.type;
  if (!DB_TYPES.includes(type)) {
    throw new ConnectionError(`Unsupported database type: ${type}`);
  }

  const title = String(input.title || "").trim();
  const host = String(input.host || "").trim();
  const database = String(input.database || "").trim();
  if (!title || !host || !database) {
    throw new ConnectionError("Title, host and database are required");
  }

  return {
    title,
    type,
    host,
    port: parseInt(input.port, 10),
    user: String(input.user || "").trim(),
    password:
      input.password !== undefined && input.password !== ""
        ? input.password
        : existing?.password || "",
    database,
    options: normalizeOptions(type, input.options),
  };
}

/**
 * Throw 409 if another connection has the same (type, host, port, database)
 * or the same title.
 */
export async function assertConnectionAvailable(candidate, ignoreId = null) {
  await loadConnections();
  assertUnique(candidate, ignoreId);
}

function assertUnique(candidate, ignoreId = null) {
  const others = connections.filter((c) => c.id !== ignoreId);
  const defaultConn = getDefaultConnection();
  if (defaultConn) {
    others.push(defaultConn);
  }

  const key = uniqueKey(candidate);
  const duplicate = others.find((c) => uniqueKey(c) === key);
  if (duplicate) {
    throw new ConnectionError(
      `A connection to this database already exists: "${duplicate.title}"`,
      409,
    );
  }

  const titleTaken = others.find(
    (c) => c.title.toLowerCase() === candidate.title.toLowerCase(),
  );
  if (titleTaken) {
    throw new ConnectionError(`Title "${candidate.title}" is already in use`, 409);
  }
}

export async function createConnection(input) {
  await loadConnections();
  const candidate = buildConnection(input);
  assertUnique(candidate);

  const now = new Date().toISOString();
  const conn = {
    id: crypto.randomUUID(),
    ...candidate,
    createdAt: now,
    updatedAt: now,
  };

  connections.push(conn);
  await persistConnections();
  return conn;
}

export async function updateConnection(id, input) {
  if (id === DEFAULT_CONNECTION_ID) {
    throw new ConnectionError(
      "Default connection is managed from the Configure dialog",
    );
  }

  await loadConnections();
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) {
    throw new ConnectionError("Connection not found", 404);
  }

  const existing = connections[index];
  const candidate = buildConnection(input, existing);
  assertUnique(candidate, id);

  connections[index] = {
    ...existing,
    ...candidate,
    updatedAt: new Date().toISOString(),
  };
  await persistConnections();
  return connections[index];
}

export async function deleteConnection(id) {
  if (id === DEFAULT_CONNECTION_ID) {
    throw new ConnectionError("Default connection cannot be deleted");
  }

  await loadConnections();
  const index = connections.findIndex((c) => c.id === id);
  if (index === -1) {
    throw new ConnectionError("Connection not found", 404);
  }

  const [removed] = connections.splice(index, 1);
  await persistConnections();
  return removed;
}

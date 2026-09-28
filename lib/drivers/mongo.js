import { MongoClient } from "mongodb";
import { runCommand, uniqueItems } from "./process.js";

export const type = "mongodb";
export const label = "MongoDB";
export const defaultPort = 27017;
export const formats = ["archive"];

export function resolveFormat() {
  return "archive";
}

export function extension() {
  return "archive";
}

/**
 * Build a MongoDB URI. The database is intentionally left out of the path so
 * mongodump/mongorestore take it from --db / --nsInclude instead.
 */
function buildUri(conn, { includeDatabase = false } = {}) {
  const { authSource = "admin", tls = false, srv = false } = conn.options || {};
  const auth = conn.user
    ? `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password || "")}@`
    : "";
  const hostPart = srv ? conn.host : `${conn.host}:${conn.port}`;
  const dbPath = includeDatabase ? encodeURIComponent(conn.database) : "";

  const params = new URLSearchParams();
  if (conn.user) params.set("authSource", authSource);
  if (tls) params.set("tls", "true");
  const query = params.toString();

  return `${srv ? "mongodb+srv" : "mongodb"}://${auth}${hostPart}/${dbPath}${query ? `?${query}` : ""}`;
}

function parseNamespaces(output, pattern) {
  const collections = [];
  for (const line of output.split("\n")) {
    const match = line.match(pattern);
    if (match) collections.push(match[1]);
  }
  return uniqueItems(collections);
}

export async function testConnection(conn) {
  const client = new MongoClient(buildUri(conn, { includeDatabase: true }), {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  try {
    await client.connect();
    const db = client.db(conn.database);
    const hello = await db.command({ hello: 1 });
    const buildInfo = await db.command({ buildInfo: 1 }).catch(() => null);
    return {
      serverTime: hello.localTime || new Date(),
      version: buildInfo ? `MongoDB ${buildInfo.version}` : "MongoDB",
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function backup(conn, filepath) {
  const args = [
    `--uri=${buildUri(conn)}`,
    `--db=${conn.database}`,
    `--archive=${filepath}`,
    "--gzip",
  ];
  for (const collection of conn.options?.excludeCollections || []) {
    args.push(`--excludeCollection=${collection}`);
  }

  const { stdout, stderr } = await runCommand("mongodump", args);
  return {
    collections: parseNamespaces(
      `${stdout}\n${stderr}`,
      /done dumping\s+(\S+)/i,
    ),
  };
}

export async function restore(conn, filepath, sourceConn = conn) {
  const sourceDb = sourceConn.database;
  const args = [
    `--uri=${buildUri(conn)}`,
    `--archive=${filepath}`,
    "--gzip",
    "--drop",
    `--nsInclude=${sourceDb}.*`,
  ];
  if (sourceDb !== conn.database) {
    args.push(`--nsFrom=${sourceDb}.*`, `--nsTo=${conn.database}.*`);
  }

  const { stdout, stderr } = await runCommand("mongorestore", args);
  return {
    collections: parseNamespaces(
      `${stdout}\n${stderr}`,
      /finished restoring\s+(\S+)/i,
    ),
  };
}

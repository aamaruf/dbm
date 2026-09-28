import fs from "fs/promises";
import mysql from "mysql2/promise";
import { runCommand, uniqueItems } from "./process.js";

export const type = "mysql";
export const label = "MySQL";
export const defaultPort = 3306;
export const formats = ["sql"];

export function resolveFormat() {
  return "sql";
}

export function extension() {
  return "sql";
}

let clientFlavor = null;

// MariaDB and Oracle MySQL clients use different SSL flags.
async function getClientFlavor() {
  if (clientFlavor) return clientFlavor;
  try {
    const { stdout } = await runCommand("mysqldump", ["--version"]);
    clientFlavor = /mariadb/i.test(stdout) ? "mariadb" : "mysql";
  } catch {
    clientFlavor = "mysql";
  }
  return clientFlavor;
}

async function sslArgs(conn) {
  const flavor = await getClientFlavor();
  const enabled = conn.options?.sslMode === "on";
  if (flavor === "mariadb") {
    return enabled ? ["--ssl"] : ["--skip-ssl"];
  }
  return [`--ssl-mode=${enabled ? "REQUIRED" : "DISABLED"}`];
}

async function connectionArgs(conn) {
  return [
    "-h",
    conn.host,
    "-P",
    String(conn.port),
    "-u",
    conn.user,
    ...(await sslArgs(conn)),
  ];
}

function getEnv(conn) {
  return { MYSQL_PWD: conn.password || "" };
}

async function parseSqlFileTables(filepath) {
  try {
    const content = await fs.readFile(filepath, "utf8");
    const tables = [];
    const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      tables.push(match[1]);
    }
    return { tables: uniqueItems(tables) };
  } catch {
    return { tables: [] };
  }
}

export async function testConnection(conn) {
  const connection = await mysql.createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    connectTimeout: 5000,
    ssl:
      conn.options?.sslMode === "on" ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const [rows] = await connection.query(
      "SELECT NOW() AS now, VERSION() AS version",
    );
    return { serverTime: rows[0].now, version: `MySQL ${rows[0].version}` };
  } finally {
    await connection.end().catch(() => {});
  }
}

export async function backup(conn, filepath) {
  const args = [
    ...(await connectionArgs(conn)),
    "--single-transaction",
    "--routines",
    "--triggers",
    "--add-drop-table",
    "--no-tablespaces",
    `--result-file=${filepath}`,
  ];
  for (const table of conn.options?.excludeTables || []) {
    args.push(`--ignore-table=${conn.database}.${table}`);
  }
  args.push(conn.database);

  await runCommand("mysqldump", args, { env: getEnv(conn) });
  return parseSqlFileTables(filepath);
}

export async function restore(conn, filepath) {
  const planned = await parseSqlFileTables(filepath);
  await runCommand("mysql", [...(await connectionArgs(conn)), conn.database], {
    env: getEnv(conn),
    stdinFile: filepath,
  });
  return planned;
}

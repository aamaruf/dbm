import fs from "fs/promises";
import pg from "pg";
import { isLocalDatabase } from "../config.js";
import { runCommand, uniqueItems } from "./process.js";

export const type = "postgres";
export const label = "PostgreSQL";
export const defaultPort = 5432;
export const formats = ["sql", "dump"];

export function resolveFormat(requested) {
  return formats.includes(requested) ? requested : "sql";
}

export function extension(format) {
  return resolveFormat(format);
}

function getSSLMode(conn) {
  if (conn.options?.sslMode === "on") {
    return isLocalDatabase(conn.host) ? "prefer" : "require";
  }
  return "disable";
}

function getEnv(conn) {
  return {
    PGPASSWORD: conn.password || "",
    PGSSLMODE: getSSLMode(conn),
  };
}

function connectionArgs(conn) {
  return [
    "--no-password",
    "-h",
    conn.host,
    "-p",
    String(conn.port),
    "-U",
    conn.user,
    "-d",
    conn.database,
  ];
}

function parsePgVerboseObjects(output = "") {
  const tables = [];
  const sequences = [];

  for (const line of output.split("\n")) {
    const tableMatch = line.match(/table\s+"?([^"\s]+(?:\.[^"\s]+)?)"?/i);
    const sequenceMatch = line.match(/sequence\s+"?([^"\s]+(?:\.[^"\s]+)?)"?/i);
    if (tableMatch) tables.push(tableMatch[1]);
    if (sequenceMatch) sequences.push(sequenceMatch[1]);
  }

  return { tables: uniqueItems(tables), sequences: uniqueItems(sequences) };
}

async function parseSqlFileObjects(filepath) {
  try {
    const sqlContent = await fs.readFile(filepath, "utf8");
    const tables = [];
    const sequences = [];
    const tableRegex =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?(?:\."?[\w]+"?)?)/gi;
    const sequenceRegex =
      /CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?(?:\."?[\w]+"?)?)/gi;

    let match;
    while ((match = tableRegex.exec(sqlContent)) !== null) {
      tables.push(match[1].replace(/"/g, ""));
    }
    while ((match = sequenceRegex.exec(sqlContent)) !== null) {
      sequences.push(match[1].replace(/"/g, ""));
    }

    return { tables: uniqueItems(tables), sequences: uniqueItems(sequences) };
  } catch {
    return { tables: [], sequences: [] };
  }
}

async function parseDumpFileObjects(filepath, env) {
  try {
    const { stdout } = await runCommand("pg_restore", ["-l", filepath], { env });
    const tables = [];
    const sequences = [];

    for (const line of stdout.split("\n")) {
      const tableMatch = line.match(
        /\bTABLE\b(?:\s+DATA)?\s+("?[\w]+"?)\s+("?[\w]+"?)/i,
      );
      const sequenceMatch = line.match(
        /\bSEQUENCE\b\s+("?[\w]+"?)\s+("?[\w]+"?)/i,
      );

      if (tableMatch) {
        tables.push(
          `${tableMatch[1].replace(/"/g, "")}.${tableMatch[2].replace(/"/g, "")}`,
        );
      }
      if (sequenceMatch) {
        sequences.push(
          `${sequenceMatch[1].replace(/"/g, "")}.${sequenceMatch[2].replace(/"/g, "")}`,
        );
      }
    }

    return { tables: uniqueItems(tables), sequences: uniqueItems(sequences) };
  } catch {
    return { tables: [], sequences: [] };
  }
}

function parseFileObjects(filepath, env) {
  return filepath.endsWith(".dump")
    ? parseDumpFileObjects(filepath, env)
    : parseSqlFileObjects(filepath);
}

function mergeObjects(a, b) {
  return {
    tables: uniqueItems([...a.tables, ...b.tables]),
    sequences: uniqueItems([...a.sequences, ...b.sequences]),
  };
}

export async function testConnection(conn) {
  const sslMode = getSSLMode(conn);
  const client = new pg.Client({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    connectionTimeoutMillis: 5000,
    ssl:
      sslMode === "require" || sslMode === "prefer"
        ? { rejectUnauthorized: false }
        : false,
  });

  try {
    await client.connect();
    const result = await client.query(
      "SELECT NOW() as now, version() as version",
    );
    return {
      serverTime: result.rows[0].now,
      version: result.rows[0].version,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function backup(conn, filepath, format) {
  const env = getEnv(conn);
  const args = connectionArgs(conn);
  const { schema, excludeTables = [] } = conn.options || {};

  if (schema) {
    args.push("-n", schema);
  }
  for (const table of excludeTables) {
    args.push(`--exclude-table=${schema ? `${schema}.${table}` : table}`);
  }
  args.push("-F", resolveFormat(format) === "dump" ? "c" : "p", "-v", "-f", filepath);

  const { stdout, stderr } = await runCommand("pg_dump", args, { env });
  const verbose = parsePgVerboseObjects(`${stdout}\n${stderr}`);
  const fromFile = await parseFileObjects(filepath, env);
  return mergeObjects(verbose, fromFile);
}

export async function restore(conn, filepath) {
  const env = getEnv(conn);
  const planned = await parseFileObjects(filepath, env);
  let output;

  if (filepath.endsWith(".dump")) {
    output = await runCommand(
      "pg_restore",
      [...connectionArgs(conn), "-c", "-v", "--no-owner", "-F", "c", filepath],
      { env },
    );
  } else {
    const schema = conn.options?.schema || "public";
    const quoted = `"${schema.replace(/"/g, '""')}"`;
    await runCommand(
      "psql",
      [
        ...connectionArgs(conn),
        "-c",
        `DROP SCHEMA IF EXISTS ${quoted} CASCADE; CREATE SCHEMA ${quoted};`,
      ],
      { env },
    );
    output = await runCommand(
      "psql",
      [...connectionArgs(conn), "-v", "ON_ERROR_STOP=1", "-f", filepath],
      { env },
    );
  }

  const actual = parsePgVerboseObjects(`${output.stdout}\n${output.stderr}`);
  return mergeObjects(planned, actual);
}

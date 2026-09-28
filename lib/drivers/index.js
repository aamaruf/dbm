import * as mongo from "./mongo.js";
import * as mysql from "./mysql.js";
import * as postgres from "./postgres.js";

const drivers = {
  postgres,
  mysql,
  mongodb: mongo,
};

export const BACKUP_EXTENSIONS = ["sql", "dump", "archive"];

export function getDriver(type) {
  const driver = drivers[type];
  if (!driver) {
    throw new Error(`Unsupported database type: ${type}`);
  }
  return driver;
}

export function listDriverInfo() {
  return Object.values(drivers).map((driver) => ({
    type: driver.type,
    label: driver.label,
    defaultPort: driver.defaultPort,
    formats: driver.formats,
  }));
}

export function isExtensionAllowed(type, filename) {
  const driver = getDriver(type);
  const ext = filename.toLowerCase().split(".").pop();
  return driver.formats.includes(ext);
}

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const MAX_OPERATION_LOGS = 5000;

const operationLogs = [];
let operationCounter = 0;
let isInitialized = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, "../logs");
const OPERATION_LOG_FILE = path.join(LOG_DIR, "operations-log.json");

async function persistOperationLogs() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.writeFile(OPERATION_LOG_FILE, JSON.stringify(operationLogs, null, 2), "utf8");
  } catch {
    // Persist failures should not break backup/restore operations.
  }
}

export async function initializeOperationLogs() {
  if (isInitialized) {
    return;
  }

  isInitialized = true;

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const content = await fs.readFile(OPERATION_LOG_FILE, "utf8");
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      operationLogs.push(...parsed.slice(0, MAX_OPERATION_LOGS));
    }
  } catch {
    // First startup or invalid file; begin with empty log list.
  }
}

function getTimestamp() {
  return new Date().toISOString();
}

export function startOperation(type, filename = null, context = {}) {
  operationCounter += 1;
  const operationId = `${type}-${Date.now()}-${operationCounter}`;

  addOperationStep({
    operationId,
    type,
    filename,
    connectionId: context.connectionId,
    connectionTitle: context.connectionTitle,
    status: "started",
    step: "Operation started",
  });

  return operationId;
}

export function addOperationStep({
  operationId,
  type,
  filename = null,
  connectionId = null,
  connectionTitle = null,
  status = "info",
  step,
  details = null,
}) {
  operationLogs.unshift({
    id: `${operationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    operationId,
    type,
    filename,
    connectionId,
    connectionTitle,
    status,
    step,
    details,
    timestamp: getTimestamp(),
  });

  if (operationLogs.length > MAX_OPERATION_LOGS) {
    operationLogs.length = MAX_OPERATION_LOGS;
  }

  void persistOperationLogs();
}

export function completeOperation({ step, ...rest }) {
  addOperationStep({ ...rest, status: "success", step });
}

export function failOperation({ step, errorMessage, ...rest }) {
  addOperationStep({
    ...rest,
    status: "error",
    step,
    details: errorMessage,
  });
}

export function getOperationLogs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, MAX_OPERATION_LOGS));
  return operationLogs.slice(0, safeLimit);
}

export function getGroupedOperationLogs(
  groupLimit = 30,
  perOperationStepLimit = 500,
) {
  const groupedMap = new Map();
  const safeStepsPerOperation = Math.max(
    1,
    Math.min(Number(perOperationStepLimit) || 500, MAX_OPERATION_LOGS),
  );

  for (const log of operationLogs) {
    if (!groupedMap.has(log.operationId)) {
      groupedMap.set(log.operationId, {
        operationId: log.operationId,
        type: log.type,
        filename: log.filename,
        connectionId: log.connectionId || null,
        connectionTitle: log.connectionTitle || null,
        latestStatus: log.status,
        latestStep: log.step,
        latestTimestamp: log.timestamp,
        startedAt: log.timestamp,
        steps: [],
      });
    }

    const group = groupedMap.get(log.operationId);
    if (group.steps.length < safeStepsPerOperation) {
      group.steps.push(log);
    }
    group.startedAt = log.timestamp;

    if (!group.filename && log.filename) {
      group.filename = log.filename;
    }
    if (!group.connectionTitle && log.connectionTitle) {
      group.connectionTitle = log.connectionTitle;
      group.connectionId = log.connectionId;
    }
  }

  const groups = Array.from(groupedMap.values());
  for (const group of groups) {
    group.steps.reverse();
  }

  const safeGroupLimit = Math.max(
    1,
    Math.min(Number(groupLimit) || 30, groups.length || 1),
  );

  return groups.slice(0, safeGroupLimit);
}

export async function clearOperationLogs() {
  operationLogs.length = 0;
  await persistOperationLogs();
}

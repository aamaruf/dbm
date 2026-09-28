import parser from "cron-parser";
import cron from "node-cron";
import { applyRetentionPolicy } from "./backup.js";
import { runBackupOperation } from "./backup-operation.js";
import { getBackupConfig } from "./config.js";
import { listConnections } from "./connections.js";
import logger from "./logger.js";

// Singleton scheduler instance
let schedulerTask = null;
let isRunning = false;
let currentSchedule = null;

/**
 * Execute backup job
 */
async function executeBackupJob() {
  logger.info("Running scheduled backup...");

  try {
    const connections = await listConnections();

    for (const connection of connections) {
      try {
        await runBackupOperation(connection.id);
      } catch (error) {
        logger.error(
          `Scheduled backup failed for "${connection.title}"`,
          error,
        );
      }
    }

    // Apply retention policy
    const deletedCount = await applyRetentionPolicy();
    logger.info(
      `Retention policy applied: ${deletedCount} old backups deleted`
    );
  } catch (error) {
    logger.error("Scheduled backup failed", error);
  }
}

/**
 * Start scheduler
 */
export function startScheduler(schedule) {
  if (isRunning) {
    stopScheduler();
  }

  const scheduleToUse = schedule || getBackupConfig().schedule;

  if (!cron.validate(scheduleToUse)) {
    throw new Error(`Invalid cron schedule: ${scheduleToUse}`);
  }

  schedulerTask = cron.schedule(scheduleToUse, executeBackupJob);
  isRunning = true;
  currentSchedule = scheduleToUse;

  logger.info(`Scheduler started with schedule: ${scheduleToUse}`);

  return {
    running: true,
    schedule: scheduleToUse,
  };
}

/**
 * Stop scheduler
 */
export function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
  }

  isRunning = false;
  currentSchedule = null;

  logger.info("Scheduler stopped");

  return {
    running: false,
  };
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    running: isRunning,
    schedule: currentSchedule || getBackupConfig().schedule,
    nextRun: isRunning ? getNextRunTime(currentSchedule) : null,
  };
}

/**
 * Calculate next run time from cron schedule using cron-parser
 */
function getNextRunTime(schedule) {
  if (!schedule || !isRunning) return null;

  try {
    const interval = parser.parseExpression(schedule);
    return interval.next().toISOString();
  } catch (error) {
    logger.error("Failed to parse cron schedule", error);
    return null;
  }
}

/**
 * Initialize scheduler on startup if auto-backup is enabled
 */
export function initializeScheduler() {
  const config = getBackupConfig();

  if (config.auto) {
    try {
      startScheduler(config.schedule);
      logger.info("Auto-backup scheduler initialized");
    } catch (error) {
      logger.error("Failed to initialize scheduler", error);
    }
  }
}

import { spawn } from "child_process";
import { createReadStream } from "fs";

const MAX_OUTPUT = 50 * 1024 * 1024;

function appendLimited(current, chunk) {
  if (current.length >= MAX_OUTPUT) return current;
  return current + chunk.toString();
}

/**
 * Run a CLI tool with an argument array (no shell interpolation).
 * `stdinFile` streams a file into the process's stdin.
 */
export function runCommand(command, args, { env, stdinFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: [stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} is not installed or not in PATH`));
      } else {
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const message = stderr.trim().split("\n").slice(-5).join("\n");
        reject(new Error(message || `${command} exited with code ${code}`));
      }
    });

    if (stdinFile) {
      const input = createReadStream(stdinFile);
      input.on("error", (error) => {
        child.kill();
        reject(error);
      });
      child.stdin.on("error", () => {});
      input.pipe(child.stdin);
    }
  });
}

export function uniqueItems(items) {
  return [...new Set(items.filter(Boolean))];
}

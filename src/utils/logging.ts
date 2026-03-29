type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_PREFIX = "[Marjin AI]";

function log(level: LogLevel, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`${LOG_PREFIX} ${ts} [${level.toUpperCase()}]`, ...args);
}

export const logger = {
  debug: (...args: unknown[]) => log("debug", ...args),
  info: (...args: unknown[]) => log("info", ...args),
  warn: (...args: unknown[]) => log("warn", ...args),
  error: (...args: unknown[]) => log("error", ...args),
};

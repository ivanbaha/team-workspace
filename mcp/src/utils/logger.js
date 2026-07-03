/**
 * Internal logger utility for MCP server
 * Uses console.error stream for all log levels
 */
class Logger {
  info(message, ...args) {
    console.error(`[INFO] ${message}`, ...args);
  }

  debug(message, ...args) {
    console.error(`[DEBUG] ${message}`, ...args);
  }

  warn(message, ...args) {
    console.error(`[WARN] ${message}`, ...args);
  }

  error(message, ...args) {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

export const logger = new Logger();
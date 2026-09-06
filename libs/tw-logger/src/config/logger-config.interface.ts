export type LoggerLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/** What may be set in `LOGGER_LEVEL`. `silly` is accepted and collapses onto `verbose` internally. */
export type LoggerLevelInput = LoggerLevel | 'silly';

export type LoggerFormat = 'json' | 'pretty';

/**
 * How much of each HTTP request ends up in the logs.
 *
 * - `off` — no request logging at all. Traces still group log lines, but the caller → callee
 *   edges and per-call durations are gone, because those come only from the request-log pair.
 * - `compact` — one `info` line per direction carrying just what a trace needs: method, path,
 *   caller, status code, duration. No headers, no bodies.
 * - `full` — the `silly` payload: masked headers and bodies as well.
 */
export type RequestLoggingMode = 'off' | 'compact' | 'full';

export interface LoggerConfig {
  /** Identity of the emitting service. Must match the container name, or traces orphan. */
  serviceName: string;
  /** Which replica emitted the line. Absent outside a container. */
  podId?: string;
  level: LoggerLevel;
  format: LoggerFormat;
  requestLogging: RequestLoggingMode;
}

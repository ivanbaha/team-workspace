export type LOGGER_LEVEL = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silly';

/**
 * The logging surface a trace-aware component needs.
 *
 * Declared structurally so a consumer — `@tw/http-connector`, a test double, another team's
 * logger — can satisfy it without depending on this package's implementation. The trailing
 * `traceId` on every method is the contract that matters.
 */
export interface ITraceLogger {
  info(message: string, context?: string, traceId?: string): void;
  warn(message: string, context?: string, traceId?: string): void;
  error(message: string, trace?: string, context?: string, traceId?: string): void;
  debug(message: string, context?: string, traceId?: string): void;
  verbose(message: string, context?: string, traceId?: string): void;
  /** @deprecated Use {@link ITraceLogger.verbose}. Same level; `silly` was only a display label. */
  silly(message: string, context?: string, traceId?: string): void;
}

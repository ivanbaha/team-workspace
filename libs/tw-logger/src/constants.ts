/**
 * DI token for the process-wide singleton logger.
 *
 * `RequestScopedLoggerService` depends on this token rather than on `LoggerService` directly, so
 * `LoggerModule` can bind it with `useExisting` — one heavyweight instance, reused by every
 * per-request wrapper.
 */
export const BASE_LOGGER = 'BASE_LOGGER';

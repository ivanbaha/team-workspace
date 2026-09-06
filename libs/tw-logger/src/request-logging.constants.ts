/**
 * Paths kept out of the request log by default.
 *
 * These are probed by the platform every few seconds. Left in, they would be most of the log volume
 * and every one of them would be a root span in a trace that nobody asked for.
 */
export const DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS = ['/health', '/version', '/ready', '/metrics'];

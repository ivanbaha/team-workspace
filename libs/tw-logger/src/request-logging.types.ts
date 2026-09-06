export interface LoggerModuleOptions {
  /**
   * Paths excluded from request logging. Matched by exact path or suffix, so `/health` covers both
   * `/health` and `/api/health`.
   *
   * @default ['/health', '/version', '/ready', '/metrics']
   */
  requestLoggingExcludePaths?: string[];
}

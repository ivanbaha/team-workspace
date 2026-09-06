import type { RequestLoggingMode } from './logger-config.interface';

const VALID_REQUEST_LOGGING_MODES: RequestLoggingMode[] = ['off', 'compact', 'full'];

/**
 * Resolves the request-logging mode from raw environment values.
 *
 * `LOGGER_REQUEST_LOGGING` wins whenever it holds a valid mode. Otherwise the mode follows the log
 * level: `silly` opts into the full header/body payload, and everything else gets the compact one.
 *
 * The default therefore matters more than it looks — it is what makes tracing work in every
 * environment with no configuration at all. A service that has to be reconfigured before it can be
 * traced will not be traced on the day it breaks.
 *
 * @param rawMode - Raw `LOGGER_REQUEST_LOGGING` value, if set.
 * @param rawLevel - Raw `LOGGER_LEVEL` value. Needed unresolved, because the resolved level has
 *   already collapsed `silly` into `verbose`.
 */
export function resolveRequestLoggingMode(rawMode?: string, rawLevel?: string): RequestLoggingMode {
  if (rawMode && VALID_REQUEST_LOGGING_MODES.includes(rawMode as RequestLoggingMode)) {
    return rawMode as RequestLoggingMode;
  }
  return rawLevel === 'silly' ? 'full' : 'compact';
}

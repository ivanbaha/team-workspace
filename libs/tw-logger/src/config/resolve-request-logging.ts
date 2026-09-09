import type { RequestLoggingMode } from './logger-config.interface';

const VALID_REQUEST_LOGGING_MODES: RequestLoggingMode[] = ['off', 'compact', 'full'];

/**
 * Resolves the request-logging mode from raw environment values.
 *
 * `LOGGER_REQUEST_LOGGING` wins whenever it holds a valid mode. Otherwise the mode follows the log
 * level: **`verbose` — and its deprecated alias `silly` — opt into the full header/body payload, and
 * every other level gets the compact one.**
 *
 * `verbose` has to be included, not just `silly`. Once `silly` is documented as an alias for
 * `verbose`, the two behaving differently makes the alias a lie: an operator who follows the
 * deprecation notice and switches to `verbose` would silently lose the payloads they set the level
 * for. `LOGGER_REQUEST_LOGGING=full` remains the explicit way to ask, and it still wins.
 *
 * The default therefore matters more than it looks — it is what makes tracing work in every
 * environment with no configuration at all. A service that has to be reconfigured before it can be
 * traced will not be traced on the day it breaks.
 *
 * @param rawMode - Raw `LOGGER_REQUEST_LOGGING` value, if set.
 * @param rawLevel - Raw `LOGGER_LEVEL` value, before resolution.
 */
export function resolveRequestLoggingMode(rawMode?: string, rawLevel?: string): RequestLoggingMode {
  if (rawMode && VALID_REQUEST_LOGGING_MODES.includes(rawMode as RequestLoggingMode)) {
    return rawMode as RequestLoggingMode;
  }
  return rawLevel === 'verbose' || rawLevel === 'silly' ? 'full' : 'compact';
}

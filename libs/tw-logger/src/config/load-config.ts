import { extractPodId } from '../utils/pod-id.util';
import { resolveRequestLoggingMode } from './resolve-request-logging';

import type { LoggerConfig, LoggerFormat, LoggerLevel, LoggerLevelInput } from './logger-config.interface';

const VALID_LEVELS: LoggerLevelInput[] = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'];
const VALID_FORMATS: LoggerFormat[] = ['json', 'pretty'];

/**
 * Loads logger configuration from `process.env`.
 *
 * Read once at construction rather than per log line: this runs on the hot path of every request,
 * and the values cannot change without a restart anyway.
 */
export function loadLoggerConfig(env: NodeJS.ProcessEnv = process.env): LoggerConfig {
  const serviceName = resolveServiceName(env);

  return {
    serviceName,
    podId: extractPodId(env.POD_NAME, serviceName),
    level: resolveLevel(env.LOGGER_LEVEL),
    format: resolveFormat(env.LOGGER_FORMAT),
    requestLogging: resolveRequestLoggingMode(env.LOGGER_REQUEST_LOGGING, env.LOGGER_LEVEL),
  };
}

/**
 * Resolves the name this service logs under.
 *
 * `DEPLOYMENT_NAME` first, because the deployment is the only place that knows the container name —
 * and `serviceName` in a log line has to equal the container label for label-based and body-based
 * attribution to agree. When they disagree, traces show orphaned roots that are genuinely hard to
 * diagnose, because every individual log line looks correct.
 *
 * The `package.json` fallback keeps local development sensible without any env setup.
 */
function resolveServiceName(env: NodeJS.ProcessEnv): string {
  if (env.DEPLOYMENT_NAME) return env.DEPLOYMENT_NAME;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const packageJson = require(`${process.cwd()}/package.json`);
    const name: string = packageJson.name || '';
    // Scoped names log as the package part only: "@tw/orders-service" → "orders-service".
    if (name.includes('/')) return name.split('/')[1];
    return name || 'unknown-service';
  } catch {
    return 'unknown-service';
  }
}

function resolveLevel(raw?: string): LoggerLevel {
  if (raw && VALID_LEVELS.includes(raw as LoggerLevelInput)) {
    // `silly` is a display level, not a priority level — it filters as verbose.
    return raw === 'silly' ? 'verbose' : (raw as LoggerLevel);
  }
  return 'info';
}

function resolveFormat(raw?: string): LoggerFormat {
  return raw && VALID_FORMATS.includes(raw as LoggerFormat) ? (raw as LoggerFormat) : 'json';
}

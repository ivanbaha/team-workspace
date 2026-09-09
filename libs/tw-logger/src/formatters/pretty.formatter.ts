import type { LoggerConfig } from '../config';
import type { LogEntry } from './json.formatter';

const COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[32m',
  debug: '\x1b[34m',
  verbose: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

/**
 * Human-readable output for local development (`LOGGER_FORMAT=pretty`).
 *
 * Never used in a deployed environment: this format is not machine-parseable, so a service running
 * it emits log lines that no trace can reconstruct.
 */
export function formatPretty(entry: LogEntry, config: LoggerConfig): string {
  const color = COLORS[entry.level as keyof typeof COLORS] || COLORS.reset;
  const parts: string[] = [
    new Date().toISOString(),
    `[${color}${entry.level.toUpperCase()}${COLORS.reset}]`,
    `[${config.serviceName}]`,
  ];

  if (config.podId) parts.push(`[${config.podId}]`);
  if (entry.context) parts.push(`[${entry.context}]`);
  // Bold, because the trace id is the thing you are visually scanning for.
  if (entry.traceId) parts.push(`[${COLORS.bold}${entry.traceId}${COLORS.reset}]`);

  parts.push(entry.message);
  if (entry.trace) parts.push(`\n  Trace: ${entry.trace}`);

  return parts.join(' ') + '\n';
}

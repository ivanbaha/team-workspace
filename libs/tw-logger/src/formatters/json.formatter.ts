import { TRACE_ID_FIELD } from '@tw/tracing';

import type { LoggerConfig } from '../config';

export interface LogEntry {
  level: string;
  message: string;
  serviceName: string;
  podId?: string;
  context?: string;
  traceId?: string;
  trace?: string;
}

/**
 * The on-the-wire log contract. Everything downstream — Loki queries, Grafana panels, the trace
 * reconstruction in the MCP server — parses this shape, so changing it is a breaking change for
 * consumers that never imported this package.
 *
 * Two properties are load-bearing:
 *
 * 1. **One line, one JSON document.** The line is written to stdout and nothing reformats it.
 *    A multi-line record would be split into unrelated entries by the log shipper.
 * 2. **`traceId` is omitted when absent, never `null`.** A trace that matched every line with
 *    `"traceId": null` in it would be worse than useless.
 */
export function formatJson(entry: LogEntry, config: LoggerConfig): string {
  const output: Record<string, string | undefined> = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    serviceName: config.serviceName,
    podId: config.podId,
    context: entry.context,
    [TRACE_ID_FIELD]: entry.traceId,
    message: entry.message,
    trace: entry.trace,
  };

  // Drop undefined fields while preserving insertion order — field order is part of the contract
  // and is asserted in the tests, because a human scanning raw lines in Grafana relies on it.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(output)) {
    if (value !== undefined) cleaned[key] = value;
  }

  return JSON.stringify(cleaned) + '\n';
}

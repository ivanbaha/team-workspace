/**
 * Trace assembly: a trace id in, a reconstructed call chain out.
 *
 * Shared by the `grafana_trace_id` MCP tool and the `.ai/connectors/grafana/trace-id.mjs` connector.
 * Loki access is injected as a transport function rather than imported, so this module never holds
 * credentials and stays testable without a Grafana instance.
 */

import { parseLokiResponse } from './parse.js';
import { renderReport } from './render.js';
import {
  analyzeCoverage,
  buildCallTree,
  buildEdges,
  buildSpans,
  collectProblems,
  repeatedEdges,
  wallTime,
} from './spans.js';

/**
 * Order in which environments are searched when the caller does not name one.
 *
 * Cheap and low-risk first. Naming the environment is dramatically faster, because **finding a
 * trace is cheap while proving its absence is expensive** — a miss costs a full scan of every tier.
 */
export const ENVIRONMENT_TIERS = [['test'], ['staging', 'uat'], ['prod', 'production']];

/** Loki rejects a `query_range` wider than 30 days with an opaque HTTP 400. */
export const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** Default window searched when the caller gives no time range. */
export const DEFAULT_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/** Maximum log lines pulled for one trace. Beyond this the result is marked truncated. */
export const DEFAULT_LIMIT = 5000;

/**
 * Extracts a trace id from whatever the user pasted.
 *
 * Ids arrive inside bug reports far more often than they arrive on their own: as a whole log line,
 * a URL, a stack trace. Resolution order is deliberate — a bare token is taken **verbatim, with its
 * case intact**, because there is no trace id format to normalise towards. Only a `traceId` field
 * inside a pasted log line, and then a ULID mined from free text, are used as fallbacks.
 *
 * @param {string} input - Raw user input.
 * @returns {string|undefined} The trace id, or undefined when nothing recognisable is present.
 */
export function extractTraceId(input) {
  if (!input) return undefined;
  const text = String(input).trim();

  // A single bare token is the id itself. No format check: ids derived for cron pages and message
  // legs are legitimate and look nothing like a ULID, so validating would refuse real traffic.
  if (/^[A-Za-z0-9_.:+-]{6,200}$/.test(text)) return text;

  const field = /"traceId"\s*:\s*"([^"]+)"/.exec(text);
  if (field) return field[1];

  const ulidInText = /\b[0-9A-HJKMNP-TV-Z]{26}\b/i.exec(text);
  if (ulidInText) return ulidInText[0].toUpperCase();

  return undefined;
}

/**
 * Quotes a value as a LogQL string literal.
 *
 * Backtick-quoted LogQL strings are raw and cannot contain a backtick at all, so a backtick in the
 * search term silently produces a malformed query and an opaque HTTP 400. Double-quoted literals
 * accept escapes, so they are used instead.
 */
export function logqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

/**
 * Builds the query that is the entire "distributed trace lookup".
 *
 * A plain `|=` line filter beats a regex match for a literal token, and the trace id lives in the
 * log body rather than in a label — deliberately. A per-request label would be unbounded
 * cardinality, which is pathological for Loki's index. A narrow label selector plus a line filter
 * is the shape the database is built for.
 */
export function buildTraceQuery(traceId, namespaceRegex) {
  const selector = namespaceRegex ? `{namespace=~"${namespaceRegex}"}` : '{namespace=~".+"}';
  return `${selector} |= ${logqlString(traceId)}`;
}

/**
 * Assembles a trace from already-fetched log lines.
 *
 * @param {string} traceId
 * @param {string} environment
 * @param {object} lokiResponse - Raw Loki `query_range` response.
 */
export function assembleTrace(traceId, environment, lokiResponse) {
  const events = parseLokiResponse(lokiResponse);
  const spans = buildSpans(events);
  const edges = buildEdges(spans);

  return {
    traceId,
    environment,
    events,
    spans,
    edges,
    tree: buildCallTree(spans),
    coverage: analyzeCoverage(spans, events),
    problems: collectProblems(events, spans),
    repeated: repeatedEdges(edges),
    wallTimeMs: wallTime(spans),
  };
}

/**
 * The compact view an agent consumes.
 *
 * Deliberately excludes raw log volume. A trace of a few thousand lines has to be usable inside a
 * context window, and the full report goes to a file for the cases where the detail is needed.
 */
export function summarize(trace) {
  return {
    found: true,
    traceId: trace.traceId,
    environment: trace.environment,
    counts: {
      logLines: trace.events.length,
      spans: trace.spans.length,
      services: trace.coverage.traced.length,
    },
    wallTimeMs: trace.wallTimeMs,
    services: trace.coverage,
    spans: trace.spans.map((span) => ({
      service: span.service,
      call: `${span.method} ${span.path}`,
      statusCode: span.statusCode,
      durationMs: span.duration,
      caller: span.caller,
      ...(span.ambiguous ? { ambiguous: true } : {}),
      ...(span.unterminated ? { unterminated: true } : {}),
      ...(span.paired ? {} : { paired: false }),
    })),
    edges: trace.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      call: `${edge.method} ${edge.path}`,
      count: edge.calls.length,
      statusCodes: [...new Set(edge.calls.map((call) => call.statusCode ?? null))],
    })),
    repeatedEdges: trace.repeated,
    problems: trace.problems.slice(0, 50),
    ...(trace.problems.length > 50 ? { problemsTruncated: trace.problems.length } : {}),
  };
}

export { renderReport };

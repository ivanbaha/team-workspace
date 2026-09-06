#!/usr/bin/env node
/**
 * Grafana/Loki connector — trace one Trace-Id across every service that took part in a request.
 *
 * Usage:
 *   node .ai/connectors/grafana/trace-id.mjs --trace-id <id> [options]
 *
 * Options:
 *   --trace-id <id>     (required) The id, or text containing one (a log line, a URL, a stack trace)
 *   --env <key>         Search only this environment. Much faster than searching all of them
 *   --start <iso>       Start of the search window
 *   --end <iso>         End of the search window (default: now)
 *   --lookback <hours>  Window size when --start is omitted (default: 48, capped at 30 days)
 *   --limit <n>         Max log lines to fetch (default: 5000)
 *   --report <path>     Also write the full Markdown report (Mermaid diagram, call tree, spans)
 *   --json              Print the compact summary as JSON instead of the human-readable report
 *
 * Output: the Markdown report on stdout, or JSON with --json. Errors go to stderr.
 *
 * The reconstruction logic is imported from the MCP server rather than copied, so the CLI, the
 * connector and the `grafana_trace_id` MCP tool can never disagree about what a trace means.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getGrafanaConfig, getEnvironment } from './config.mjs';
import {
  DEFAULT_LIMIT,
  DEFAULT_LOOKBACK_MS,
  ENVIRONMENT_TIERS,
  MAX_LOOKBACK_MS,
  assembleTrace,
  buildTraceQuery,
  extractTraceId,
  renderReport,
  summarize,
} from '../../../mcp/src/grafana/trace/index.js';

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const traceId = extractTraceId(args['trace-id']);

if (!traceId) {
  process.stderr.write(
    'Usage: node trace-id.mjs --trace-id <id> [--env <env>] [--start <iso>] [--end <iso>]\n' +
      '                        [--lookback <hours>] [--limit <n>] [--report <path>] [--json]\n',
  );
  process.exit(1);
}

// ── Time window ───────────────────────────────────────────────────────────────

const endMs = args.end ? new Date(args.end).getTime() : Date.now();
const requestedSpan = args.lookback ? Number(args.lookback) * 3600_000 : DEFAULT_LOOKBACK_MS;
// Loki answers a wider range with an opaque HTTP 400, so the cap is applied here where it can be
// explained rather than surfacing as a failed query.
const startMs = args.start ? new Date(args.start).getTime() : endMs - Math.min(requestedSpan, MAX_LOOKBACK_MS);
const limit = Number(args.limit ?? DEFAULT_LIMIT);

// ── Environment order ─────────────────────────────────────────────────────────

/**
 * Cheap and low-risk tiers first. Finding a trace is cheap; proving its absence means scanning
 * every environment, which is why naming one with --env is dramatically faster.
 */
function orderEnvironments(configured) {
  const remaining = new Set(configured);
  const ordered = [];
  for (const tier of ENVIRONMENT_TIERS) {
    for (const name of tier) if (remaining.delete(name)) ordered.push(name);
  }
  return [...ordered, ...remaining];
}

const configured = Object.keys(getGrafanaConfig().environments);
const environments = args.env ? [args.env] : orderEnvironments(configured);

// ── Query each environment until one answers ─────────────────────────────────

async function queryLoki(envKey) {
  const env = getEnvironment(envKey);
  const url = new URL(`${env.lokiUrl.replace(/\/$/, '')}/loki/api/v1/query_range`);
  url.searchParams.set('query', buildTraceQuery(traceId, null));
  url.searchParams.set('start', String(startMs * 1_000_000));
  url.searchParams.set('end', String(endMs * 1_000_000));
  url.searchParams.set('limit', String(limit));
  // Chronological: every step of the reconstruction assumes time order.
  url.searchParams.set('direction', 'forward');

  const headers = { Accept: 'application/json' };
  if (env.username) {
    headers.Authorization = `Basic ${Buffer.from(`${env.username}:${env.password}`).toString('base64')}`;
  } else if (env.password || env.pat) {
    headers.Authorization = `Bearer ${env.password || env.pat}`;
  }

  const response = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

const probes = [];

for (const envKey of environments) {
  let body;
  try {
    body = await queryLoki(envKey);
  } catch (error) {
    // Recorded rather than fatal: one unreachable environment must not stop the search, but it also
    // must not be reported as "the trace is not there".
    probes.push({ environment: envKey, status: 'unreachable', error: error.message });
    process.stderr.write(`[trace-id] ${envKey}: ${error.message}\n`);
    continue;
  }

  const lines = (body?.data?.result ?? []).reduce((total, stream) => total + (stream.values?.length ?? 0), 0);
  if (lines === 0) {
    probes.push({ environment: envKey, status: 'empty' });
    continue;
  }

  const trace = assembleTrace(traceId, envKey, body);

  if (args.report) {
    const path = resolve(String(args.report));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderReport(trace), 'utf8');
    process.stderr.write(`[trace-id] report written to ${path}\n`);
  }

  if (lines >= limit) {
    process.stderr.write(`[trace-id] WARNING: hit the ${limit}-line limit — the trace may be incomplete.\n`);
  }

  process.stdout.write(args.json ? JSON.stringify(summarize(trace), null, 2) + '\n' : renderReport(trace));
  process.exit(0);
}

// Not found is not an error — but "proven absent" and "we could not look" are different answers.
const inconclusive = probes.filter((probe) => probe.status !== 'empty');
process.stdout.write(
  JSON.stringify(
    {
      found: false,
      traceId,
      searched: environments,
      window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() },
      probes,
      note:
        inconclusive.length > 0
          ? `${inconclusive.length} environment(s) were unreachable — this is NOT proof of absence.`
          : 'All searched environments answered and none contained this trace id in the given window.',
    },
    null,
    2,
  ) + '\n',
);

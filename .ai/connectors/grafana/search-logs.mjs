#!/usr/bin/env node
/**
 * Grafana/Loki connector — search log lines.
 *
 * Usage:
 *   node .ai/connectors/grafana/search-logs.mjs --env <env> [options]
 *
 * Options:
 *   --env <key>        (required) Environment key from get-available.mjs
 *   --service <name>   Filter by container/service name label
 *   --search <text>    Text to search for within log lines
 *   --exclude <regex>  Regex pattern to exclude matching lines (e.g. "debug|trace")
 *   --start <iso>      Start time in ISO 8601 (default: 15 minutes ago)
 *   --end <iso>        End time in ISO 8601 (default: now)
 *   --limit <n>        Maximum log lines to return (default: 100)
 *
 * Output: JSON object with query metadata and log lines, printed to stdout.
 * Errors: written to stderr.
 */

import { getEnvironment } from './config.mjs';

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.env) {
  process.stderr.write(
    'Usage: node search-logs.mjs --env <env> [--service <name>] [--search <text>] [--exclude <regex>] [--start <iso>] [--end <iso>] [--limit <n>]\n'
  );
  process.exit(1);
}

const env = getEnvironment(args.env);
const limit = parseInt(args.limit ?? '100', 10);
const now = Date.now();
const startMs = args.start ? new Date(args.start).getTime() : now - 15 * 60 * 1000;
const endMs = args.end ? new Date(args.end).getTime() : now;

// ── Build LogQL query ─────────────────────────────────────────────────────────

function buildQuery() {
  const selectors = [];
  if (args.service) selectors.push(`container="${args.service}"`);
  const streamSelector = selectors.length ? `{${selectors.join(',')}}` : `{}`;

  const filters = [];
  if (args.search) filters.push(`|= "${args.search.replace(/"/g, '\\"')}"`);
  if (args.exclude) filters.push(`!~ "${args.exclude.replace(/"/g, '\\"')}"`);

  return filters.length ? `${streamSelector} ${filters.join(' ')}` : streamSelector;
}

const query = buildQuery();

// ── Query Loki ────────────────────────────────────────────────────────────────

const url = new URL(`${env.lokiUrl}/loki/api/v1/query_range`);
url.searchParams.set('query', query);
url.searchParams.set('start', String(startMs * 1_000_000)); // nanoseconds
url.searchParams.set('end', String(endMs * 1_000_000));
url.searchParams.set('limit', String(limit));
url.searchParams.set('direction', 'backward');

const auth = Buffer.from(`${env.username}:${env.password}`).toString('base64');

let body;
try {
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    process.stderr.write(`[search-logs] HTTP ${res.status}: ${text}\n`);
    process.exit(1);
  }

  body = await res.json();
} catch (err) {
  process.stderr.write(`[search-logs] Request failed: ${err.message}\n`);
  process.exit(1);
}

// ── Parse and output results ──────────────────────────────────────────────────

const streams = body?.data?.result ?? [];
const lines = [];

for (const stream of streams) {
  const labels = stream.stream ?? {};
  for (const [tsNs, logLine] of stream.values ?? []) {
    lines.push({
      timestamp: new Date(Math.floor(Number(tsNs) / 1_000_000)).toISOString(),
      labels,
      line: logLine,
    });
  }
}

// Loki returns newest first within each stream; sort overall by timestamp ascending
lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

const output = {
  query: { env: args.env, logql: query, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), limit },
  total: lines.length,
  lines,
};

process.stdout.write(JSON.stringify(output, null, 2) + '\n');

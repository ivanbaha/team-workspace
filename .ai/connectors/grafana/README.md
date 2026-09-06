# Grafana Connector

Query Grafana/Loki logs from the shell. This is the only connector here that is
**fully implemented** — the others are still planned — so it is the reference
for how a connector is expected to behave.

## Scripts

| Script | Description |
| --- | --- |
| `config.mjs` | Shared config loader — reads `GRAFANA_ENVS` from the root `.env`, falling back to `.ai/connectors/env.json` |
| `get-available.mjs` | List configured environments; `--check` also tests connectivity |
| `search-logs.mjs` | Search log lines in Loki by service, text, and time range |
| `trace-id.mjs` | Trace one Trace-Id across every service and reconstruct the call chain |

## Usage

```bash
# Which environments are configured, and are they reachable?
node .ai/connectors/grafana/get-available.mjs
node .ai/connectors/grafana/get-available.mjs --check

# Search logs
node .ai/connectors/grafana/search-logs.mjs --env test --service users-service --search "timeout"
node .ai/connectors/grafana/search-logs.mjs --env prod --search "500" --exclude "debug|trace" --limit 50

# Trace one request across every service that touched it
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6EYRY4TFEPR9PHJZ1QHPF --env test
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6… --env test --report ./trace.md
```

### `trace-id.mjs` options

| Option | Description |
| --- | --- |
| `--trace-id <id>` | **Required.** The id, or any text containing one — a pasted log line, a URL, a stack trace |
| `--env <key>` | Search one environment. **Pass it whenever you know it** — finding a trace is cheap, proving its absence is not |
| `--start <iso>` / `--end <iso>` | Search window |
| `--lookback <hours>` | Window size when `--start` is omitted (default 48, capped at 30 days — Loki rejects wider) |
| `--limit <n>` | Max log lines (default 5000). Hitting the limit is reported, not hidden |
| `--report <path>` | Also write the full Markdown report (Mermaid diagram, call tree, span table) |
| `--json` | Print the compact summary instead of the report |

The reconstruction logic is imported from `mcp/src/grafana/trace/` rather than duplicated, so this
connector and the `grafana_trace_id` MCP tool can never disagree about what a trace means.

**Read the output with the guards in mind** — `services.gaps` never means a service was skipped, and
`ambiguous: true` means "do not trust the duration", not "the call did not happen". The full list is
in [Tracing a Request](../../../docs/guides/tracing-a-request.md#reading-the-result-without-drawing-false-conclusions).

### `search-logs.mjs` options

| Option | Description |
| --- | --- |
| `--env <key>` | **Required.** Environment key, as listed by `get-available.mjs` |
| `--service <name>` | Filter by container/service name label |
| `--search <text>` | Text to search for within log lines |
| `--exclude <regex>` | Drop matching lines, e.g. `"debug\|trace"` |
| `--start <iso>` | Start time, ISO 8601 (default: 15 minutes ago) |
| `--end <iso>` | End time, ISO 8601 (default: now) |
| `--limit <n>` | Maximum lines to return (default: 100) |

## Output contract

All connectors follow the same contract, which is what makes them usable by any
agent that can run a shell command:

- **stdout** is JSON, and only JSON.
- **stderr** carries errors and diagnostics.
- A non-zero exit code means the command failed.

Keeping diagnostics off stdout is not a style preference — an agent parses
stdout, so one stray log line there turns a successful call into a parse error.

## Credentials

Read from `GRAFANA_ENVS` in the root [`.env`](../../../example.env), shared with
the MCP server so there is one place to rotate a token:

```env
GRAFANA_ENVS='{
  "test": { "pat": "glsa_xxx" },
  "prod": { "pat": "glsa_yyy", "url": "https://grafana.company.internal/" }
}'
```

`url` is optional per environment and falls back to the built-in default.

## Connector or MCP tool?

Both are available for Grafana; see [MCP vs Connectors](../../README.md#mcp-vs-connectors-tool-execution-approaches).
The short version: the MCP tool (`grafana_search_logs`) is the better default
because the agent gets a typed schema and does not have to remember flags. These
scripts exist for agents without MCP support, and for running the same query by
hand while debugging.

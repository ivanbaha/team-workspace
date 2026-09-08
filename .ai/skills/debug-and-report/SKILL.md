---
name: debug-and-report
description: "Debug a production or test issue using logs and codebase analysis, then optionally create a Jira bug ticket with all findings. Use when the user reports something broken in an environment, gives a trace id, or asks to investigate an error and raise a bug."
---

# Debug Issue & Create Bug Report

You are a debugging assistant. Your goal is to help the user investigate a reported issue, find root cause evidence in logs and code, and optionally create a well-structured Jira bug ticket.

## Step 1: Gather Initial Context

Ask the user to describe the issue. You need at minimum:

- What happened (error message, unexpected behavior)
- Any identifiers: **trace id**, timestamp, API path, user action
- Environment (if known)

If the user provides **no identifiers at all** (only a vague description like "something broke in prod"), ask one focused follow-up before proceeding:

> "Can you share any error message, timestamp, the `x-trace-id` from the failing response, or the name of the endpoint/feature that failed?"

**If a trace id is available in any form, go straight to Step 1a. Do not start with `grafana_search_logs`.**

The id does not have to be clean. A pasted log line, a URL, or a stack trace containing one all work — the tooling extracts it. Every response from every service echoes `x-trace-id`, so a user who can reproduce the problem can always produce one.

If there is no trace id but an API path or service name is mentioned, identify the service from the path and proceed to Step 2 (log search). Once you find **any** relevant log line, read its `traceId` field and return to Step 1a — one trace beats ten narrowing queries.

## Step 1a: Trace the request (do this first whenever a trace id is known)

Call `grafana_trace_id` with just the `trace_id`, adding `environment` whenever you know it:

```txt
grafana_trace_id  { "trace_id": "01M0J6EYRY4TFEPR9PHJZ1QHPF", "environment": "test" }
```

Or from a shell:

```bash
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6EYRY4TFEPR9PHJZ1QHPF --env test
```

It finds the environment itself when you do not name one, reconstructs the call chain, and returns
spans, caller → callee edges, per-call status codes and durations, coverage gaps, and every error
and warning logged under that id — replacing the manual narrowing loop in Step 2 entirely.

**Always name the environment when you know it.** Finding a trace is cheap; proving its absence
means scanning every environment over the whole window.

Pass `output_file` for a large trace so the full report goes to a file instead of into context.

### Interpretation guards — do not skip these

The reconstruction is a heuristic. A flat trace id carries no span identity, so the output flags its
own uncertainty and you must not read past those flags:

- `services.gaps` — services that took part but emitted **no** request logs. A gap does **not** mean
  the service was uninvolved; it usually means it has not adopted `@tw/logger`, is running below
  `info` level, or is not ours. **Never conclude a service was skipped from its absence in `spans`.**
- `ambiguous: true` / `paired: false` — another request was open on the same endpoint, so the
  incoming/outgoing pairing is a guess. Read this as "do not trust the elapsed time", **not** as
  "the call did not happen".
- `unterminated: true` — a request never produced a response: a crash, a timeout, or a request still
  in flight. This is frequently the finding, not noise.
- `repeatedEdges` — the same call made more than once in one request. Could be cache misses or
  duplicated work; the tool reports the count and refuses to guess. Worth investigating.
- `found: false` with every probe `empty` — searched successfully, the id is genuinely not there in
  that window. Retry with a wider `lookback_hours` before concluding anything.
- `found: false` with any probe `unreachable` — an environment could not be queried, usually an
  expired Grafana token. **This is not proof of absence.**
- **Zero spans plus a 401/403 warning is a complete trace.** Guards run before interceptors in
  NestJS, so a rejected request never reaches the request-logging interceptor. The rejection is
  logged under the trace id by the exception filter; the absence of spans is expected, not a gap.

Background: [Distributed Tracing](../../../docs/architecture/distributed-tracing.md) ·
[Tracing a Request](../../../docs/guides/tracing-a-request.md)

### Resolve Exact Service Name

**ALWAYS** look up the exact service/container name before querying Grafana — never guess it. Use `backend/README.md` which lists all services with their exact names. Match the user's description to the correct entry (e.g. "users" → `users-service`, not `user-service`).

The container name, `DEPLOYMENT_NAME`, the `serviceName` in every log line, and the service's outbound `User-Agent` are all the same string by design, so the name in `backend/README.md` is the one that works everywhere.

### Check Deployment Config for Scheduled/Sync Services

If the issue involves a cron-based or scheduled service:

1. Find the service's deployment values YAML in `infra/git-ops/<env>/<service-name>-values.yaml`
2. Extract key configuration:
   - **Cron expressions** (e.g. `CRON_SCHEDULE`) — to know when the service actually runs
   - **Replica count** (`replicaCount` or `autoscaling.minReplicas`) — to understand if distributed lock behavior is expected
   - **Logger level** (`LOGGER_LEVEL`) — to know which log levels are visible. If not set to `debug`, debug-level messages (like jitter, lock acquisition details) will NOT appear. Fall back to searching for `info`/`warn` level messages instead.
3. Use the cron schedule to calculate actual execution times before searching specific time windows.

## Step 2: Search Logs

Use the Grafana connector scripts to find relevant logs. The connectors live in `.ai/connectors/grafana/`.

### Resolve Environment Name First

Before searching, always run the following to get the list of valid environment keys:

```bash
node .ai/connectors/grafana/get-available.mjs
```

This returns the canonical environment names (e.g. `test`, `staging`, `production`). Use this to map natural-language input from the user (e.g. "staging", "prod") to the correct `--env` parameter value.

Use `--check` flag only when troubleshooting connectivity issues — it makes HTTP calls to each Grafana instance and is slower:

```bash
node .ai/connectors/grafana/get-available.mjs --check
```

### Environment Search Order

If the user specifies an environment, search only that one. Otherwise, search environments in this order until you find relevant logs:

1. `test`
2. `staging`

**NEVER search production environments unless the user explicitly asks for it.**

### Search Strategy

Run the search connector:

```bash
node .ai/connectors/grafana/search-logs.mjs --env <env> [options]
```

Available options:

- `--env` (required) — environment key from get-available.mjs output
- `--service` — container/service name (e.g. `users-service`, `products-service`)
- `--search` — text to search for in logs
- `--exclude` — regex pattern to exclude matching lines (e.g. `debug|trace`)
- `--start` — ISO 8601 start time (default: 15 min ago)
- `--end` — ISO 8601 end time (default: now)
- `--limit` — max log lines to return (default: 100)

Search approach:

- **If a trace id is available, you should be in Step 1a, not here.** `grafana_trace_id` does in one call what this section does in several.
- If service name is known: set it as `--service`.
- If only an error message or keyword is available: use it as `--search` and iterate through environments.
- Narrow down time range using `--start`/`--end` if the user provides a timestamp or approximate time.
- **The moment any returned line has a `traceId`, stop narrowing and go back to Step 1a with it.** One trace beats ten refined queries, and it will surface services you had not thought to search.

### Verify Connector Before Deep Investigation

Before running targeted searches, do a quick sanity check — an unfiltered query with just `--service` (no `--search`, no `--start`/`--end`, default 15-min window). This confirms:

- The service name is correct (container exists in Loki)
- The connector can reach Grafana and retrieve data
- The service is actively emitting logs

If this returns 0 results, work through the following before assuming the service name is wrong:

1. **Time range too narrow?** — The default window is the last 15 minutes. Re-run with an explicit `--start`/`--end` covering the time the incident was reported.
2. **Service not running recently?** — For cron jobs or low-traffic services, there may simply be no recent activity. Widen the window to 24 hours (`--start <today>T00:00:00Z`) before drawing conclusions.
3. **Loki connectivity issue?** — Re-run the query with no `--service` filter at all. If that also returns 0, the problem is likely the connector itself or a Grafana outage — run `node .ai/connectors/grafana/get-available.mjs --check` to verify.
4. **Only if all above are ruled out** — the service name is likely wrong. Go back to `backend/README.md` and copy the exact container name.

### Time Range Strategy for Cron/Scheduled Services

When investigating periodic or cron-based services, do NOT guess time windows. Follow this order:

1. **Full-day keyword scan first.** Use a broad time range (`--start <today>T00:00:00Z --end <now>`) with a specific keyword to discover when events actually occurred. This gives you a timeline before you drill into details.
2. **Then narrow down.** Once you know the actual timestamps of activity, query specific windows around those times for detailed logs.
3. **Don't assume cron times are exact.** Cron expressions define the schedule, but actual execution may vary slightly. Always verify with the broad scan first.

### Interpreting Results

Analyse the returned log lines for:

- Error stack traces and error messages
- Request/response details
- Upstream service failures or timeouts
- Database connection issues
- Configuration problems

## Step 3: Identify the Service and Analyse Codebase

Once you've identified the problematic service from logs:

1. If you are not already familiar with the workspace layout from earlier in this conversation, read `README.md` first.
2. Navigate to the service under `backend/<service-name>/` and read its README or relevant source files to understand the code area related to the error.
3. Read `infra/README.md` for infrastructure context — environment layout, clusters, and deployment configs.
4. Determine if the issue is:
   - **Code-level** (bug in service logic, dependency issue, etc.) → team: `dev`
   - **Infrastructure-level** (deployment config, resource limits, connectivity, etc.) → team: `devops`
   - **Both** → two separate tickets needed

## Step 4: Present Findings to User

### If a root cause was found

Provide the user with a clear summary:

- Which service is affected
- What the error is (with log evidence)
- Potential root cause (high-level)
- Which environment(s) are affected
- Whether it's a code or infra issue (or both)

If the finding is concrete and actionable, ask: **"Would you like me to create a Jira ticket for this?"**

Skip this question if the finding is not actionable — for example, if the root cause is already known and tracked, or if no real fix is needed.

### If no root cause was found

Tell the user clearly what was checked and what was ruled out. Then suggest concrete next steps, for example:

- Adding more structured logging around the suspected code path
- Checking infrastructure-level alerts (memory limits, OOM kills, pod restarts) in `infra/git-ops/`
- Asking the user for a reliable reproduction case or additional identifiers
- Widening the search to adjacent services that this service depends on

## Step 5: Create Jira Ticket(s)

If the user agrees, draft the ticket and show it to the user before creating. Ask the user to confirm or adjust any fields.

Use the Jira connector (`.ai/connectors/jira/`) with the following conventions:

### Summary Format

- Prefix with `[service-name]` always.
- If the issue affects only a specific environment, also prefix with `[ENV-NAME]`.
- Examples:
  - `[users-service] Update mongoose version to remove deprecation warnings`
  - `[STAGING][products-service] Fix mongo connection timeout`

### Description Structure

The description must include:

1. **Issue Description** — clear, informative explanation of what's happening and potential high-level fix direction (no deep implementation details).
2. **Evidence** — include whichever of the following are available: **trace id**, relevant log excerpts, error messages, timestamps, environment. All fields are optional — only include what exists.

   **Always include the trace id when you have one.** It is the single thing that lets whoever picks the ticket up next reconstruct the entire picture without asking anyone. Paste the reconstructed call chain (the Mermaid diagram from the report) when the issue spans more than one service.
3. **Acceptance Criteria** — what "fixed" looks like.

### Team Assignment

- Code/service bug → `team: "dev"`
- Infrastructure/deployment issue → `team: "devops"`
- If both are involved → create two separate tickets, one per team.

### Multiple Services

A single ticket can cover multiple services if they share the same root cause and belong to the same team. Otherwise, split into separate tickets.

### Other Fields

Let the tool defaults handle project, priority, reporter, and issue type unless the user specifies otherwise. Ask the user if they want to set any optional fields (priority, labels, assignee, fix versions, sprint) before creating.

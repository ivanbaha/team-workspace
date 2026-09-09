# Tracing a Request

What to do when something breaks and you have — or can get — a trace id.

How the mechanism works and why it is shaped this way:
[Distributed Tracing](../architecture/distributed-tracing.md).

---

## The 30-second version

```logql
{namespace=~"team-workspace"} |= "01M0J6EYRY4TFEPR9PHJZ1QHPF"
```

Paste that into Grafana's Explore view. It returns every log line from every service that touched
the request, in order. There is nothing else to configure and no other tool to learn.

Everything below is either how to *get* the id, or how to have the chain assembled for you.

---

## Getting a trace id

| You have | Do this |
|---|---|
| A bug report from a user | Ask for the `x-trace-id` response header, or the failing request from their network tab |
| A failing request you can reproduce | `curl -i` — the id is echoed back on every response |
| A pasted log line | The `traceId` field is right there. The tooling also mines it out for you |
| An error in an alert or a ticket | Search for a distinctive part of the message, then read the `traceId` off the line you find |
| Nothing at all | Narrow by service and time first (`grafana_search_logs`), find one line, take its id, then trace that |

```bash
curl -i http://localhost:4001/health
# x-trace-id: 01M1S2G1KH29B6406YZARSK831
```

You can also **supply your own id**, which is the fastest way to trace something you are about to
do. Any non-empty string works — there is no format:

```bash
curl "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'x-trace-id: ivan-checkout-debug-1'
```

---

## Have the chain assembled for you

The raw query gives you correlated lines. This gives you the call graph: who called whom, with what
status, how long each took, and what was logged under it.

### From an AI agent (MCP)

```txt
grafana_trace_id  { "trace_id": "01M0J6EYRY4TFEPR9PHJZ1QHPF", "environment": "test" }
```

Accepts the bare id or any text containing one — a whole log line, a URL, a stack trace. Returns a
compact summary; pass `output_file` to also write the full Markdown report (Mermaid diagram, call
tree, span table) without any of it entering the context window.

### From a shell

```bash
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6EYRY4TFEPR9PHJZ1QHPF --env test
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6… --env test --json
node .ai/connectors/grafana/trace-id.mjs --trace-id 01M0J6… --env test --report ./trace.md
```

| Flag | Meaning |
|---|---|
| `--trace-id` | The id, or text containing one |
| `--env` | Search one environment. **Always pass this if you know it** |
| `--start` / `--end` | ISO 8601 search window |
| `--lookback` | Hours back from now when `--start` is omitted (default 48, capped at 30 days) |
| `--limit` | Max log lines (default 5000). Hitting it is reported, not hidden |
| `--report` | Also write the full Markdown report to a path |
| `--json` | Print the compact summary instead of the report |

**Name the environment whenever you know it.** Finding a trace is cheap; *proving it is absent* is
expensive, because that means scanning every environment over the whole window.

---

## Reading the result without drawing false conclusions

The reconstruction is a heuristic — a flat id carries no span identity — and the output says so.
These are the guards that matter:

| Field | What it means | What it does **not** mean |
|---|---|---|
| `services.gaps` | The service took part but emitted no request logs | **Not** that it was skipped. Usually it has not adopted `@tw/logger`, runs below `info` level, or is not ours |
| `ambiguous: true` | Another request was open on the same endpoint, so the request.in/response.out pairing is a guess | Not that the call failed. **Do not trust the duration**; the call definitely happened |
| `paired: false` | One half of the pair is missing — usually the window clipped it | Not that the request was incomplete |
| `unterminated: true` | A request never produced a response — crash, timeout, or still in flight | This is frequently the answer, not noise |
| `repeatedEdges` | The same call was made more than once in one request | Could be cache misses or duplicated work. The tool refuses to guess which |
| `found: false`, all probes `empty` | Searched successfully; the id is genuinely not there in that window | Widen with `--lookback` before concluding it never happened |
| `found: false`, a probe `unreachable` | An environment could not be queried — usually an expired token | **Not** proof of absence |

One more, because it causes real confusion: **a 401 or 403 produces no request.in/response.out pair at
all.** Guards run before interceptors in NestJS, so a rejected request never reaches the
request-logging interceptor. The rejection is still logged under the trace id by the exception
filter — you will see the `warn` line but no span:

```txt
2026-09-09T12:40:03.690Z [WARN] [products-service] [GET /v1/products/1] [01M232XDV9WAZG97TH6BSCZ17Q] 401 UNAUTHENTICATED: No token provided
```

Zero spans plus a 401 warning is a complete, correct trace of an unauthenticated request.

---

## When the trace looks wrong

| Symptom | Likely cause |
|---|---|
| A service's calls appear as orphaned roots | Its outbound `User-Agent` disagrees with the name it logs under. Check that `userAgent` in `HttpConnectionModule.forRoot()` and `DEPLOYMENT_NAME` are the same value |
| A service's calls are attributed to `undefined` | `userAgent` resolved to nothing at runtime — `process.env.DEPLOYMENT_NAME` with no `??` fallback, in a deployment that does not set it. Newer builds refuse to boot instead; an older one keeps running |
| Every browser call is one node called `browser` | Working as designed. `user-agent` is a forbidden header name in `fetch`, so no microfrontend can name itself — see [The entry point](../architecture/distributed-tracing.md#the-entry-point--the-browser) |
| The trace starts one service too late | The first service is not seeding an id. Check that `TracingModule.forRoot()` is imported there, not only downstream |
| The trace starts at the edge service, never at the browser | The frontend interceptor is not installed, or the API is cross-origin without `Access-Control-Allow-Headers: x-trace-id` on the preflight |
| The user cannot find an id to report | Cross-origin without `Access-Control-Expose-Headers: x-trace-id`. The echo arrives, but the page cannot read it — the request itself succeeds, so nothing looks broken |
| A service logs lines but no request pair | `LOGGER_REQUEST_LOGGING=off`, or the path is in the exclude list (`/health`, `/version`, `/ready`, `/metrics`) |
| A trace id is 128 characters and looks cut off | It is. An inbound id longer than that is truncated by `ensureTraceId` — the caller sent an oversized header |
| Log lines with no `traceId` at all | Work outside an HTTP request — a cron tick or a queue consumer — that did not thread an id. See [the manual fallback](../architecture/distributed-tracing.md#4-the-manual-fallback) |
| Nothing found, but you are sure it happened | Wrong environment, or a window that does not cover it. Widen `--lookback` before concluding anything |

---

## Trace a request on your own machine

Both services log to their own terminal, so the id ties the two streams together exactly as it does
in a cluster.

```bash
yarn install
yarn build:libs

# terminal 1
yarn dev:users-be

# terminal 2
yarn dev:products-be
```

```bash
# terminal 3
TOKEN=$(curl -s -X POST http://localhost:4001/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"alice@example.com"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["token"])')

curl -s "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" -H 'x-trace-id: LOCAL-DEMO-1' > /dev/null
```

Grep both terminals for `LOCAL-DEMO-1`. With `LOGGER_FORMAT=json` you get exactly what Loki would
store:

```txt
products-service  GET /v1/products    direction=request.in  caller=curl/8.7.1
products-service  ProductsService.findAll   Returning 3 product(s)
users-service     GET /v1/users/1     direction=request.in  caller=products-service
users-service     GET /v1/users/1     direction=response.out  statusCode=200  duration=1
users-service     GET /v1/users/2     direction=request.in  caller=products-service
users-service     GET /v1/users/2     direction=response.out  statusCode=200  duration=0
users-service     GET /v1/users/1     direction=request.in  caller=products-service
users-service     GET /v1/users/1     direction=response.out  statusCode=200  duration=0
products-service  GET /v1/products    direction=response.out  statusCode=200  duration=23
```

Three calls to users-service for three products — and `/v1/users/1` twice, because two products
share an owner. That is an N+1 the trace makes visible in one glance.

Things worth trying from here:

```bash
# A failure: the 404 carries the status on the response.out line
curl -s "http://localhost:4002/v1/products/999" -H "Authorization: Bearer $TOKEN" \
  -H 'x-trace-id: LOCAL-DEMO-FAIL' > /dev/null

# A guard rejection: no request pair, but the warning still carries the id
curl -s "http://localhost:4002/v1/products/1" -H 'x-trace-id: LOCAL-DEMO-401' > /dev/null

# Every outbound request and response, with credentials masked
LOGGER_LEVEL=verbose yarn dev:products-be
```

---

## Turning a trace into a bug report

Once you have the chain, the workspace is what makes it actionable: the trace names services, and
their source is already on disk. The [debug-and-report](../../.ai/skills/debug-and-report/SKILL.md)
skill runs that loop end to end — trace, read the implicated service's code, classify the finding as
code or infrastructure, and draft a ticket with the trace id and log evidence attached.

Always put the trace id in the ticket. It is the one thing that lets whoever picks it up next
reconstruct the whole picture without asking you anything.

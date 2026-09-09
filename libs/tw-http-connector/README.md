# @tw/http-connector

The outbound half of the tracing system. A `fetch`-based HTTP client for NestJS services that
carries the current request's trace id to the next service without being asked — and says who it is
while doing it, which is what turns correlated log lines into a call graph.

Depends on [@tw/tracing](../tw-tracing/README.md) for the header contract and
[@tw/logger](../tw-logger/README.md) for the trace-aware logging surface and masking helpers.

Full design rationale: [Distributed Tracing](../../docs/architecture/distributed-tracing.md).

---

## Setup

```bash
yarn add @tw/http-connector @tw/logger @tw/tracing
```

```ts
// app.module.ts
import { HttpConnectionModule, HC_LOGGER } from '@tw/http-connector';
import { LoggerModule, LoggerService } from '@tw/logger';

@Module({
  imports: [
    LoggerModule.forRoot(),
    HttpConnectionModule.forRoot({
      userAgent: process.env.DEPLOYMENT_NAME ?? 'orders-service',
      logger: { provide: HC_LOGGER, useExisting: LoggerService },
    }),
  ],
})
export class AppModule {}
```

> **`userAgent` must equal the name this service logs under.** It is what the receiving service
> records as `caller`, and `caller` is the only edge information a trace has — there are no parent
> span ids. When the two disagree, every call this service makes appears in traces as an orphaned
> root, and each individual log line still looks perfectly correct. It is the single easiest way to
> break tracing without noticing.

`forRoot()` therefore **throws** rather than registering a module that cannot identify itself:

```txt
HttpConnectionModule.forRoot() requires a non-empty `userAgent`, received undefined.
```

The type has always required it, which is not the same as it being enforced. The route in is
`userAgent: process.env.DEPLOYMENT_NAME` with no fallback, in a deployment that does not set the
variable: well-typed at compile time, `undefined` at runtime, and every call goes out as
`User-Agent: "undefined"` while the service boots and serves traffic normally. Keep the `??`
fallback, or set the variable — but the failure now happens at boot instead of in a trace nobody
reads for six months.

---

## Usage

```ts
constructor(private readonly http: RequestScopedHttpConnectionService) {}

async getOwner(ownerId: string): Promise<User> {
  return this.http.connect<User>({
    url: `${this.usersServiceUrl}/v1/users/${ownerId}`,
    method: 'GET',
  });
}
```

No trace id in sight. The connector reads it off the inbound request and attaches it, so the
receiving service's log lines land under the same id as this one's.

---

## The two connectors

| | `RequestScopedHttpConnectionService` | `HttpConnectionService` |
|---|---|---|
| Scope | one per request | one per process |
| Trace id | inherited from the inbound request | `params.traceId`, or an `x-trace-id` in `params.headers`. **Never ambient** |
| Forwards `forwardHeaders` | yes | no |
| Does the work | no — assembles headers, delegates | yes — fetch, retry, timeout, parsing, error mapping |
| Use in | request handlers | cron jobs, queue consumers, bootstrap |

The singleton refusing to read an ambient id is deliberate. A process-wide object that reaches for
request state is how a trace id ends up attached to the wrong request under concurrency.

**Outside a request, pass the id explicitly:**

```ts
const traceId = deriveTraceId(sessionTraceId, 'page', page);
await this.http.connect({ url, method: 'GET', traceId });
```

---

## What it does besides tracing

- **Retries** transport failures and 5xx with exponential backoff. 4xx is never retried — the
  upstream understood the request and rejected it, so repeating it only adds load.
- **Timeouts** via `AbortSignal.timeout`, defaulting to 15s and overridable per call. A transport
  failure surfaces as `504`, distinguishable from an upstream that answered `500`.
- **Error mapping**: a non-2xx response becomes an `HttpException` carrying the upstream status and
  parsed body, so a failing dependency surfaces as that dependency's status.
- **Call records**: a compact `request.out` / `response.in` pair at `info` on every call, carrying
  the method, the masked URL, the status and a client-observed `duration`. This is the caller's own
  statement that the call happened — the only record of it when the callee does not log.
- **Verbose logging** at `verbose` (`LOGGER_LEVEL=verbose`), adding a detailed pair with masked
  headers and bodies. Turn it off with `verboseLogs: false`; the `info` pair stays either way.

> **`verboseLogs` defaults to `true`, so raising `LOGGER_LEVEL` to `verbose` starts logging outbound
> request bodies.** Nothing else has to change for that to happen — the same coupling
> [`@tw/logger` documents](../tw-logger/README.md#configuration) for inbound requests, and the same
> caveat: masking covers credentials, not personal data. A service whose level is not fixed should
> set `verboseLogs: false` and opt in deliberately.
- **Header hygiene**: names are normalised to lowercase, and both contract headers — `user-agent`
  and `x-trace-id` — are written last with every other casing variant of themselves deleted first,
  so exactly one of each reaches the wire.

### The two contract headers

They are handled identically, and neither can be set through `headers`:

| | Value | Overridable per call |
|---|---|---|
| `user-agent` | the module's `userAgent` | `userAgent` — for a third-party API only. It breaks the trace edge for that call |
| `x-trace-id` | inherited from the inbound request | `traceId` — for cron ticks and fan-out under a derived id |

`{ 'User-Agent': …, 'user-agent': … }` deserves its own note, because it is the failure that hides
best: two distinct keys in a plain object, one header on the wire, where `fetch` **combines** them
into `orders-service, curl/8.4.0` rather than picking one. No receiver reads that as an identity,
and nothing before the wire would have shown it. The delete-then-write is what makes it impossible.

### Forwarded headers go to every destination

`forwardHeaders` is module-level, so a header on that list is attached to **every** call the
request-scoped connector makes — not only calls to our own services. With `authorization` on the
list, a call to a third-party API would carry the end user's bearer token unless the call site sets
its own.

In practice it does. **Every third-party call passes its own `Authorization`, and a caller-supplied
header always replaces the forwarded one** — caller headers are merged last, and they are
lowercased on the way in precisely so the override lands on the same key rather than becoming a
second `Authorization` beside it. So the leak needs a third-party call that forgot its own
credentials, which is not a thing that gets written by accident.

Two things keep the residual risk small, and both are worth knowing rather than assuming:

- **Tokens are short-lived.** A leaked one is a credential for the rest of its TTL, not indefinitely.
  It is still valid across the workspace during that window, so this bounds the damage rather than
  removing it.
- **Third-party traffic is reviewed on `test` before it ships.** What we send outside our own
  services is checked deliberately during development and testing, which is the stage this class of
  mistake is meant to be caught at — an unintended `Authorization` on an outbound call is visible in
  the verbose request log (`LOGGER_LEVEL=verbose`), with the value masked.

The rule that follows: **when you add a call to anything that is not ours, look at what the
connector will attach to it.** That check belongs in development and in test-environment review, not
in a runtime guard — a destination allowlist would have to track service URLs that differ per
environment, and its failure mode is worse than the one it prevents: a misconfigured origin drops
`authorization` silently and produces 401s that look like an auth bug, in production only.

`forwardHeaders` (default `['accept-language']`) copies chosen inbound headers onto outbound calls.
**Neither contract header may appear on that list, and `forRoot()` throws if one does.** Both have a
dedicated path, so forwarding one as well would put the inbound value — the browser's
`Mozilla/5.0…` — in the same header the connector writes its own into, and no reconfiguration of
header forwarding can silently switch tracing off.

---

## Scope

This connector covers the outbound path that tracing needs. It deliberately does **not** do OAuth
token acquisition and caching, request signing, or response schema validation. Those belong in a
layer above it, or in a dedicated client — folding them in here would put an auth provider's outage
on the same code path as an ordinary service-to-service call.

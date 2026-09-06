# @tw/http-connector

The outbound half of the tracing system. A `fetch`-based HTTP client for NestJS services that
carries the current request's trace id to the next service without being asked.

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
- **Verbose logging** at `silly` (`LOGGER_LEVEL=silly`) for every request and response, with
  credentials masked by `@tw/logger`.
- **Header hygiene**: names are normalised to lowercase and casing variants of the trace header are
  removed before the canonical one is set, so exactly one reaches the wire.

`forwardHeaders` (default `['accept-language']`) copies chosen inbound headers onto outbound calls.
**The trace id is deliberately not on that list** — it has its own dedicated path, so no
reconfiguration of header forwarding can silently switch tracing off.

---

## Scope

This connector covers the outbound path that tracing needs. It deliberately does **not** do OAuth
token acquisition and caching, request signing, or response schema validation. Those belong in a
layer above it, or in a dedicated client — folding them in here would put an auth provider's outage
on the same code path as an ordinary service-to-service call.

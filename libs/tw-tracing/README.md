# @tw/tracing

The Trace-Id contract. One header, one id format, one place that seeds it.

This package is deliberately small — around 120 lines of real code. Everything else in the tracing
story ([@tw/logger](../tw-logger/README.md) writes the id into log lines,
[@tw/http-connector](../tw-http-connector/README.md) forwards it to the next service) depends on
this package rather than on each other, so the header name and the id format are defined exactly
once for the whole workspace.

Full design rationale: [Distributed Tracing](../../docs/architecture/distributed-tracing.md).

---

## The contract

| | |
|---|---|
| Header | `x-trace-id` (lowercase on the wire, matched case-insensitively on read) |
| Value | Any non-empty string. A ULID at HTTP entry points; derived ids elsewhere |
| Log field | `traceId` |
| Response header | `x-trace-id` echoed back to the caller (on by default) |

**There is no format validation anywhere, and that is intentional.** A ULID is what
`newTraceId()` happens to mint; work with no inbound request builds its own id
(`deriveTraceId(sessionId, 'page', 3)`), and those ids are just as valid. Anything that rejects a
non-ULID refuses to trace real traffic.

---

## Install

```bash
yarn add @tw/tracing
```

Requires `@nestjs/common` and `@nestjs/core` (peer dependencies) for `TracingModule` and the
parameter decorator. The pure functions and the connect-style middleware import neither.

---

## Usage

### Seed the id — one line per service

```ts
// app.module.ts
import { TracingModule } from '@tw/tracing';

@Module({ imports: [TracingModule.forRoot()] })
export class AppModule {}
```

That is the whole of the generation half. It adopts an inbound `x-trace-id` when one is present and
mints a ULID when it is not, then writes it onto `req.headers` — the object every request-scoped
provider downstream reads.

Register it in **every** service, not only the ones at the edge. A service that cannot seed an id
logs nothing correlatable when something calls it directly, and direct calls — cron jobs, queue
consumers, an engineer with curl — are exactly the traffic nobody thinks about until it breaks.

### Why middleware, and not an interceptor

The seed runs as NestJS **middleware**, which is the only lifecycle stage that runs before both
guards and interceptors. Two things depend on that:

- `@tw/logger` registers its request-logging interceptor through `APP_INTERCEPTOR`, and NestJS
  pushes those onto the global interceptor list during `NestFactory.create()` — *before* anything
  added afterwards by `app.useGlobalInterceptors()`. A seed registered as a global interceptor
  therefore runs **second**, and the incoming/outgoing pair for a request that arrived without an id
  would be logged without one. That request is the first hop of every trace.
- **Guards run before interceptors at all.** A request rejected by an auth guard never reaches an
  interceptor, so an interceptor-based seed leaves every 401 and 403 untraceable.

`app.use(traceIdMiddleware())` in `main.ts` is the equivalent for a service that would rather wire
it explicitly.

### Read the id, when you actually need it

Rarely necessary. `@tw/logger` and `@tw/http-connector` inherit the id without being told, so a
handler that logs and calls other services never touches it. Reach for the decorator when the id has
to leave the request — persisted onto a record, embedded in a message payload, returned to a caller:

```ts
@Post()
create(@Body() dto: CreateOrderDto, @TraceId() traceId: string) {
  return this.orders.create(dto, traceId);
}
```

Outside a controller, `getTraceId(req)` does the same thing from any request-like object.

### Work with no inbound request

A cron tick, a queue consumer, a bootstrap task — there is no request, so there is no id to inherit.
Build one and thread it explicitly:

```ts
const sessionTraceId = newTraceId();

for (const page of pages) {
  const traceId = deriveTraceId(sessionTraceId, 'page', page);
  this.logger.info(`Processing page ${page}`, ctx, traceId);
  await this.connector.connect({ url, method: 'GET', traceId });
}
```

`deriveTraceId` appends rather than replaces, so a Loki filter on the session id returns the session
*and* every page — `|=` is a substring match. That property is the only reason the shape matters.

### Other stacks

`traceIdMiddleware()` is the same seeding step as connect-style middleware, with no NestJS import:

```ts
app.use(traceIdMiddleware());
```

Any runtime with an `(req, res, next)` pipeline — plain Express, a Fastify wrapper, a lambda shim —
adopts the identical wire format without adopting a framework, and its log lines join the same
traces as everyone else's.

---

## API

| Export | Purpose |
|---|---|
| `TRACE_ID_HEADER` | `'x-trace-id'` — the network contract |
| `TRACE_ID_FIELD` | `'traceId'` — the log-schema contract |
| `newTraceId()` | Mints a ULID |
| `deriveTraceId(parent, ...segments)` | Extends an id for fan-out work, keeping the parent greppable |
| `getTraceId(req)` | Case-insensitive read; `undefined` when absent |
| `ensureTraceId(req)` | Read-or-mint, writing the result back onto `req.headers` |
| `TracingModule.forRoot()` | NestJS module — the one-import seed |
| `traceIdMiddleware()` | The same seed, connect-style, framework-free |
| `TraceId` | NestJS controller parameter decorator |

---

## What this package deliberately does not do

- **No span ids, no parent ids, no span context.** One flat id per request. Caller → callee edges
  are reconstructed after the fact from request logs; see
  [the trade-offs](../../docs/architecture/distributed-tracing.md#the-honest-comparison-with-opentelemetry).
- **No `AsyncLocalStorage`.** The id travels through NestJS request-scoped DI and through explicit
  arguments, so there is no ambient context to lose track of — and no context that survives an async
  boundary either. Work deferred past the response must carry the id explicitly.
- **No sampling.** Every request is in the logs, because the logs were being written anyway.
- **No transport.** This package never talks to the network. It defines a header.

# @tw/logger

A NestJS logger that writes one JSON line per record to stdout, with the trace id on every one of
them — and the request/response log pair that turns those correlated lines into a call graph.

Depends on [@tw/tracing](../tw-tracing/README.md) for the header and field names. Paired with
[@tw/http-connector](../tw-http-connector/README.md), which carries the same id to the next service.

Full design rationale: [Distributed Tracing](../../docs/architecture/distributed-tracing.md).

---

## The record

```json
{"timestamp":"2026-09-05T10:14:22.318Z","level":"info","serviceName":"orders-service","podId":"b4799cf77-8t452","context":"OrdersService.getOrder","traceId":"01M0J6EYRY4TFEPR9PHJZ1QHPF","message":"Order not found"}
```

Field order is part of the contract and is asserted in the tests — raw lines get read by humans in
Grafana, and a stable shape is what makes them scannable. `traceId` is **omitted** when there is
none rather than set to `null`; a null field would match every untraced line in a substring search.

Transport is `process.stdout.write`. No logging framework, no transport, no buffer: nothing inside
the process can drop the line you needed, and there is nothing to flush before a crash.

---

## Setup

```bash
yarn add @tw/logger @tw/tracing
```

### 1. Import the modules

```ts
// app.module.ts
import { LoggerModule } from '@tw/logger';
import { TracingModule } from '@tw/tracing';

@Module({ imports: [TracingModule.forRoot(), LoggerModule.forRoot()] })
export class AppModule {}
```

`LoggerModule.forRoot()` also registers the request-logging interceptor, so a service cannot end up
logging without emitting the records a trace needs. `TracingModule` seeds the id that those records
carry.

### 2. Hand NestJS the logger

```ts
// main.ts
import { LoggerService, createLogger } from '@tw/logger';

const app = await NestFactory.create(AppModule, { logger: createLogger() });
app.useLogger(app.get(LoggerService));
```

`createLogger()` covers the window before the DI container exists — which is exactly when the
failures that stop a service from starting get logged.

### 3. Log

```ts
constructor(private readonly logger: RequestScopedLoggerService) {}

getOrder(id: string) {
  this.logger.info(`Order ${id} not found`, 'OrdersService.getOrder');
}
```

Two arguments. No trace id, no context object, no scope to open or close. The id is read off the
request the framework already gave the provider.

---

## The two loggers

| | `RequestScopedLoggerService` | `LoggerService` |
|---|---|---|
| Scope | one instance per request | one per process |
| Trace id | inherited automatically | passed as the trailing argument |
| Inject it in | request handlers — controllers, services they call | cron jobs, queue consumers, `onModuleInit`, bootstrap |

Injecting the request-scoped logger makes the injecting provider request-scoped too. That is how
the id reaches code three layers below a controller with nothing passing it along.

**Outside a request, use `LoggerService` and pass the id yourself:**

```ts
const sessionTraceId = newTraceId();

for (const page of pages) {
  const traceId = deriveTraceId(sessionTraceId, 'page', page);
  this.logger.info(`Syncing page ${page}`, 'SyncService.run', traceId);
}
```

There is no fallback id. A cron job that injects the request-scoped logger logs no `traceId` at all
and fails silently, by design — see the notes on `@Optional()` in
[`request-scoped-logger.service.ts`](./src/request-scoped-logger.service.ts).

---

## Request logging

`LoggerModule.forRoot()` registers an interceptor that emits one pair per request:

```json
{"direction":"request.in","method":"GET","path":"/v1/users/1","caller":"products-service"}
{"direction":"response.out","method":"GET","path":"/v1/users/1","statusCode":200,"duration":124}
```

This pair, not the trace id, is what makes a chain reconstructable. The id groups lines; these two
records supply the edges, the status codes and the timings.

| `direction` | Written by | Means |
|---|---|---|
| `request.in` | the request-logging interceptor | a request arrived at this service |
| `response.out` | the request-logging interceptor | this service answered it |
| `request.out` | `@tw/http-connector` | this service called someone else |
| `response.in` | `@tw/http-connector` | that call came back |

**The noun comes first because the direction alone is ambiguous.** A response this service sends and
a request this service makes are both, in plain English, "outgoing" — which is what the earlier
`incoming`/`outgoing` pair meant to readers, and it was not what they meant in the code. Both of
those described the *server* side of one request.

`incoming` and `outgoing` were the previous spellings of the first two. The trace tooling still
reads them, so lines written before the rename stay searchable for their whole retention.

- **`caller` is the forwarded `user-agent`** — the only edge information that exists, since there
  are no parent span ids. A service whose `User-Agent` disagrees with the name it logs under shows
  up as an orphaned root in every trace it takes part in. Keep them equal.
- **`duration` is measured in-process**, so it is immune to clock skew between pods, and it is not
  network time.
- **Failed requests are logged too**, with the status read off the exception — `res.statusCode` is
  still the framework default when the interceptor sees the error.
- The payload is a JSON document nested inside `message`, so consumers parse twice. That keeps the
  outer envelope one fixed shape for every line in the system.

| `LOGGER_REQUEST_LOGGING` | What is logged |
|---|---|
| `compact` (default) | `info`: direction, method, path, caller, status, duration |
| `full` | `verbose`: the above plus masked headers and bodies |
| `off` | nothing — traces lose their edges and durations |

The default is deliberate: tracing has to work in every environment with no configuration, because a
service that must be reconfigured before it can be traced will not be traced on the day it breaks.

---

## Configuration

All from the environment; read once at construction.

| Variable | Default | Notes |
|---|---|---|
| `DEPLOYMENT_NAME` | `package.json` name | **Must equal the container name.** Traces attribute by it |
| `POD_NAME` | — | Kubernetes downward API. The service prefix is stripped |
| `LOGGER_LEVEL` | `info` | `error`, `warn`, `info`, `debug`, `verbose` (`silly` is a deprecated alias for `verbose`) |
| `LOGGER_FORMAT` | `json` | `pretty` for local development only — pretty output is not parseable |
| `LOGGER_REQUEST_LOGGING` | follows level | `off`, `compact`, `full` |

```yaml
# Kubernetes: POD_NAME comes from the downward API
env:
  - name: DEPLOYMENT_NAME
    value: orders-service
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
```

---

## Masking

Credential-bearing headers and body fields are partially masked (`Bearer ab**...**kl`) rather than
removed, so two masked values can still be compared — that is how you tell "the same expired token
on every retry" from "a new token each time".

**Masking covers credentials, not personal data.** A logged request body still contains whatever the
caller sent. Treat trace output as production data.

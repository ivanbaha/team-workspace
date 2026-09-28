# Backend

All server-side services. Each service is a standalone NestJS application with its own API surface
and deployment lifecycle.

---

## Services

- [users-service](./users-service/README.md) — REST API managing user accounts, authentication
  tokens, and profile data. Port 4001
- [products-service](./products-service/README.md) — REST API managing product catalogue, inventory,
  and pricing. Port 4002. Calls users-service to resolve product owners
- [products-sync-service](./products-sync-service/README.md) — background worker recomputing
  per-category aggregates through the shared cache's work queue. Port 4003

The exact service name matters: `DEPLOYMENT_NAME`, the container name, the `serviceName` in every
log line, and the outbound `User-Agent` are all the same string. Use the names above verbatim when
querying logs.

---

## Conventions

- HTTP framework: NestJS on the Express platform
- All services expose a health endpoint at `GET /health`, excluded from request logging
- All routes are versioned under `/v1` and authenticated by a global JWT guard, opted out per-route
  with `@Public()`
- All responses use the `{ data, error }` envelope — see
  [docs/architecture/api-contracts.md](../docs/architecture/api-contracts.md)
- Environment variables are documented in each service's `.env.example`

---

## Distributed tracing

Every service carries an `x-trace-id` through the request and logs it on every line, so one query
returns the full chain of a request across all of them.

Adoption is two imports in `app.module.ts` — plus one more for services that make outbound calls:

```ts
imports: [
  TracingModule.forRoot(),   // seeds x-trace-id in middleware, before guards and interceptors
  LoggerModule.forRoot(),    // puts it on every log line + emits the request/response pair
  HttpConnectionModule.forRoot({ userAgent: SERVICE_NAME, logger: { ... } }),  // carries it onward
]
```

After that, no application code mentions a trace id.

- **How it works and why:** [Distributed Tracing](../docs/architecture/distributed-tracing.md)
- **How to use it when something breaks:** [Tracing a Request](../docs/guides/tracing-a-request.md)
- **The libraries:** [@tw/tracing](../libs/tw-tracing/README.md),
  [@tw/logger](../libs/tw-logger/README.md), [@tw/http-connector](../libs/tw-http-connector/README.md)

---

## Shared cache

Every service above talks to one shared cache server, in one of three roles — and a service can
hold more than one: **owner** (the only writer of its entities — users-service for users,
products-service for products, product lists and the catalog composite), **consumer** (reads
another owner's entries directly — products-service reads users), **operator** (runs the work
queue and the batch lock, products-sync-service).
Adoption is one import:

```ts
imports: [
  CacheModule.forRoot({
    url: process.env.CACHE_URL,                       // unset → in-process store, nothing shared
    ttlSeconds: Number(process.env.CACHE_TTL ?? 60),  // seconds; the only TTL unit
    logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
  }),
]
```

After that, no service decides its own failure policy — the library's is the contract: reads fail
open when the cache is broken, queue writes fail closed, invalid arguments throw.

- **How it works and why:** [Shared Cache](../docs/architecture/shared-cache.md)
- **How to use it when something breaks:**
  [Debugging the Cache](../docs/guides/debugging-the-cache.md)
- **The library:** [@tw/cache](../libs/tw-cache/README.md)

---

## Development

```bash
# From workspace root
yarn install
yarn build:libs       # the shared libs are TypeScript; services consume their dist/
yarn dev:users-be
yarn dev:products-be
yarn dev:sync
```

Run the first two to exercise the cross-service call:

```bash
curl "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" -H 'x-trace-id: LOCAL-DEMO-1'
```

Then grep both terminals for `LOCAL-DEMO-1`.

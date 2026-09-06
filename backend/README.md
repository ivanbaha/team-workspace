# Backend

All server-side services. Each service is a standalone NestJS application with its own API surface
and deployment lifecycle.

---

## Services

- [users-service](./users-service/README.md) — REST API managing user accounts, authentication
  tokens, and profile data. Port 4001
- [products-service](./products-service/README.md) — REST API managing product catalogue, inventory,
  and pricing. Port 4002. Calls users-service to resolve product owners

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

## Development

```bash
# From workspace root
yarn install
yarn build:libs       # the tracing libs are TypeScript; services consume their dist/
yarn dev:users-be
yarn dev:products-be
```

Run both to exercise the cross-service call:

```bash
curl "http://localhost:4002/v1/products?expandOwner=true" \
  -H "Authorization: Bearer $TOKEN" -H 'x-trace-id: LOCAL-DEMO-1'
```

Then grep both terminals for `LOCAL-DEMO-1`.

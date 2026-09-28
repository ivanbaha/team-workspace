# users-service

REST API for the Users domain. Manages user accounts, authentication tokens, and profile data.

---

## Endpoints

| Method | Path                | Auth | Description                    |
| ------ | ------------------- | ---- | ------------------------------ |
| GET    | /health             | —    | Health check, incl. cache state |
| POST   | /v1/auth/register   | —    | Register a new user            |
| POST   | /v1/auth/login      | —    | Authenticate and receive a JWT |
| GET    | /v1/users/:id       | JWT  | Get user profile by ID          |
| PUT    | /v1/users/:id       | JWT  | Update user profile             |
| DELETE | /v1/users/:id       | JWT  | Delete user account             |

`GET /v1/users/:id` honours the caller's `Cache-Control`: `no-cache` skips the cached copy,
fetches from the store, and overwrites the entry (bypass **and** refresh — the header is a repair
tool, so the repair sticks). Writes never read the header: a write always invalidates.

Full API contract: [docs/architecture/api-contracts.md](../../docs/architecture/api-contracts.md)

---

## Tech Stack

- Node.js + NestJS (Express platform)
- JSON Web Tokens (JWT) for authentication, verified by a global guard
- [@tw/tracing](../../libs/tw-tracing/README.md) + [@tw/logger](../../libs/tw-logger/README.md) for
  distributed tracing
- [@tw/cache](../../libs/tw-cache/README.md) — this service **owns** the `user` cache entries
- In-memory store (demo; swap for a real DB in production)

This service is a **leaf**: it calls no other service, so it does not depend on
`@tw/http-connector`. It still seeds a trace id for every request, because requests reach it
directly — from a cron job, a health prober, or an engineer with curl — and those are the calls
nobody thinks to trace until they are the ones failing.

---

## Source Structure

```txt
src/
  main.ts                    — Entry point; bootstrap logger, validation pipe
  app.module.ts              — TracingModule + LoggerModule, global guard/filter/interceptor
  health.controller.ts       — GET /health (excluded from request logging)
  auth/                      — /v1/auth routes: register, login
  users/                     — /v1/users routes
  common/
    guards/jwt-auth.guard.ts             — Global JWT verification, opt out with @Public()
    filters/all-exceptions.filter.ts     — { data, error } envelope; logs failures with the trace id
    interceptors/response-envelope.interceptor.ts
    decorators/public.decorator.ts
  data/users.store.ts        — In-memory users store (demo)
```

---

## Tracing

Two imports in `app.module.ts` are the whole adoption:

```ts
imports: [TracingModule.forRoot(), LoggerModule.forRoot(), ...]
```

After that no application code mentions a trace id. Services inject
`RequestScopedLoggerService` and log with two arguments; the id is read off the request.

```bash
curl -i http://localhost:4001/health
# x-trace-id: 01M1S2G1KH29B6406YZARSK831   ← echoed back, paste it into Grafana
```

How it works and why: [Distributed Tracing](../../docs/architecture/distributed-tracing.md).
How to use it when something breaks: [Tracing a Request](../../docs/guides/tracing-a-request.md).

---

## Shared cache: the owner role

This is the service other services cache *about*: it owns the `user` entries in the shared cache
(keys `users-service_user_<id>`, built only by `cacheKey('user', id)`).

- **Reads go through `ReadThroughService`** — cache-aside, single-flight, negative caching — so
  the second request for the same user costs no lookup, and concurrent cold requests cost one.
- **Every write invalidates**, in `setImmediate`, never gated on any header. The `del` count is
  logged at debug on every invalidation: a count of zero is the only visible symptom of an
  invalidation built against a key no read ever used.
- **Consumers read these keys directly** (products-service does) and never write them; the cache
  server's ACL denies it even if a bug tries.

```bash
curl -s http://localhost:4001/health
# { "status": "ok", "service": "users-service",
#   "cache": { "store": "memory", "disabled": false, "hits": 4, "misses": 2, "skipped": 0 } }
```

`store: "memory"` locally means the in-process fallback (nothing shared — the boot log says so);
in the cluster it is `"redis"`. `skipped` apart from `misses` is how a health check tells a cold
cache from a dead one.

The design and its failure policy: [Shared Cache](../../docs/architecture/shared-cache.md).
When an entry looks stale or a consumer misses forever:
[Debugging the Cache](../../docs/guides/debugging-the-cache.md).

---

## Development

```bash
yarn install       # from the workspace root
yarn dev:users-be  # starts on port 4001 with nodemon + ts-node
```

Copy `.env.example` to `.env` for local overrides.

| Variable                 | Default         | Description                                          |
| ------------------------ | --------------- | ---------------------------------------------------- |
| PORT                     | 4001            | HTTP port                                            |
| JWT_SECRET               | changeme        | Secret for signing JWTs                              |
| DEPLOYMENT_NAME          | `package.json` name | Name logged as `serviceName`. **Must equal the container name** |
| POD_NAME                 | —               | From the Kubernetes downward API                     |
| LOGGER_LEVEL             | info            | `error`…`verbose`. `verbose` also logs masked request bodies                                      |
| LOGGER_FORMAT            | json            | `pretty` for local terminals only                    |
| LOGGER_REQUEST_LOGGING   | follows level   | `off`, `compact`, `full`                             |
| CACHE_URL                | unset           | Shared cache server, `redis://…`. Unset → in-process store (nothing shared) |
| CACHE_TTL                | 60              | Entry TTL in seconds — the only TTL unit             |

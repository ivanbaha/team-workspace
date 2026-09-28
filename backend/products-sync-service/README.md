# products-sync-service

Background worker for the Products domain. Recomputes per-category aggregates (count, stock, mean
price) through the shared cache's work queue, and serves the stats it produces.

---

## Endpoints

| Method | Path                      | Auth | Description                                             |
| ------ | ------------------------- | ---- | ------------------------------------------------------- |
| GET    | /health                   | —    | Health check, incl. cache state                         |
| GET    | /v1/category-stats/:id    | JWT  | A category's aggregate, read through the cache          |
| POST   | /v1/recalculations        | JWT  | Enqueue categories for recomputation → `202`            |

`POST /v1/recalculations` takes `{ "categoryIds": ["widgets", "gadgets"] }` and answers
`{ "queued": 2, "scheduled": true }` — `queued` counts only newly added ids (duplicates and
already-pending ids collapse in the set), `scheduled` says whether this call armed the batch
drain (`false` = one was already armed, or the cache was unreachable and the caller should retry).

Full API contract: [docs/architecture/api-contracts.md](../../docs/architecture/api-contracts.md)

---

## Tech Stack

- Node.js + NestJS (Express platform)
- JWT verification via a global guard (tokens issued by users-service)
- [@tw/tracing](../../libs/tw-tracing/README.md), [@tw/logger](../../libs/tw-logger/README.md),
  [@tw/http-connector](../../libs/tw-http-connector/README.md)
- [@tw/cache](../../libs/tw-cache/README.md) — this service is the cache **operator**: it owns the
  `categoryStats` entries and runs the work queue

---

## Source Structure

```txt
src/
  main.ts                    — Entry point; bootstrap logger, validation pipe
  app.module.ts              — TracingModule + LoggerModule + HttpConnectionModule + CacheModule
  health.controller.ts       — GET /health (excluded from request logging)
  recalculations/            — POST /v1/recalculations: the work queue and the batch drain
    cache-keys.ts            — The queue and lock keys (prefix from the shared registry)
    dto/request-recalculation.dto.ts
  stats/                     — GET /v1/category-stats: the on-demand owner read
    category-stats.ts        — The aggregate + the pure computation behind it
  connectors/
    products.connector.ts    — Calls products-service; request-scoped (in-request use only)
  common/                    — Guard, exception filter, response envelope, @Public()
```

---

## The work queue, the lock, and the two-connector pattern

The queue is a Redis **Set** on the shared cache: `SADD` enqueues (duplicates collapse for free),
`SPOP` drains atomically — two drains can never hand out the same category. The set is the durable
half of the queue: it survives a crash of this service, and `onApplicationBootstrap` counts what it
finds and schedules a drain, so work accepted seconds before a crash is finished after the restart.

The batch lock is `SET NX EX`. It stops N accepted requests from scheduling N drains of one queue,
and its TTL is the release — there is no unlock call, because a process that died between acquiring
and draining must not block scheduling forever. Both fail **closed** on a cache outage: the POST
answers `503 CACHE_UNAVAILABLE` and says that nothing was enqueued, rather than accepting work that
was never stored. Reads fail open; writes never lie.

The drain runs **outside request scope**, which is where the two-connector pattern splits:

- `RecalculationsService` takes the **singleton** `HttpConnectionService` and supplies trace ids by
  hand — `newTraceId()` per drain, `deriveTraceId(runId, 'category', id)` per category — so a batch
  reads in the logs as one trace family instead of N unrelated roots.
- `ProductsConnector` takes the **request-scoped** connector and inherits the caller's trace id,
  because the on-demand stats read runs inside a request.

See the [@tw/http-connector README](../../libs/tw-http-connector/README.md) for the full split.

The drain invalidates first — `delMany` of every stats key in the batch, one round trip, before any
network call — then recomputes each category from freshly fetched products. A reader arriving in
the gap gets a miss and loads on demand; it can never be served a stale aggregate that the queue
has already promised to replace. The fetches send `Cache-Control: no-cache`: products-service
caches its lists now, and a recomputation must read the products *now* — a machine caller
demanding freshness uses the same contract a human one does.

The drain also calls products-service **as itself, not on a user's behalf**: `serviceToken()` mints
a short-lived JWT (`sub: products-sync-service`, `type: service`, 5 minutes) signed with the shared
secret, once per run. A background job has no inbound request, so there is no caller's bearer token
to forward — and without its own credential, every batch call dies at the receiving guard: the
classic "works from curl, dead in the cron" failure.

Locally, with no `CACHE_URL`, the queue and lock run on the in-process store: everything works, but
the queue is single-process and nothing is shared. Start a real cache server to see the set behave
like a queue across restarts — the [debugging guide](../../docs/guides/debugging-the-cache.md)
shows how, in one command.

The design and its failure policy: [Shared Cache](../../docs/architecture/shared-cache.md).

---

## Development

```bash
yarn install          # from the workspace root
yarn dev:sync         # starts on port 4003 with nodemon + ts-node
```

The stats endpoint calls products-service (`yarn dev:products-be`); a JWT from users-service
(`yarn dev:users-be`) is needed for anything but `/health`.

```bash
# enqueue two categories, watch the batch drain in the logs
curl -X POST localhost:4003/v1/recalculations \
  -H 'authorization: Bearer <token>' -H 'content-type: application/json' \
  -d '{"categoryIds": ["widgets", "gadgets"]}'
```

| Variable               | Default               | Description                                       |
| ---------------------- | --------------------- | ------------------------------------------------- |
| PORT                   | 4003                  | HTTP port                                         |
| JWT_SECRET             | changeme              | Same secret as users-service                      |
| PRODUCTS_SERVICE_URL   | http://localhost:4002 | Upstream products-service                         |
| DEPLOYMENT_NAME        | `package.json` name   | `serviceName` **and** outbound `User-Agent`       |
| POD_NAME               | —                     | From the Kubernetes downward API                  |
| LOGGER_LEVEL           | info                  | `verbose` adds masked headers and bodies to the request/response records |
| LOGGER_FORMAT          | json                  | `pretty` for local terminals only                 |
| LOGGER_REQUEST_LOGGING | follows level         | `off`, `compact`, `full`                          |
| CACHE_URL              | unset                 | Shared cache server, `redis://…`. Read-write user scoped to this service's prefix |
| CACHE_TTL              | 300                   | Stats entry TTL in seconds — the only TTL unit    |
| BATCH_DELAY_SECONDS    | 5                     | Delay before the batch drain runs                 |
| LOCK_TTL_SECONDS       | 10                    | Scheduling-lock TTL; should cover the delay window |
| BATCH_SIZE             | 100                   | Category ids per pop of the queue set             |
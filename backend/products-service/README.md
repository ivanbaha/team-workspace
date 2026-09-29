# products-service

REST API for the Products domain. Manages product catalogue, inventory levels, and pricing.

---

## Endpoints

| Method | Path              | Auth | Description                                          |
| ------ | ----------------- | ---- | ---------------------------------------------------- |
| GET    | /health           | —    | Health check, incl. cache state                      |
| GET    | /v1/products      | JWT  | List products (`?search=`, `?category=`, `?expandOwner=`) |
| GET    | /v1/products/:id  | JWT  | Get product by ID (`?expandOwner=`)                  |
| POST   | /v1/products      | JWT  | Create a new product                                 |
| PUT    | /v1/products/:id  | JWT  | Update a product                                     |
| DELETE | /v1/products/:id  | JWT  | Delete a product                                     |

`?expandOwner=true` resolves each product's owner from **users-service**. That is the hop that makes
a trace distributed — see below.

Full API contract: [docs/architecture/api-contracts.md](../../docs/architecture/api-contracts.md)

---

## Tech Stack

- Node.js + NestJS (Express platform)
- JWT verification via a global guard (tokens issued by users-service)
- [@tw/tracing](../../libs/tw-tracing/README.md), [@tw/logger](../../libs/tw-logger/README.md),
  [@tw/http-connector](../../libs/tw-http-connector/README.md)
- [@tw/cache](../../libs/tw-cache/README.md) — this service is a cache **owner** (products, product
  lists, the catalog composite) and a **consumer** (user entries owned by users-service)
- In-memory store (demo; swap for a real DB in production)

---

## Source Structure

```txt
src/
  main.ts                    — Entry point; bootstrap logger, validation pipe
  app.module.ts              — TracingModule + LoggerModule + HttpConnectionModule
  health.controller.ts       — GET /health (excluded from request logging)
  products/                  — /v1/products routes
  connectors/
    users.connector.ts       — Calls users-service; propagates the trace id automatically
  common/                    — Guard, exception filter, response envelope, @Public()
  data/products.store.ts     — In-memory products store (demo)
```

---

## Tracing across the hop

`UsersConnector` injects `RequestScopedHttpConnectionService` and calls users-service. There is no
trace id in that file — the connector reads it off the inbound request and attaches `x-trace-id` to
the outbound call, so both services log under the same id:

```txt
products-service  GET /v1/products     direction=request.in  caller=curl/8.7.1
products-service  ProductsService.findAll   Returning 3 product(s)
users-service     GET /v1/users/1      direction=request.in  caller=products-service
users-service     GET /v1/users/1      direction=response.out  statusCode=200  duration=1
users-service     GET /v1/users/2      direction=request.in  caller=products-service
users-service     GET /v1/users/2      direction=response.out  statusCode=200  duration=0
products-service  GET /v1/products     direction=response.out  statusCode=200  duration=23
```

`caller=products-service` is what creates the edge, and it comes from the `User-Agent` the connector
sends. **`userAgent` in `HttpConnectionModule.forRoot()` must equal `DEPLOYMENT_NAME`** — both read
the same variable in `app.module.ts` precisely so they cannot drift.

The caller's bearer token is forwarded to users-service (`forwardHeaders`), which verifies it
itself. Only headers named there are forwarded; everything else on the inbound request stays put.

Reproduce it locally: [Tracing a Request](../../docs/guides/tracing-a-request.md#trace-a-request-on-your-own-machine).

---

## Shared cache: the owner and consumer roles

This service plays both parts of the design. As a **consumer**, `?expandOwner=true` resolves owners
through the shared cache first, HTTP second:

1. `UsersConnector` reads the owner's entry (`users-service_user_<id>`) **directly** from the cache.
   A hit costs one cache round trip instead of one HTTP hop — no trace fan-out, no call to
   users-service — and honours the owner's negative entries ("this user does not exist") too.
2. On a miss, the connector calls users-service; the owner's read-through fills the entry as a
   side effect, so the next consumer read is a hit. An owner id that cannot form a key (it came
   from a request body, after all) skips the cache read and goes straight to users-service,
   URL-encoded — it never fails the catalog.
3. This service **never writes** the owner's keys — only the owner knows what a fresh value is.
   The cache server's ACL enforces it: this service's user may write only its own prefix, and it
   may read only the owner's `user` entries.

As an **owner**, it caches its own data at three rungs of the ladder:

| Read shape | Key | Invalidation |
| --- | --- | --- |
| `GET /v1/products/:id` | `products-service_product_<id>` | the item's key, on every write to it — including a negative entry the day its id is created |
| `GET /v1/products`, `?category=` | `products-service_productList_all` / `_category.<name>` | **every** write to **any** product kills **every** list shape — one `delMany`, deliberately blunt |
| `GET /v1/products?expandOwner=true` (no filters) | `products-service_req_v1-products_expandowner=true` | this service's writes kill it like any local shape (it can name the key); the TTL bounds the *owner entries users-service contributed* — the half no product write can reach |
| `GET /v1/products?search=…` | — | never cached: free text cannot form a key space anyone can enumerate |

Every key is built from exactly the value the loader filters on. An id or category that is not
already canonical — ` 1`, `Widgets`, `Home & Garden` — cannot form a key, so that request is
served from the store, uncached, and can never write the entry of the value it resembles. The
`category.` prefix does the same for the synthetic shape: `?category=all` is its own shape, not a
way to overwrite the unfiltered list. Writes never fail because of a key: invalidation is built
after the response, and a shape that cannot form a key has no entry to delete.

The blunt list rule is the point, not a shortcut: the membership-vs-content split of "smarter"
list caching buys one store read per write window and costs invalidation branches that can be
gotten wrong. `[]` is a valid cached value — "no products in this category" is a fact, unlike
"this product does not exist", which the next write can change.

A caller sending `Cache-Control: no-cache` bypasses whichever rung served the request and
refreshes it — on the composite, the owner lookups it is built from as well — and the connector
forwards the header to users-service, which does the bypass-and-refresh on its side. The demand
is the caller's; it survives every hop. Who may send it is an edge decision: see
[API Contracts](../../docs/architecture/api-contracts.md).

Locally, with no `CACHE_URL`, both services run in-process stores and step 1 never hits —
start a real cache server to see the sharing (the
[debugging guide](../../docs/guides/debugging-the-cache.md) shows how, in one command).

The design and its failure policy: [Shared Cache](../../docs/architecture/shared-cache.md).

---

## Development

```bash
yarn install          # from the workspace root
yarn dev:products-be  # starts on port 4002 with nodemon + ts-node
```

`?expandOwner=true` needs users-service running as well (`yarn dev:users-be`).

| Variable               | Default               | Description                                       |
| ---------------------- | --------------------- | ------------------------------------------------- |
| PORT                   | 4002                  | HTTP port                                         |
| JWT_SECRET             | changeme              | Same secret as users-service                      |
| USERS_SERVICE_URL      | http://localhost:4001 | Upstream users-service                            |
| DEPLOYMENT_NAME        | `package.json` name   | `serviceName` **and** outbound `User-Agent`       |
| POD_NAME               | —                     | From the Kubernetes downward API                  |
| LOGGER_LEVEL           | info                  | `verbose` adds masked headers and bodies to the request/response records |
| LOGGER_FORMAT          | json                  | `pretty` for local terminals only                 |
| LOGGER_REQUEST_LOGGING | follows level         | `off`, `compact`, `full`                          |
| CACHE_URL              | unset                 | Shared cache server, `redis://…`. Read-write user scoped to this service's prefix in the cluster |
| CACHE_TTL              | 60                    | Entity and list entry TTL in seconds — the only TTL unit |
| REQUEST_CACHE_TTL      | 10                    | Composite request cache TTL in seconds — bounds the part local writes cannot invalidate; checked at boot |

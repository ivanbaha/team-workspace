# API Contracts

Shared conventions for all REST APIs in this workspace.

---

## Base URL

Each service is accessible at its own base URL:

| Service | Local URL |
| ----------------------- | --------------------- |
| users-service | <http://localhost:4001> |
| products-service | <http://localhost:4002> |
| products-sync-service | <http://localhost:4003> |

---

## Versioning

APIs are versioned via URL path prefix:

```txt
/v1/users
/v1/products
/v1/category-stats
/v1/recalculations
```

The current version is `v1`. Breaking changes require a new version prefix.

---

## Authentication

All endpoints except `/health`, `/auth/register`, and `/auth/login` require a valid JWT.

Include the token in the request header:

```txt
Authorization: Bearer <token>
```

Tokens are issued by `users-service` and are valid across all services. Background work
authenticates differently: `products-sync-service` mints its own short-lived service token
(`type: service`) for the batch calls it makes outside any request, because there is no caller's
token to forward at that point.

---

## Tracing

Every request carries a trace id, and every service logs it. This is part of the
API contract, not an implementation detail — anything calling these services is
expected to forward the header it received.

| | |
| --- | --- |
| Request header | `x-trace-id` — forwarded if present, minted by the receiving service if not |
| Response header | `x-trace-id` — always echoed back, including on errors |
| Format | Any non-empty string. A ULID by convention; **never validated** |

```txt
x-trace-id: 01M0J6EYRY4TFEPR9PHJZ1QHPF
```

A client may supply its own id — the fastest way to trace a request you are about
to make. Because the id is echoed on the response, the id of a request that
failed is always recoverable from the browser's network tab.

See [Distributed Tracing](./distributed-tracing.md) for the design, and
[Tracing a Request](../guides/tracing-a-request.md) for how to use it.

---

## Freshness

Read endpoints backed by the shared cache honour a freshness demand:

```txt
Cache-Control: no-cache
```

`no-cache` (and `no-store`) mean **bypass and refresh**: the service skips its cached copy,
loads from the source of truth, and overwrites the cache entry — so the demand repairs the
entry for every *following* reader, not just the caller who asked. A bypass that left the stale
entry in place would re-serve it to the very next reader, and the person who sent the header
would conclude it does nothing.

The demand is the caller's, so it travels: the connector forwards `cache-control` by default,
and it survives every hop. Writes never read the header — invalidation after a write is
unconditional, not something a caller opts into.

Which read answers from a cache is part of each service's contract, stated in its README:
bounded shapes are cached and invalidated by their owner; a composite answer (e.g.
`GET /v1/products?expandOwner=true` without filters) is refreshed by its own service's writes
and TTL-bounded for the parts contributed by other owners — `no-cache` refreshes it like
anything else. Free-text queries (`?search=`) are **never cached**: free text cannot form a key
anyone can enumerate, and therefore cannot be invalidated.

See [Shared Cache](./shared-cache.md) for the design, and
[Debugging the Cache](../guides/debugging-the-cache.md) for the repair procedure.

---

## Response Format

All responses follow this envelope:

```json
{
  "data": { ... },
  "error": null
}
```

On error:

```json
{
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found"
  }
}
```

---

## HTTP Status Codes

| Code | Meaning                        |
| ---- | ------------------------------ |
| 200  | Success                        |
| 201  | Created                        |
| 202  | Accepted — the work is queued; the response says what was queued, not what is done |
| 400  | Bad request / validation error |
| 401  | Unauthenticated                |
| 403  | Forbidden                      |
| 404  | Not found                      |
| 500  | Internal server error          |
| 503  | `CACHE_UNAVAILABLE` — the queue behind this endpoint refuses work while the shared cache is down; nothing was accepted, retry |

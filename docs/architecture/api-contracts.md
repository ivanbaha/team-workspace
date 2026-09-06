# API Contracts

Shared conventions for all REST APIs in this workspace.

---

## Base URL

Each service is accessible at its own base URL:

| Service          | Local URL             |
| ---------------- | --------------------- |
| users-service    | <http://localhost:4001> |
| products-service | <http://localhost:4002> |

---

## Versioning

APIs are versioned via URL path prefix:

```txt
/v1/users
/v1/products
```

The current version is `v1`. Breaking changes require a new version prefix.

---

## Authentication

All endpoints except `/health`, `/auth/register`, and `/auth/login` require a valid JWT.

Include the token in the request header:

```txt
Authorization: Bearer <token>
```

Tokens are issued by `users-service` and are valid across all services.

---

## Tracing

Every request carries a trace id, and every service logs it. This is part of the
API contract, not an implementation detail — anything calling these services is
expected to forward the header it received.

| | |
|---|---|
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
| 400  | Bad request / validation error |
| 401  | Unauthenticated                |
| 403  | Forbidden                      |
| 404  | Not found                      |
| 500  | Internal server error          |

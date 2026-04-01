# API Contracts

Shared conventions for all REST APIs in this workspace.

---

## Base URL

Each service is accessible at its own base URL:

| Service          | Local URL             |
| ---------------- | --------------------- |
| users-service    | http://localhost:4001 |
| products-service | http://localhost:4002 |

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

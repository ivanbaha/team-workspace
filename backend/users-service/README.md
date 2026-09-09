# users-service

REST API for the Users domain. Manages user accounts, authentication tokens, and profile data.

---

## Endpoints

| Method | Path                | Auth | Description                    |
| ------ | ------------------- | ---- | ------------------------------ |
| GET    | /health             | —    | Health check                   |
| POST   | /v1/auth/register   | —    | Register a new user            |
| POST   | /v1/auth/login      | —    | Authenticate and receive a JWT |
| GET    | /v1/users/:id       | JWT  | Get user profile by ID         |
| PUT    | /v1/users/:id       | JWT  | Update user profile            |
| DELETE | /v1/users/:id       | JWT  | Delete user account            |

Full API contract: [docs/architecture/api-contracts.md](../../docs/architecture/api-contracts.md)

---

## Tech Stack

- Node.js + NestJS (Express platform)
- JSON Web Tokens (JWT) for authentication, verified by a global guard
- [@tw/tracing](../../libs/tw-tracing/README.md) + [@tw/logger](../../libs/tw-logger/README.md) for
  distributed tracing
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
| LOGGER_LEVEL             | info            | `error`…`verbose`                                      |
| LOGGER_FORMAT            | json            | `pretty` for local terminals only                    |
| LOGGER_REQUEST_LOGGING   | follows level   | `off`, `compact`, `full`                             |

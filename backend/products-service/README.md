# products-service

REST API for the Products domain. Manages product catalogue, inventory levels, and pricing.

---

## Endpoints

| Method | Path              | Auth | Description                                          |
| ------ | ----------------- | ---- | ---------------------------------------------------- |
| GET    | /health           | —    | Health check                                         |
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

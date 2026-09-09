# Architecture

High-level overview of the system architecture.

---

## System Boundaries

```
Browser
  |
  v
host-frontend (port 3000)
  |-- loads --> users-frontend (port 3001) via Module Federation
  |-- loads --> products-frontend (port 3002) via Module Federation
  |
  +-- calls --> users-service (port 4001) — REST API (NestJS)
  +-- calls --> products-service (port 4002) — REST API (NestJS)
                     |
                     +-- calls --> users-service  (resolve product owners)
```

Every arrow above carries the same `x-trace-id` header — see
[Observability](#observability).

**In this repository the frontend arrows do not fire.** The demo frontends are scaffolds that make
no API calls, so a trace you produce here starts at the first backend service. Production mints the
id in a browser `fetch` interceptor; the delta is listed in
[What this repository does and does not demonstrate](./distributed-tracing.md#what-this-repository-does-and-does-not-demonstrate).

---

## Microfrontend Integration

The host app acts as the shell. It provides:

- The application layout (header, sidebar)
- A shared Redux store with auth state
- React and React-DOM as shared singletons

Each microfrontend:

- Runs as a standalone dev server during development
- Is consumed at runtime via Module Federation in production builds
- Manages its own domain-specific state internally

---

## Data Flow

User authentication is handled exclusively by `users-service`. On login, a JWT is issued and stored by the host app in its Redux auth slice. All subsequent requests to any service include the JWT in the `Authorization: Bearer <token>` header.

`products-service` calls `users-service` to resolve product owners (`?expandOwner=true`). That is
the workspace's one service-to-service hop, and it is where propagation is easiest to observe.

---

## Observability

Every request carries an `x-trace-id` header — minted by the browser in production, by the first
backend service here — and every service writes it as a `traceId` field on every log line, alongside
a `user-agent` that names the caller and supplies the edges. One query returns the whole chain of a
request across all services.

```logql
{namespace=~"team-workspace"} |= "01M0J6EYRY4TFEPR9PHJZ1QHPF"
```

There is no tracing SDK, no exporter and no collector — the id rides on log collection that exists
regardless. Adoption per service is two module imports, after which no application code mentions a
trace id.

- **Design and trade-offs:** [Distributed Tracing](./distributed-tracing.md)
- **Runbook:** [Tracing a Request](../guides/tracing-a-request.md)

---

## Deployment

All services are containerised (Docker) and deployed to Kubernetes. Infrastructure and deployment configuration lives in [infra](../../infra/README.md).

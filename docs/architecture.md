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
  +-- calls --> users-service (port 4001) — REST API
  +-- calls --> products-service (port 4002) — REST API
```

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

---

## Deployment

All services are containerised (Docker) and deployed to Kubernetes. Infrastructure and deployment configuration lives in [infra](../infra/README.md).

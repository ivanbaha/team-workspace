# Frontend

All user-facing applications. The architecture follows a microfrontend model: each domain has its own isolated React app, and a single host app composes them together at runtime.

---

## Projects

- [users-frontend](./users-frontend/README.md) — Microfrontend for the Users domain (profile, settings, authentication UI)
- [products-frontend](./products-frontend/README.md) — Microfrontend for the Products domain (catalogue, detail pages)
- [host-frontend](./host-frontend/README.md) — The main React application that loads and composes all microfrontends

---

## Microfrontend Architecture

Each microfrontend exposes a set of routes and components via Module Federation. The host app discovers them at runtime through a shared manifest.

Integration contract:

- Each microfrontend exposes a default `mount(element)` function.
- Routes are registered through the host router.
- Shared dependencies (React, React-DOM) are provided by the host as singletons.

---

## Development

```bash
# From workspace root — run a specific app
yarn dev:users-fe
yarn dev:products-fe
yarn dev:host
```

Start the host last, as it expects the remote microfrontend servers to be available.

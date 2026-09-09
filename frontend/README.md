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

## Distributed tracing starts here

Every trace in the system begins in the browser, not at the edge service. The host installs a
`fetch` interceptor that mints a ULID per API call and sets it as `x-trace-id`; every backend hop
inherits that id rather than minting its own, so the id a user pastes into a bug report is the same
one in every service's logs.

Two consequences worth knowing before touching API code:

- **A microfrontend cannot name itself in a trace.** `user-agent` is a forbidden header name in
  `fetch`, so all three apps appear as one node, `browser`. Per-app attribution would need a header
  of its own — an open decision, not something the implementation does today.
- **The interceptor is installed once, by the host.** It patches `window.fetch`, which Module
  Federation remotes share. A remote that installs its own stacks a second patch on the first.

Both, with the CORS headers it depends on:
[The entry point — the browser](../docs/architecture/distributed-tracing.md#the-entry-point--the-browser).

> **These apps are scaffolds.** They carry no dependencies, have no bundler config, and make no API
> calls — so although
> [`install-trace-interceptor.js`](./host-frontend/src/tracing/install-trace-interceptor.js) is real
> and the host installs it, nothing in this repository is intercepted. Traces you produce by running
> the demo start at the backend. See
> [What this repository does and does not demonstrate](../docs/architecture/distributed-tracing.md#what-this-repository-does-and-does-not-demonstrate).

---

## Development

```bash
# From workspace root — run a specific app
yarn dev:users-fe
yarn dev:products-fe
yarn dev:host
```

Start the host last, as it expects the remote microfrontend servers to be available.

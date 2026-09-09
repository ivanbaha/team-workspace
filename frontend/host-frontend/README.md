# host-frontend

The main React application. Responsible for the application shell: global navigation, authentication context, and loading microfrontends into their designated regions.

---

## Responsibilities

- Application shell layout (header, sidebar, footer)
- Top-level routing that delegates sub-routes to microfrontends
- Shared authentication context provided to all microfrontends
- Module Federation host configuration
- **The `fetch` trace interceptor** — installed once here, before any remote is mounted

---

## The trace interceptor

The host owns the first hop of every distributed trace. `installTraceInterceptor()` wraps
`window.fetch` so each call to our own APIs carries a freshly minted ULID in `x-trace-id`; the
services inherit it, and the whole request chain lands in the logs under one id.

```jsx
// src/index.jsx — before mounting any remote
installTraceInterceptor([process.env.API_ORIGIN ?? window.location.origin]);
```

Source: [`src/tracing/install-trace-interceptor.js`](./src/tracing/install-trace-interceptor.js).
**Nothing in this repository calls it** — these apps make no API calls — so demo traces start at the
backend. The code is here because it is what production does and what the architecture doc links to.

**It belongs here and nowhere else.** Remotes share this `window`, so a remote that installs its own
stacks a second patch on top of the host's — three wrappers deep, with a load-order dependency
nobody wants to debug. Remotes just call `fetch` and get the header for free.

Implementation, the CORS headers it needs cross-origin, and why the browser can never supply the
identity half of the contract:
[The entry point — the browser](../../docs/architecture/distributed-tracing.md#the-entry-point--the-browser).

---

## Tech Stack

- React 18
- React Router v6
- Redux Toolkit (global state)
- Module Federation (Webpack 5) — host role

---

## Source Structure

```txt
src/
  index.jsx             — Entry point
  App.jsx               — Root component, router setup
  routes/               — Route definitions
  state/                — Redux store and slices
  components/           — Shared UI components (Shell, Header, Sidebar)
```

### Internal Navigation

- [src/routes](./src/routes/) — All top-level and microfrontend route registrations
- [src/state](./src/state/) — Redux store setup, slices, and selectors
- [src/components](./src/components/) — Shared shell components used across the entire app

---

## Remotes (Microfrontends)

| Remote            | Port | Module |
| ----------------- | ---- | ------ |
| users-frontend    | 3001 | ./App  |
| products-frontend | 3002 | ./App  |

---

## Development

```bash
yarn install

# Start microfrontends first (from workspace root):
yarn dev:users-fe
yarn dev:products-fe

# Then start the host:
yarn dev          # port 3000
```

# host-frontend

The main React application. Responsible for the application shell: global navigation, authentication context, and loading microfrontends into their designated regions.

---

## Responsibilities

- Application shell layout (header, sidebar, footer)
- Top-level routing that delegates sub-routes to microfrontends
- Shared authentication context provided to all microfrontends
- Module Federation host configuration

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

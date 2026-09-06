# libs

Internal shared libraries. Each library is a standalone package versioned and published
independently, then consumed by frontends and backend services across the workspace.

Running `yarn setup` (from the workspace root) clones all libraries listed in
[configs/workspace-repos.json](../configs/workspace-repos.json) into this directory.

---

## Libraries

| Package                | Type      | Description                                                        |
| ---------------------- | --------- | ------------------------------------------------------------------ |
| **tw-tracing**         | backend   | The Trace-Id contract: header name, id format, and the request seed |
| **tw-logger**          | backend   | JSON logger with the trace id on every line, plus request logging   |
| **tw-http-connector**  | backend   | Outbound HTTP client that propagates the trace id to the next service |
| tw-common-frontend     | frontend  | Shared React hooks, context providers, and UI primitives           |
| tw-api-client          | frontend  | Typed HTTP client wrappers for all internal REST APIs              |
| tw-common-backend      | backend   | Shared NestJS guards, JWT utilities, and error-handling helpers    |
| tw-config              | universal | Centralised environment variable loader and schema validation      |

The three bolded packages are checked in here; the rest are cloned by `yarn setup`.

---

## The tracing libraries

Together they implement [Distributed Tracing](../docs/architecture/distributed-tracing.md). The
split between them is the design, not packaging preference:

```txt
@tw/tracing            the contract — one header name, one id format, one seed
   ↑            ↑
@tw/logger    @tw/http-connector
```

Both consumers depend on `@tw/tracing` and **not on each other**, so the header name is defined
exactly once for the whole workspace. A header repeated as a string literal across a dozen
repositories drifts — one casing variant is enough to break correlation for exactly one hop, and
every individual log line still looks correct.

| Package | Read it for |
|---|---|
| [@tw/tracing](./tw-tracing/README.md) | The wire contract, and why the seed is middleware rather than an interceptor |
| [@tw/logger](./tw-logger/README.md) | The log record, the two loggers, and the request/response pair traces are built from |
| [@tw/http-connector](./tw-http-connector/README.md) | Outbound propagation, and why `userAgent` must equal `DEPLOYMENT_NAME` |

```bash
yarn build:libs   # tracing → logger → http-connector, in dependency order
yarn test:libs
```

They are TypeScript and build to `dist/`, which services consume. Build them once after
`yarn install`, or a service's typecheck will fail on missing declarations.

---

## Adding a New Library

1. Create and publish the repository on GitHub.
2. Add an entry to [configs/workspace-repos.json](../configs/workspace-repos.json) under the
   `"libs"` key.
3. Run `yarn setup` to clone it into this directory.
4. The library is automatically included in the Yarn workspace (`libs/*`) so cross-package imports
   resolve without publishing.

---

## Conventions

- All libraries follow the naming prefix `tw-` (team-workspace) and the npm scope `@tw/`.
- Each library has its own `package.json`, `README.md`, and `CHANGELOG.md`.
- Breaking changes require a semver major bump and a migration note in the library's changelog.
- A library that other libraries depend on stays as small as it can be. `@tw/tracing` is ~120 lines
  precisely so that depending on it costs nothing to reason about.

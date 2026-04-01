# libs

Internal shared libraries. Each library is a standalone package versioned and published independently, then consumed by frontends and backend services across the workspace.

Running `yarn setup` (from the workspace root) clones all libraries listed in [configs/workspace-repos.json](../configs/workspace-repos.json) into this directory.

---

## Libraries

| Package | Type | Description |
| ----------------------- | ---------- | ----------------------------------------------------------------- |
| tw-common-frontend | frontend | Shared React hooks, context providers, and UI primitives |
| tw-api-client | frontend | Typed HTTP client wrappers for all internal REST APIs |
| tw-common-backend | backend | Shared Express middleware, JWT utilities, and error helpers |
| tw-config | universal | Centralised environment variable loader and schema validation |

---

## Adding a New Library

1. Create and publish the repository on GitHub.
2. Add an entry to [configs/workspace-repos.json](../configs/workspace-repos.json) under the `"libs"` key.
3. Run `yarn setup` to clone it into this directory.
4. The library is automatically included in the Yarn workspace (`libs/*`) so cross-package imports resolve without publishing.

---

## Conventions

- All libraries follow the naming prefix `tw-` (team-workspace).
- Each library has its own `package.json`, `README.md`, and `CHANGELOG.md`.
- Breaking changes require a semver major bump and a migration note in the library's changelog.

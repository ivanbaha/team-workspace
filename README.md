# Team Workspace

Central monorepo for the development team. All frontend microfrontends, backend services, infrastructure configs, and shared documentation live here.

---

## Workspace Structure

- [frontend](./frontend/README.md) — Frontend projects (microfrontends and host app)
- [backend](./backend/README.md) — Backend services
- [libs](./libs/README.md) — Internal shared libraries (UI primitives, API clients, common middleware)
- [infra](./infra/README.md) — Infrastructure configuration and GitOps
- [docs](./docs/README.md) — Shared team documentation
- [mcp](./mcp/README.md) — Custom Model Context Protocol (MCP) server for developer tools
- [scripts](./scripts/README.md) — Workspace automation scripts
- [configs](./configs/) — Workspace-level configuration files

---

## Quick Navigation

### Frontend

- [frontend/README.md](./frontend/README.md) — Overview of all frontend projects
  - [users-frontend](./frontend/users-frontend/README.md) — Microfrontend: Users domain UI
  - [products-frontend](./frontend/products-frontend/README.md) — Microfrontend: Products domain UI
  - [host-frontend](./frontend/host-frontend/README.md) — Main React host app that composes all microfrontends

### Backend

- [backend/README.md](./backend/README.md) — Overview of all backend services
  - [users-service](./backend/users-service/README.md) — REST API: Users domain
  - [products-service](./backend/products-service/README.md) — REST API: Products domain

### Infrastructure

- [infra/README.md](./infra/README.md) — Infrastructure overview
  - [git-ops](./infra/git-ops/README.md) — GitOps deployment manifests

### Libraries

- [libs/README.md](./libs/README.md) — Internal shared libraries
  - tw-common-frontend — Shared React hooks, context providers, and UI primitives
  - tw-api-client — Typed HTTP client wrappers for all internal REST APIs
  - tw-common-backend — Shared Express middleware, JWT utilities, and error helpers
  - tw-config — Centralised environment variable loader and schema validation

### Scripts and Config

- [scripts/README.md](./scripts/README.md) — Workspace automation scripts
  - [setup-workspace.mjs](./scripts/setup-workspace.mjs) — First-time setup: installs the git hook and clones missing repos
  - [update-workspace.mjs](./scripts/update-workspace.mjs) — Sync: pulls updates in existing repos, clones any that are missing
- [.githooks/post-merge](./.githooks/post-merge) — Git hook activated by `yarn setup`; runs `yarn update` automatically after every `git pull`
- [configs/workspace-repos.json](./configs/workspace-repos.json) — List of repos to clone and sync (frontends, backends, libs)

### Documentation

- [docs/README.md](./docs/README.md) — Documentation hub
  - [Guides](./docs/guides/README.md) — Local onboarding, tool configuration, and MCP setup
    - [Onboarding](./docs/guides/onboarding.md) — Getting started guide for new team members
    - [Workspace MCP Server](./docs/guides/mcp-server.md) — In-depth connection and setup guide for the MCP server
  - [Business](./docs/business/README.md) — Descriptions of business flows and user perspective overview
  - [Architecture](./docs/architecture/README.md) — Technical designs, conventions, and patterns
    - [Architecture Overview](./docs/architecture/architecture.md) — System architecture overview
    - [API Contracts](./docs/architecture/api-contracts.md) — Shared API conventions

### MCP Server

- [mcp/README.md](./mcp/README.md) — Overview and setup instructions for the Workspace MCP server

---

## Getting Started

```bash
# 1. Clone all repos listed in configs/workspace-repos.json and install the git hook
yarn setup

# 2. Install all workspace dependencies
yarn install

# Run the host frontend in development mode
yarn dev:host

# Run a specific backend service
yarn dev:users-be

# Pull updates in all nested repos (also runs automatically after git pull)
yarn update

# 3. (Optional) Run the local MCP server inside MCP Inspector (development)
cd mcp && yarn install && yarn start:dev
```

After running `yarn setup` once, a `post-merge` git hook is active. Every subsequent `git pull` on the workspace will automatically call `yarn update` to keep all nested repos in sync.

Refer to each project's own README for detailed instructions.

---

## Setting Up the Developer Tools (MCP Server)

The workspace includes a custom Model Context Protocol (MCP) server under `./mcp` that integrates with GitLab, Jira, Grafana, MongoDB, and provides hybrid local documentation search.

To set up the MCP server:

1. **Configure Environment Variables**:
   Copy the `example.env` at the root of the workspace to `.env` and fill in your credentials (tokens for GitLab, Jira, etc.):

   ```bash
   cp example.env .env
   ```

2. **Install MCP Dependencies**:

   ```bash
   cd mcp && yarn install
   ```

3. **Configure Your Agent/IDE**:
   - **Kiro IDE**: Copy the configuration template from `mcp/agent-configs/kiro.json` into `.kiro/settings/mcp.json` in your workspace.
   - **Claude Desktop**: Copy the block from `mcp/agent-configs/claude_desktop.json` to your Claude Desktop config file (substituting your actual workspace path).
   - **VS Code Cline**: Copy the block from `mcp/agent-configs/cline.json` to your Cline MCP settings (substituting your actual workspace path).
4. **(Optional) Enable Hybrid Docs Search**:
   - Start Docker Desktop or local daemon.
   - In your `.env`, set `DOCS_SEARCH_ENABLED=true` and `QDRANT_ENGINE='docker'`.
   - Reconnect the server; it will automatically spin up Qdrant and index your files.

For full details, architecture diagrams, and troubleshooting tips, see the [Workspace MCP Server Guide](./docs/guides/mcp-server.md).

---

## VS Code Settings

A [`.vscode/settings.json`](./.vscode/settings.json) file is committed to this repository. **Do not remove it.**

The most important setting it enforces is:

```json
"git.detectSubmodules": false
```

VS Code's Source Control panel continuously scans for Git repositories inside the workspace. With a large number of nested repos cloned by `yarn setup`, this background scanning becomes extremely resource-intensive — slowing down the editor and flooding the Source Control view with unrelated repo states. Disabling submodule detection stops this entirely without affecting any other Git functionality.

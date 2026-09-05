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
  - [setup-workspace.mjs](./scripts/setup-workspace.mjs) — Install hooks, clone/pull repos, rebuild the docs index
  - [update-workspace.mjs](./scripts/update-workspace.mjs) — Sync: pulls existing repos, clones any that are missing
  - [install-git-hooks.mjs](./scripts/install-git-hooks.mjs) — Point git at `.githooks/` and repair it
  - [daily-setup-guard.mjs](./scripts/daily-setup-guard.mjs) — Once-per-day flow, triggered on folder open
- [.githooks/](./.githooks/) — Tracked git hooks: `post-merge`, `post-rewrite`, and the shared `post-update.mjs` they delegate to
- [configs/workspace-repos.json](./configs/workspace-repos.json) — List of repos to clone and sync (frontends, backends, libs)
- [.vscode/tasks.json](./.vscode/tasks.json) — `folderOpen` task that runs the daily guard, plus docs-index tasks

### Documentation

- [docs/README.md](./docs/README.md) — Documentation hub
  - [Guides](./docs/guides/README.md) — Local onboarding, tool configuration, and operational runbooks
    - [Onboarding](./docs/guides/onboarding.md) — Getting started guide for new team members
    - [Workspace MCP Server](./docs/guides/mcp-server.md) — In-depth connection and setup guide for the MCP server
    - [Workspace Automation](./docs/guides/workspace-automation.md) — Git hooks, daily setup guard, change-aware index rebuilds, automation security
    - [Docs Search Operations](./docs/guides/docs-rag-operations.md) — Health checks, symptom → cause, recovery
    - [Evaluating Retrieval Quality](./docs/guides/docs-rag-evaluation.md) — The monthly check that search still returns good answers
    - [Running Qdrant](./docs/guides/qdrant-runtimes.md) — Docker, Podman, WSL containers, Apple containers, or external
  - [Business](./docs/business/README.md) — Business flows from the user's perspective
    - [Checkout Flow](./docs/business/checkout-flow.md) — Basket to confirmed order, stage by stage
  - [Architecture](./docs/architecture/README.md) — Technical designs, conventions, and patterns
    - [Architecture Overview](./docs/architecture/architecture.md) — System architecture overview
    - [API Contracts](./docs/architecture/api-contracts.md) — Shared API conventions
    - [Hybrid RAG over the Team Documentation](./docs/architecture/docs-rag.md) — How the agent searches these docs
  - [SPECs](./docs/SPECs/README.md) — Feature specifications. **Deliberately excluded from the search index** — see [why](./docs/architecture/docs-rag.md#case-study-why-specs-and-tasks-are-the-worst-offenders)

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

After running `yarn setup` once, the tracked git hooks are active. Every
subsequent `git pull` on the workspace automatically syncs the nested repos —
and, if the pull brought changed documentation, rebuilds the AI search index in
the background. Both `post-merge` and `post-rewrite` are installed, so the
automation works whether your team merges or rebases on pull.

Repair the hooks at any time with `yarn hooks:install`. See
[Workspace Automation](./docs/guides/workspace-automation.md) for what runs when.

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
   - Start Docker Desktop or the local daemon.
   - In your `.env`, set `DOCS_SEARCH_ENABLED=true` and `QDRANT_ENGINE='docker'`.
   - Reconnect the server; it spins up Qdrant and indexes your files automatically.
   - Verify it: `yarn docs:health`, then try `yarn docs:query "how does checkout work"`.

For full details, architecture diagrams, and troubleshooting tips, see the [Workspace MCP Server Guide](./docs/guides/mcp-server.md).

---

## How the Workspace Gives an AI Agent Context

The workspace is not just a place to keep code — it is structured so an AI agent
can answer questions about it. Three layers, each usable without the ones below:

| Layer | What it gives the agent | Needs |
|---|---|---|
| **Structured docs** — `docs/`, service READMEs | Written knowledge in predictable places, with headings that mean something | nothing |
| **`docs_map`** (MCP tool) | A table of contents of `docs/`: every file → sections → line ranges | nothing |
| **`docs_search`** (MCP tool, opt-in) | Hybrid semantic + keyword retrieval across the whole curated corpus | Qdrant + a local embedding model |

Both tools return **pointers, not prose** — file path, heading path, line range,
snippet. Neither answers the question; they locate the section, and the agent
reads the real file. That keeps the retrieval layer debuggable and free of the
"summarise-then-hallucinate" failure mode.

The index stays current on its own: it rebuilds when a `git pull` brings changed
documentation, at most once a day otherwise, and self-heals if the Qdrant volume
is wiped. Rebuilds are zero-downtime, so they are safe to fire while someone is
searching.

**What goes in the index is a curation decision, not a glob.** Specs, task
documents, agent skills, changelogs and templates are deliberately excluded:
they describe *intent* or *procedure* rather than *reality*, and in a ranked list
they outrank the docs that answer the question — a spec for an unbuilt feature
reads exactly like documentation of a working one.

```bash
yarn docs:sources            # what is in the corpus, and why
yarn docs:query "..."        # search it from the terminal
yarn docs:health             # is the index actually healthy?
yarn docs:eval               # does it still return good answers? (run monthly)
yarn docs:ingest             # rebuild after editing docs locally
```

- **How it works and why:** [Hybrid RAG over the Team Documentation](./docs/architecture/docs-rag.md)
- **What to keep out of the index:** [Corpus hygiene](./docs/architecture/docs-rag.md#the-corpus--declared-not-discovered)
- **What keeps it current:** [Workspace Automation](./docs/guides/workspace-automation.md)
- **Keeping it accurate as it grows:** [Evaluating Retrieval Quality](./docs/guides/docs-rag-evaluation.md)
- **When to move it off laptops:** [Scaling the index](./docs/architecture/docs-rag.md#scaling-when-to-move-the-index-off-developer-machines)
- **Running Qdrant your way:** [Container runtime options](./docs/guides/qdrant-runtimes.md)
- **When it breaks:** [Docs Search Operations](./docs/guides/docs-rag-operations.md)
- **Writing docs that retrieve well:** [Documentation Hub](./docs/README.md#writing-docs-that-retrieve-well)

---

## VS Code Settings

A [`.vscode/settings.json`](./.vscode/settings.json) file is committed to this repository. **Do not remove it.**

The most important setting it enforces is:

```json
"git.detectSubmodules": false
```

VS Code's Source Control panel continuously scans for Git repositories inside the workspace. With a large number of nested repos cloned by `yarn setup`, this background scanning becomes extremely resource-intensive — slowing down the editor and flooding the Source Control view with unrelated repo states. Disabling submodule detection stops this entirely without affecting any other Git functionality.

### Enable the daily setup task (one-time, per machine)

[`.vscode/tasks.json`](./.vscode/tasks.json) defines a `folderOpen` task that
runs the [daily setup guard](./scripts/daily-setup-guard.mjs) — pulling every
nested repo and refreshing the docs index once per day.

Automatic tasks must be enabled in your **user** settings; a workspace cannot
grant itself permission to run code on open, by design:

```json
"task.allowAutomaticTasks": "on"
```

Without it the task never runs, and the automation looks broken with no error
anywhere. This is the most common reason someone reports "the daily setup never
happens". Reload the window after changing it.

The same file also registers manual tasks for rebuilding the docs index, running
a health check, evaluating retrieval quality, checking Qdrant, and printing the
corpus.

> **⚠ Enabling automatic tasks means code runs when you open a folder.**
> `.vscode/tasks.json` is version-controlled, so anyone who can land a commit can
> change what executes on your machine — and with the setting on, opening a
> cloned untrusted repository is enough. If you enable it, adopt the review habit
> that goes with it: treat diffs to `.vscode/tasks.json` and `.githooks/` like
> diffs to a deploy script, and audit periodically —
>
> ```bash
> cat .vscode/tasks.json                 # what runs on folder open
> git config core.hooksPath              # expect: .githooks
> ls -la .git/hooks/                     # NOT tracked — local-only additions
> git log --oneline -- .githooks .vscode/tasks.json | head
> ```
>
> If you clone widely, leave the setting off and run `yarn daily-setup` by hand.
> Full rationale: [Security — automation is code execution](./docs/guides/workspace-automation.md#security-automation-is-code-execution).

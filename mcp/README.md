# Workspace MCP Server

Model Context Protocol (MCP) server for team workflow tools. Provides AI agents with tools to interact with GitLab, Jira, Grafana, and MongoDB, and to navigate the team documentation. Claude Code, GitHub Copilot (VS Code) and Cursor start it from configs committed at the workspace root; Kiro, Claude Desktop and Cline use the absolute-path templates in [`agent-configs/`](./agent-configs/README.md) — see [Connecting to AI Agents](#connecting-to-ai-agents).

Runs as a **stdio-only** MCP server. Configuration is loaded from the workspace root `.env` file using `nestjs-env-getter`.

## Features

### GitLab Integration Tools

- **`gitlab_get_pipelines`** — Get pipelines for a project (accepts full URL or project_id with filters)
- **`gitlab_get_pipeline_jobs`** — Get all jobs for a specific pipeline
- **`gitlab_get_job_log`** — Get raw log output of a pipeline job
- **`gitlab_retry_job`** — Retry a failed pipeline job
- **`gitlab_play_job`** — Trigger a manual pipeline job
- **`gitlab_get_pending_mrs`** — Fetch MRs where user is assigned as reviewer
- **`gitlab_get_mr_details`** — Get MR info, file changes, and discussions
- **`gitlab_post_comment`** — Add general MR comments
- **`gitlab_post_line_comment`** — Add line-specific review comments
- **`gitlab_approve_mr`** — Approve merge requests
- **`gitlab_create_mr`** — Create a new merge request
- **`gitlab_safe_push`** — Safely push commits with built-in protections
- **`gitlab_get_project_info`** — Get project details and structure
- **`gitlab_get_projects`** — List accessible projects
- **`gitlab_get_available_apis`** — Get available HTTP APIs (OpenAPI spec)
- **`gitlab_get_current_user`** — Get current authenticated user details

### Jira Integration Tools

- **`jira_issue_get`** — Get issue details by code (metadata, description, attachments, comments)
- **`jira_attachment_get`** — Fetch a Jira attachment as base64
- **`jira_issue_create`** — Create a new Jira issue with full field support

### Grafana Integration Tools

- **`grafana_get_available`** — Validate connectivity to configured Grafana environments
- **`grafana_search_logs`** — Search logs in Grafana/Loki (by service, search string, or global)
- **`grafana_trace_id`** — Trace one Trace-Id across every service that took part in a request and
  return the reconstructed call chain: caller → callee edges, per-call status codes and durations,
  coverage gaps, and every error logged under that id. Use it **first** whenever a trace id is
  known — it replaces the manual `grafana_search_logs` narrowing loop with one call. See
  [Distributed Tracing](../docs/architecture/distributed-tracing.md) and
  [Tracing a Request](../docs/guides/tracing-a-request.md)

### MongoDB Integration Tools

- **`mongodb_get_available`** — Test connectivity and list databases
- **`mongodb_list_collections`** — List collections with document counts
- **`mongodb_find`** — Run find queries with filter, projection, sort, limit
- **`mongodb_count`** — Count documents matching a filter
- **`mongodb_aggregate`** — Run read-only aggregation pipelines

### Documentation Tools

- **`docs_map`** — Structured outline (table of contents) of all docs under `docs/`: every file → its sections → line ranges, each with a one-line summary. Always available, no extra dependencies. Use it to locate the right doc/section, then read that file.
- **`docs_search`** *(opt-in)* — Hybrid semantic + keyword search over `docs/`, returning the most relevant sections as pointers (path, heading, line range, snippet, score). Combines dense embeddings (Transformers.js) with BM25 sparse vectors, fused in Qdrant via Reciprocal Rank Fusion. Available only when `DOCS_SEARCH_ENABLED=true` and the index has been built (see [Docs Hybrid Search](#docs-hybrid-search-docs_search-opt-in)).

> [!CAUTION]
> **Security and Data Privacy Warnings:**
>
> 1. **Read-Only Restriction**: All database-related tools (`mongodb_*`) allow **ONLY read-only** queries to prevent accidental modifications or deletion of data. These tools should **never** be adjusted or extended to run any write, insert, update, delete, or other data-modifying commands.
> 2. **Production Data Access**: Interacting with **Production** environments (even read-only) must be **carefully considered** before enabling. Because data returned by tools is sent to third-party LLM providers (depending on the agent configuration), exposing production databases can leak sensitive customer, business, or proprietary data.

## Requirements

- Node.js 22.x or higher
- Workspace `.env` file with required credentials (see below)
- Docker (default) or WSL (with `wslc` engine) for local Qdrant (only required if hybrid docs search is enabled)

## Configuration

The MCP server reads all configuration from the `.env` file located at the workspace root (`../` relative to the `mcp/` directory).

### Environment Variables

See `example.env` in the workspace root for a complete template.

| Variable | Required | Description |
|----------|----------|-------------|
| `GITLAB_PAT` | yes | GitLab Personal Access Token |
| `GITLAB_BASE_URL` | no | GitLab instance URL (default: `https://gitlab.company.internal/`) |
| `JIRA_PAT` | yes | Jira Personal Access Token |
| `JIRA_BASE_URL` | no | Jira instance URL (default: `https://jira.company.internal`) |
| `JIRA_DEFAULT_PROJECT` | no | Default Jira project key (default: `TW`) |
| `JIRA_DEFAULT_REPORTER` | no | Default reporter username (defaults to token owner) |
| `JIRA_FIELDS` | no | JSON object mapping field aliases (`sprint`, `team`, `environments`) to customfield IDs |
| `JIRA_ENVIRONMENTS` | no | JSON object mapping environment names to field option IDs |
| `JIRA_TEAMS` | no | JSON object mapping team aliases to team IDs |
| `GRAFANA_ENVS` | no | JSON object with Grafana environment credentials |
| `MONGODB_ENVS` | no | JSON object with MongoDB connection strings |
| `DOCS_SEARCH_ENABLED` | no | Enable the opt-in `docs_search` hybrid tool (default `false`) |
| `QDRANT_URL` | no | Qdrant endpoint used by `docs_search` (default `http://127.0.0.1:6333`) |
| `QDRANT_ENGINE` | no | Container engine to use: `docker` or `wslc` (default `docker`) |
| `DOCS_RAG_MODEL` | no | Embedding model ID (default `Snowflake/snowflake-arctic-embed-m-v1.5`) |
| `DOCS_RAG_COLLECTION`| no | Qdrant collection name/alias (default `workspace_docs`) |

## Docs Hybrid Search (`docs_search`, opt-in)

`docs_map` works out of the box with no extra setup. `docs_search` adds semantic + keyword retrieval over the whole workspace documentation and is **disabled by default**, so the server runs without embedding/Qdrant dependencies for anyone who doesn't need it. The heavy dependencies (`@huggingface/transformers`, `@qdrant/js-client-rest`) are `optionalDependencies` and are loaded only when the feature is enabled.

To enable it:

1. **Install dependencies** (pulls the optional deps):

   ```bash
   cd mcp && yarn install
   ```

2. **Select your Qdrant container engine** in `.env`:
   - **Docker** (Default, recommended for macOS and Linux): Ensure Docker Desktop or Daemon is running.
   - **WSL Container (`wslc`)**: Used for native WSL container support on Windows. One-time setup from **PowerShell as Administrator**:

     ```powershell
     wsl --update --pre-release   # get the build that includes the container engine
     wsl --shutdown               # restart WSL so the update takes effect
     wslc version                 # verify it is available
     ```

3. **Enable the feature** in the workspace `.env`:

   ```env
   DOCS_SEARCH_ENABLED=true
   QDRANT_ENGINE='docker' # or 'wslc'
   ```

4. **Auto-approve the tool** (e.g. in your IDE settings) and connect/start the server.

### What happens on startup (when `DOCS_SEARCH_ENABLED=true`)

- **Qdrant auto-starts** — the server checks `QDRANT_URL/healthz`. If Qdrant isn't already up, it starts the `workspace-docs-qdrant` container via the configured engine (Docker or `wslc`) with data persisted in the git-ignored `mcp/.qdrant-storage/` and waits for it to be healthy.
- **Index validated on startup** — after Qdrant is confirmed healthy, the server checks that the index is present (alias resolves to a non-empty collection and the local BM25 model file exists). If either is missing, it rebuilds immediately.
- **Docs auto-ingest once a day** — the index is refreshed once per day in the background. Only successful runs are recorded in `mcp/.docs-index/ingest-state.json`. The first run downloads the embedding model (~100MB+) into `mcp/.cache/` and may take a couple of minutes.
- **Zero-downtime re-indexing** — ingestion uses a blue-green pattern. Search queries the alias `workspace_docs`. Ingestion populates a new timestamped collection; once completed, the alias is atomically swapped to the new collection, and the old one is dropped.

### Manual controls (optional)

You normally don't need these — they're for forcing an action or debugging:

```bash
# Diagnose
yarn docs:health          # is the index healthy? checks BOTH halves + orphans
yarn docs:eval            # does it still return GOOD answers? (run monthly)
yarn docs:query "..."     # run a search from the terminal (--explain shows each half)
yarn docs:sources         # print the full list of files that get indexed

# Build
yarn docs:ingest          # rebuild now (blue-green — safe while the tool is in use)
yarn docs:download-model  # pre-warm the embedding model cache
yarn docs:reset --yes     # delete the index + volume and rebuild from scratch

# Container — engine-agnostic, reads QDRANT_ENGINE from .env
yarn qdrant up            # create + start
yarn qdrant start|stop|rm|logs
yarn qdrant status        # engine, container state, endpoint health
```

Supported engines: `docker`, `podman`, `nerdctl`, `wslc` (Windows), `container`
(Apple), and `external` for an instance managed elsewhere. See
[Running Qdrant](../docs/guides/qdrant-runtimes.md).

When a search returns nothing useful, `yarn docs:health` and
`yarn docs:query --explain` answer two different questions — whether the index
is broken, and whether retrieval simply ranked the wrong thing. See
[Docs Search Operations](../docs/guides/docs-rag-operations.md).

### What gets indexed

The corpus is **declared, not discovered** — defined in `src/docs/sources.js`
as an explicit list rather than "every `.md` in the workspace", because a
workspace of cloned repos contains a lot of markdown that is not team knowledge.
Currently indexed:

- **`docs/`** — all team docs (architecture, business flows, guides), except
  `docs/SPECs/` (`exclude: ['SPECs']`).
- **`.ai/`** — agent **connector** docs (`exclude: ['skills']`).
- **`frontend/`, `backend/`, `libs/`** — service READMEs at `depth: 1`, so a
  newly cloned service is picked up with no edit to `sources.js`.
- **`infra/`, `configs/`, `scripts/`** — tooling READMEs.
- Individual files: workspace `README.md` and `mcp/README.md`.

Deliberately **excluded**, each for a reason worth understanding before you copy
this setup elsewhere:

| Excluded | Why |
|---|---|
| Feature specs and task documents | Describe *intent*, not reality. Retrieval cannot tell a plan from a description, so a spec for an unbuilt feature reads like documentation of a working one. |
| Agent skills (`.ai/skills/` and every mirror) | Instructions *to* an agent, not knowledge *about* the system — and each agent already receives them through its own wrapper. |
| `CHANGELOG.md`, `_template/` | Rewritten by CI on every pipeline; placeholder prose that matches structural queries. |

Always inspect the resolved list before rebuilding — it is instant, and it is
the only way to see what a `depth` or `exclude` rule actually did:

```bash
yarn docs:sources
```

The reasoning behind each curation decision is in
[the design doc](../docs/architecture/docs-rag.md#the-corpus--declared-not-discovered).

## Connecting to AI Agents

Every agent gets the same single server entry — `node` running `mcp/src/index.js` — in the
format its client documents. Where the client supports a project-scoped file that can point at
the server relative to the workspace root, that file is committed and a fresh clone needs no
setup beyond `.env` and `yarn install`. Where it does not, a template with an absolute path is
provided instead. The full per-agent picture — rules pointer, skill wrapper and MCP config
side by side — is the table in
[`.ai/README.md`](../.ai/README.md#rules-and-skills--one-source-generated-wrappers).

| Agent | Config | Path to the server |
| --- | --- | --- |
| **Claude Code** | [`.mcp.json`](../.mcp.json) (committed) | Relative — Claude Code starts a project server from the project root |
| **GitHub Copilot** (VS Code) | [`.mcp.json`](../.mcp.json) (committed) — VS Code reads the portable root file | Relative — VS Code starts a stdio server in the workspace folder |
| **Cursor** | [`.cursor/mcp.json`](../.cursor/mcp.json) (committed) | `${workspaceFolder}` — Cursor's variable for the project root |
| **Kiro** | template [`agent-configs/kiro.json`](./agent-configs/kiro.json) | Absolute — Kiro's docs define no workspace variable or relative-path rule |
| **Claude Desktop** | template [`agent-configs/claude_desktop.json`](./agent-configs/claude_desktop.json) | Absolute — configured outside the repository |
| **Cline / Roo-Code** | template [`agent-configs/cline.json`](./agent-configs/cline.json) | Absolute — configured outside the repository |

A committed MCP config makes the agent start a process on your machine. **Claude Code asks for
approval before it uses a server from a project `.mcp.json`, and VS Code starts workspace
servers only in a trusted workspace** — those prompts are the trust gate, not an
inconvenience. Review diffs to these files like diffs to a deploy script:
[Security: automation is code execution](../docs/guides/workspace-automation.md#security-automation-is-code-execution).

### Claude Code, GitHub Copilot, Cursor

Nothing to copy. Open the workspace, approve the `workspace-mcp` server when the client asks,
and check it connected — `/mcp` in Claude Code, **MCP: List Servers** in VS Code, the
**Customize** page in Cursor. In Claude Code, `claude mcp reset-project-choices` brings the
approval prompt back if you declined it.

### Kiro

Add the contents of `./mcp/agent-configs/kiro.json` to `.kiro/settings/mcp.json` in your
workspace (or `~/.kiro/settings/mcp.json` for every workspace), replacing the placeholder with
the absolute path of your checkout.

### Claude Desktop

Add the config block in `./mcp/agent-configs/claude_desktop.json` to your global Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### VS Code Cline / Roo-Code

Add the config block in `./mcp/agent-configs/cline.json` to your Cline MCP settings:

- **macOS**: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows**: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

## Development

### Running with MCP Inspector

```bash
cd mcp
yarn start:dev
```

Opens the MCP Inspector web UI for testing tools interactively.

### Project Structure

```txt
src/
├── index.js          # MCP server entry point (stdio)
├── config.js         # Configuration loader
├── utils/
│   └── logger.js     # Internal logging utility
├── gitlab/
│   ├── api.js        # GitLab API client
│   ├── schemas.js    # GitLab tool schemas
│   └── tools.js      # GitLab tool implementations
├── jira/
│   ├── api.js        # Jira API client
│   ├── schemas.js    # Jira tool schemas
│   └── tools.js      # Jira tool implementations
├── grafana/
│   ├── api.js        # Grafana API client (Loki via the datasource proxy)
│   ├── schemas.js    # Grafana tool schemas
│   ├── tools.js      # Grafana tool implementations
│   ├── trace-tool.js # grafana_trace_id — cross-environment search + report writing
│   └── trace/        # Trace reconstruction engine, shared with the .ai connector
│       ├── parse.js  #   Loki lines → typed events (three log shapes tolerated)
│       ├── spans.js  #   Pairs request.in/response.out; builds edges, the call tree, coverage
│       ├── render.js #   Mermaid sequence diagram + Markdown report
│       └── index.js  #   Orchestration, id extraction, LogQL construction, summary
├── mongodb/
│   ├── api.js        # MongoDB client
│   ├── schemas.js    # MongoDB tool schemas
│   └── tools.js      # MongoDB tool implementations
└── docs/
    ├── outline.js    # docs_map: markdown outline parser
    ├── tools.js      # docs_map tool implementation
    ├── chunker.js    # heading-aware chunker
    ├── sources.js    # corpus definition
    ├── bm25.js       # BM25 sparse encoder (lexical side)
    ├── embedder.js   # dense embeddings
    ├── qdrant.js     # Qdrant client (alias-based blue-green)
    ├── qdrant-runtime.js # auto-start Qdrant via docker/wslc
    ├── ingest-state.js   # daily auto-ingest state
    ├── bootstrap.js  # startup wiring
    ├── search.js     # docs_search hybrid tool implementation
    └── schemas.js    # docs tool schemas

agent-configs/            # absolute-path templates for clients without a workspace config
scripts/
├── ingest-docs.mjs      # build the docs_search index (collect -> chunk -> BM25 -> embed -> swap)
├── list-sources.mjs     # print the resolved list of indexed files
├── search-docs.mjs      # run a docs_search query from the terminal (--explain)
├── docs-health.mjs      # diagnose the index: alias, points, BM25, freshness, orphans
├── docs-eval.mjs        # measure retrieval quality against docs-eval.json
├── qdrant.mjs           # engine-agnostic container control (docker/podman/wslc/…)
├── docs-reset.mjs       # delete the index + volume and rebuild from scratch
└── download-model.mjs   # pre-warm/download the embedding model
```

### Adding a tool

A tool's name, description and input schema are sent to the model on every turn, whether or
not the tool is used. That is the cost behind every point below, and the reason a new
capability might belong somewhere other than this server at all —
[Where executable functionality lives](../.ai/README.md#where-executable-functionality-lives)
decides that first.

- **The description is one sentence saying when to use the tool.** It is what the model reads
  on every turn. Parameters are described in the input schema — each property's own
  `description` in `src/<service>/schemas.js` — not in prose in the tool description.
- **Prefer one tool with a mode parameter to near-duplicates.** When two candidate tools would
  share a schema, register one and add a parameter that selects the behaviour.
- **Data-access tools are read-only by default.** The warning under [Features](#features)
  applies to any new tool that reads a data store, not only to `mongodb_*`.
- **A tool that a skill will call is named in that skill's `SKILL.md`**, at the step that uses
  it, so the skill does not depend on the model finding it by description.
- **Leave it out of `ListTools` when it cannot work.** The Grafana, MongoDB and `docs_search`
  tools are listed only when their configuration is present — the same pattern keeps an
  unconfigured tool from costing context for nothing.

The wiring: schema in `src/<service>/schemas.js`, implementation in `src/<service>/tools.js`,
both registered in `src/index.js`.

## Further reading

| Document | Covers |
|---|---|
| [Hybrid RAG design](../docs/architecture/docs-rag.md) | Why hybrid, chunking rules, blue-green rebuilds, footprint, limitations |
| [Docs Search Operations](../docs/guides/docs-rag-operations.md) | Health checks, symptom → cause, recovery procedures |
| [Workspace Automation](../docs/guides/workspace-automation.md) | The five ingest triggers, git hooks, daily setup guard, automation security |
| [Evaluating Retrieval Quality](../docs/guides/docs-rag-evaluation.md) | The periodic check that search still returns good answers |
| [Running Qdrant](../docs/guides/qdrant-runtimes.md) | Docker, Podman, WSL, Apple containers, external |
| [MCP Server Guide](../docs/guides/mcp-server.md) | Setup, transport, agent configuration |

## License

NO LICENSE - Internal Company tool

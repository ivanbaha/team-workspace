# Team Workspace

Central monorepo for the development team. All frontend microfrontends, backend services, infrastructure configs, and shared documentation live here.

---

## Workspace Structure

- [CONTRIBUTING.md](./CONTRIBUTING.md) — **How work is done here.** Conventions, environments, skills, hooks. Start here.
- [frontend](./frontend/README.md) — Frontend projects (microfrontends and host app)
- [backend](./backend/README.md) — Backend services (NestJS)
- [libs](./libs/README.md) — Internal shared libraries (tracing, logging, HTTP connector, UI primitives, API clients)
- [infra](./infra/README.md) — Infrastructure configuration and GitOps — the record of what is deployed where
- [docs](./docs/README.md) — Shared team documentation, including
  [how work flows](./docs/sdlc/README.md), [specs](./docs/SPECs/README.md) and
  [task one-pagers](./docs/tasks/README.md)
- [.ai](./.ai/README.md) — Agent-neutral rules, skills and connectors
- [mcp](./mcp/README.md) — Custom Model Context Protocol (MCP) server for developer tools
- [scripts](./scripts/README.md) — Workspace automation scripts, including the agent hooks
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
  - [users-service](./backend/users-service/README.md) — NestJS REST API: Users domain
  - [products-service](./backend/products-service/README.md) — NestJS REST API: Products domain

### Infrastructure

- [infra/README.md](./infra/README.md) — Infrastructure overview
  - [git-ops](./infra/git-ops/README.md) — GitOps deployment manifests: one base, three overlays (`dev`, `test`, `prod`), and the pinned version of every service

```bash
yarn gitops:versions     # what is pinned in each environment, drift marked
yarn gitops:validate     # do all three overlays still build?
```

### Libraries

- [libs/README.md](./libs/README.md) — Internal shared libraries
  - [@tw/tracing](./libs/tw-tracing/README.md) — The Trace-Id contract: header, id format, the seed
  - [@tw/logger](./libs/tw-logger/README.md) — JSON logger with the trace id on every line
  - [@tw/http-connector](./libs/tw-http-connector/README.md) — Outbound client that propagates the trace id
  - tw-common-frontend — Shared React hooks, context providers, and UI primitives
  - tw-api-client — Typed HTTP client wrappers for all internal REST APIs
  - tw-common-backend — Shared NestJS guards, JWT utilities, and error helpers
  - tw-config — Centralised environment variable loader and schema validation

### Scripts and Config

- [scripts/README.md](./scripts/README.md) — Workspace automation scripts
  - [setup-workspace.mjs](./scripts/setup-workspace.mjs) — Install hooks, clone/pull repos, rebuild the docs index
  - [update-workspace.mjs](./scripts/update-workspace.mjs) — Sync: pulls existing repos, clones any that are missing
  - [install-git-hooks.mjs](./scripts/install-git-hooks.mjs) — Point git at `.githooks/` and repair it
  - [daily-setup-guard.mjs](./scripts/daily-setup-guard.mjs) — Once-per-day flow, triggered on folder open
  - [sync-agent-rules.mjs](./scripts/sync-agent-rules.mjs) — Generate the per-agent rule pointers (`yarn rules:sync`)
  - [sync-skill-wrappers.mjs](./scripts/sync-skill-wrappers.mjs) — Generate the per-agent skill wrappers (`yarn skills:sync`)
  - [hooks/](./scripts/hooks/README.md) — Agent guards: secrets, protected branches, docs-index staleness, overlay builds
- [.githooks/](./.githooks/) — Tracked git hooks: `post-merge`, `post-rewrite`, and the shared `post-update.mjs` they delegate to
- [configs/workspace-repos.json](./configs/workspace-repos.json) — Repo registry: git remote, local path, and project ID for each repo
- [.vscode/tasks.json](./.vscode/tasks.json) — `folderOpen` task that runs the daily guard, plus docs-index tasks

### Documentation

- [docs/README.md](./docs/README.md) — Documentation hub
  - [SDLC](./docs/sdlc/README.md) — How work flows from an idea to a verified change: four phases, their owners, and the hand-offs
    - [Phase 1 · Origination](./docs/sdlc/01-origination.md) — Idea → analysed intent → the right tracker artifact
    - [Phase 2 · Specification](./docs/sdlc/02-specification.md) — Staged, role-scoped spec authoring for big features only
    - [Phase 3 · Development](./docs/sdlc/03-development.md) — Triage, implement, deliver, document
    - [Phase 4 · Verification](./docs/sdlc/04-verification.md) — Coverage designed by QA from the acceptance criteria
    - [SDD in Practice](./docs/sdlc/sdd-in-practice.md) — Why it is shaped this way, what it costs, and the honest limitations
  - [Guides](./docs/guides/README.md) — Local onboarding, tool configuration, and operational runbooks
    - [SDLC Quickstart](./docs/guides/sdlc-quickstart.md) — You have a ticket; what do you actually do?
    - [Onboarding](./docs/guides/onboarding.md) — Getting started guide for new team members
    - [Tracing a Request](./docs/guides/tracing-a-request.md) — Following one request across every service that touched it
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
    - [Distributed Tracing](./docs/architecture/distributed-tracing.md) — One header, one log field, no tracing stack
    - [Hybrid RAG over the Team Documentation](./docs/architecture/docs-rag.md) — How the agent searches these docs
  - [Incidents](./docs/incidents/README.md) — Security and production incidents: what happened, whether it reached us, what to run
  - [Release runbooks](./docs/release/README.md) — One-off operations that have to happen inside a deployment window
  - [Spikes](./docs/spikes/README.md) — Investigations and audits: a question, a verdict, and when the verdict expires
  - [Knowledge sharing](./docs/knowledge-sharing/README.md) — Long-form write-ups from demos and deep dives
  - [SPECs](./docs/SPECs/README.md) — Feature specifications, plus the [template](./docs/SPECs/_template/README.md). **Deliberately excluded from the search index** — see [why](./docs/architecture/docs-rag.md#case-study-why-specs-and-tasks-are-the-worst-offenders)
  - [Task one-pagers](./docs/tasks/README.md) — Single-page plans for small work. Excluded from the index for the same reason

### MCP Server

- [mcp/README.md](./mcp/README.md) — Overview and setup instructions for the Workspace MCP server

---

## Getting Started

```bash
# 1. Clone all repos listed in configs/workspace-repos.json and install the git hook
yarn setup

# 2. Install all workspace dependencies
yarn install

# 3. Build the shared TypeScript libraries (services consume their dist/)
yarn build:libs

# Run the host frontend in development mode
yarn dev:host

# Run a specific backend service
yarn dev:users-be

# Pull updates in all nested repos (also runs automatically after git pull)
yarn update

# 4. (Optional) Run the local MCP server inside MCP Inspector (development)
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

## Following a Request Across Services

Every request carries an `x-trace-id` header, and every service writes it as a `traceId` field on
every log line it emits. Correlating a user action across all of them is one query:

```logql
{namespace=~"team-workspace"} |= "01M0J6EYRY4TFEPR9PHJZ1QHPF"
```

There is **no tracing SDK, no exporter, no collector, and nothing running next to the application
process.** The id rides on the log collection that exists whether or not anything is correlated.
Adoption per service is two module imports:

```ts
@Module({ imports: [TracingModule.forRoot(), LoggerModule.forRoot()] })
export class AppModule {}
```

After that, no application code mentions a trace id. The logger and the outbound HTTP connector both
inherit it through NestJS request-scoped DI, so a developer writes
`this.logger.info('Order not found', 'OrdersService.get')` and the correlation happens by itself.

What that trades away is real and stated plainly in the design doc: there are no per-call span ids,
so caller → callee edges are *inferred* from the forwarded `User-Agent` rather than known exactly.
In exchange the whole mechanism is a few hundred lines, every request is in the logs with no
sampling, and if the log store is down you lose search rather than the request.

| | |
| --- | --- |
| **How it works, and what it gives up** | [Distributed Tracing](./docs/architecture/distributed-tracing.md) |
| **What to do when something breaks** | [Tracing a Request](./docs/guides/tracing-a-request.md) |
| **The packages** | [@tw/tracing](./libs/tw-tracing/README.md) · [@tw/logger](./libs/tw-logger/README.md) · [@tw/http-connector](./libs/tw-http-connector/README.md) |
| **Porting it to another stack** | [Applying this to other stacks](./docs/architecture/distributed-tracing.md#applying-this-to-other-stacks) |

An agent connected to the MCP server gets the assembled chain in one call — `grafana_trace_id`
returns caller → callee edges, per-call status codes and durations, coverage gaps, and every error
logged under the id. Since the trace names services whose source is already checked out here, the
step from "which service failed" to "which line failed" needs no context-gathering at all.

---

## How the Workspace Gives an AI Agent Context

The workspace is not just a place to keep code — it is structured so an AI agent
can answer questions about it. Three layers, each usable without the ones below:

| Layer | What it gives the agent | Needs |
| --- | --- | --- |
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

## How the Workspace Tells an AI Agent What To Do

Retrieval answers *what is true*. Three more layers answer *what to do*, and each is written
once and delivered to every agent:

| Layer | What it is | Where it lives |
| --- | --- | --- |
| **Rules** | Standing conventions — branching, commits, environments, which commands to hand over | [`.ai/rules/`](./.ai/rules/README.md), indexed by [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| **Skills** | Procedures for multi-step jobs, with explicit stopping points for approval | [`.ai/skills/`](./.ai/skills/README.md) |
| **Hooks** | Guards that enforce the expensive-to-undo parts automatically | [`scripts/hooks/`](./scripts/hooks/README.md) |
| **Process** | The lifecycle those three sit inside — who owns which phase, and what hands off to what | [`docs/sdlc/`](./docs/sdlc/README.md) |

Every coding agent reads its instructions from a different conventional path —
`CLAUDE.md`, `.github/copilot-instructions.md`, `.kiro/steering/`, `.agents/`, `.cursor/rules/`.
Maintaining a copy per agent by hand is how they drift, and the drift is invisible: before this
was generated, the same skill was named `Debug & Report` in one wrapper and `debug-and-report`
in another with a different description, so it **triggered differently depending on which agent
you asked**.

So the per-agent files are generated from the canonical ones and verified in CI:

```bash
yarn rules:sync      # regenerate the six rule pointers from .ai/rules/ + CONTRIBUTING.md
yarn skills:sync     # regenerate the skill wrappers from each SKILL.md's frontmatter
yarn agents:check    # fail if anything has drifted
```

**Skills carry the parts that must not vary.** `author-spec` pauses at four review gates and
refuses to draft ahead of an unapproved one — because a model that writes requirements,
design and tasks in one pass has propagated its first mistake through all three.
`implement-task` will not commit, push or open an MR without approval for that specific
action. `review-mr` drafts every finding and posts nothing without per-item approval. `release-mr` refuses to promote `dev` → `prod`, because a
version reaches production by having been in `test`. `fix-security-vulnerabilities` will not
report a fix as done without a clean re-audit. Those are the properties that make an agent
safe to point at someone else's merge request or at a production version pin — and they are
exactly the ones that erode when the procedure is improvised each time.

**Hooks catch what a rule cannot.** A rule that says "never push to main" is read once at the
start of a session; a `PreToolUse` hook refuses the command every time. Five of them run here:
credential and token guards, a protected-branch guard, a docs-index staleness notice, a
git-ops overlay build check, and a docs delivery gate that turns "we should document this"
into a step the agent has to answer for. They are plain Node scripts reading JSON on stdin, wired for
Claude Code in `.claude/settings.json` and portable to anything else that can run a command on
a tool event.

> **⚠ Hooks are code that runs on tool calls, and `.claude/settings.json` is version-controlled.**
> The same review habit that applies to `.vscode/tasks.json` and `.githooks/` applies here:
> treat a diff to it like a diff to a deploy script, and keep every hook a one-line call into a
> tracked script under `scripts/hooks/` so the real logic goes through normal code review.

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

# Documentation Hub

Shared team knowledge base covering architecture decisions, onboarding, business
flows, and cross-service conventions.

This directory is also the **primary corpus** for the workspace's AI context
layer: an agent connected to the [MCP server](../mcp/README.md) can locate any
section here with `docs_map` (always available) or `docs_search` (hybrid
semantic + keyword retrieval). See
[Hybrid RAG over the Team Documentation](./architecture/docs-rag.md) for how that
works and why it is shaped the way it is.

---

## Directories

Ordered by how they age, which is also how they should be read.

**Reference — describes the system as it is today, and is kept current.**

- [architecture](./architecture/README.md) — Technical designs, decisions,
  conventions, and the approaches to follow.
- [business](./business/README.md) — Business flows and domain processes from the
  user's perspective: what the project is *for*.
- [guides](./guides/README.md) — Onboarding, local setup, tool configuration, and
  operational runbooks.

**Records — true as of a date, and deliberately not updated afterwards.**

- [incidents](./incidents/README.md) — Security and production incidents: what
  happened, whether it reached us, and what each person has to run.
- [release](./release/README.md) — Per-release runbooks for one-off operations
  that have to happen inside a deployment window: migrations, backfills, index
  builds. The version promotion itself is not here — that is
  [`infra/git-ops`](../infra/git-ops/README.md) and the
  [`release-mr`](../.ai/skills/release-mr/SKILL.md) skill.
- [spikes](./spikes/README.md) — Investigations, audits and one-off analyses. A
  question, a verdict, and the conditions under which the verdict expires.
- [knowledge-sharing](./knowledge-sharing/README.md) — Long-form write-ups from
  demos and deep dives, aimed at teaching a teammate rather than answering a
  lookup.

**Intent — describes what is planned, and is kept out of the search index.**

- [SPECs](./SPECs/README.md) — Feature specifications. The one directory here
  **excluded from the search index**, and the README explains why that matters
  more than it sounds.

A record and a reference doc answer differently, and the difference is worth
keeping. "How does tracing work" is a reference question; "why is the orders
collection sharded that way" is answered by the release runbook that resharded
it. Putting either in the other's directory is how a doc stops being maintained
without anyone noticing.

## Start here

| If you are… | Read |
|---|---|
| New to the workspace | [Onboarding](./guides/onboarding.md) |
| Debugging something across services | [Tracing a Request](./guides/tracing-a-request.md) |
| Wondering how tracing works, or why it is so small | [Distributed Tracing](./architecture/distributed-tracing.md) |
| Setting up the AI tooling | [MCP Server Guide](./guides/mcp-server.md) |
| Wondering how the agent finds anything | [Hybrid RAG design](./architecture/docs-rag.md) |
| Writing or reading a feature spec | [SPECs](./SPECs/README.md) |
| Fixing a broken docs index | [Docs Search Operations](./guides/docs-rag-operations.md) |
| Wondering what rebuilds the index | [Workspace Automation](./guides/workspace-automation.md) |
| Checking search still returns good answers | [Evaluating Retrieval Quality](./guides/docs-rag-evaluation.md) |
| Choosing how to run Qdrant | [Running Qdrant](./guides/qdrant-runtimes.md) |
| Preparing a release | [`release-mr` skill](../.ai/skills/release-mr/SKILL.md) · [Release runbooks](./release/README.md) |
| Working out what is deployed where | [git-ops](../infra/git-ops/README.md) |
| Looking for the team's conventions | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Wondering what the agent can already do for you | [Skills](../.ai/skills/README.md) |

## Writing docs that retrieve well

The retrieval layer reads the real files on every ingest, so there is no index
to keep in sync — but how a document is *written* still decides whether it can
be found:

- **Headings are chunk boundaries.** Every chunk carries its full heading path
  (`H1 > H2 > H3`) into its embedding, so a descriptive heading does more for
  retrieval than any amount of keyword stuffing in the body.
- **One topic per section.** A section covering three things embeds as the
  average of three things and ranks first for none of them.
- **Spell out identifiers you want found.** The keyword half indexes
  `role:workspace:team_lead` as a whole token *and* as its parts. Mentioning the
  real value once beats describing it.
- **Tables and code blocks are never split**, so a table is a safe way to carry
  dense factual content — it always retrieves whole.
- **Date anything that expires.** A spike or an incident carries its date in the
  filename, and its verdict should read "as of March 2026, …" rather than as a
  timeless fact. Search cannot tell how old a chunk is; the prose has to.

**And what not to write here.** These directories describe *reality* — what the
system does today, or what was true on a stated date. Plans and proposals
describe *intent*, and they live in [SPECs](./SPECs/README.md), which is the one
part of `docs/` deliberately kept out of the index. Mixing the two is the fastest
way to make search untrustworthy: retrieval cannot tell a plan from a
description, so a proposal filed here will be answered as fact. When a spec
ships, move what is still true into these docs and leave the spec behind as the
decision record.

**Instructions to an agent are not documentation either.** The workspace rules
([`.ai/rules/`](../.ai/rules/README.md)) and skills
([`.ai/skills/`](../.ai/skills/README.md)) are also excluded from the index, for
a related reason: they are procedural text delivered by the agent runtime, and in
a ranked list they compete with these docs on the domain words they necessarily
contain. See the comment block in [`mcp/src/docs/sources.js`](../mcp/src/docs/sources.js).

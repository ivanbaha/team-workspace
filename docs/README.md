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

- [guides](./guides/README.md) — Onboarding, local setup, tool configuration, and
  operational runbooks.
- [business](./business/README.md) — Business flows and domain processes from the
  user's perspective: what the project is *for*.
- [architecture](./architecture/README.md) — Technical designs, decisions,
  conventions, and the approaches to follow.
- [SPECs](./SPECs/README.md) — Feature specifications (intent, not reality).
  The one directory here **excluded from the search index**, and the README
  explains why that matters more than it sounds.

## Start here

| If you are… | Read |
|---|---|
| New to the workspace | [Onboarding](./guides/onboarding.md) |
| Setting up the AI tooling | [MCP Server Guide](./guides/mcp-server.md) |
| Wondering how the agent finds anything | [Hybrid RAG design](./architecture/docs-rag.md) |
| Writing or reading a feature spec | [SPECs](./SPECs/README.md) |
| Fixing a broken docs index | [Docs Search Operations](./guides/docs-rag-operations.md) |
| Wondering what rebuilds the index | [Workspace Automation](./guides/workspace-automation.md) |
| Checking search still returns good answers | [Evaluating Retrieval Quality](./guides/docs-rag-evaluation.md) |
| Choosing how to run Qdrant | [Running Qdrant](./guides/qdrant-runtimes.md) |

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

**And what not to write here.** These directories describe *reality* — what the
system does today. Plans and proposals describe *intent*, and they live in
[SPECs](./SPECs/README.md), which is the one part of `docs/` deliberately kept
out of the index. Mixing the two is the fastest way to make search
untrustworthy: retrieval cannot tell a plan from a description, so a proposal
filed here will be answered as fact. When a spec ships, move what is still true
into these docs and leave the spec behind as the decision record.

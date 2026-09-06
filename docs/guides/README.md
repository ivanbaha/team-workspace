# Guides

Onboarding manuals, configuration procedures, setup tutorials, and operational
runbooks.

## Getting started

- [Local Onboarding](./onboarding.md) — Step-by-step setup for a new developer.
- [Workspace MCP Server](./mcp-server.md) — Run, configure, and connect the local
  MCP server to an AI assistant.

## Debugging

- [Tracing a Request](./tracing-a-request.md) — Following one request across
  every service that touched it: getting a trace id, assembling the call chain,
  and reading the result without drawing false conclusions from a heuristic.

## Operating the workspace

- [Workspace Automation](./workspace-automation.md) — The git hooks, daily setup
  guard, and change-aware rebuilds that keep the workspace and its search index
  current without anyone remembering to — plus why automatic tasks are a
  security surface worth auditing.
- [Docs Search Operations](./docs-rag-operations.md) — Diagnosing and repairing
  the `docs_search` index: health checks, symptom → cause, and recovery.
- [Evaluating Retrieval Quality](./docs-rag-evaluation.md) — The periodic check
  that search still returns *good answers*, not just well-formed ones. Retrieval
  degrades silently as a corpus grows; this is how you find out.
- [Running Qdrant](./qdrant-runtimes.md) — Docker, Podman, Colima, WSL
  containers, Apple containers, or an external instance. Pick what suits your
  team and platform.

## Background

- [Distributed Tracing](../architecture/distributed-tracing.md) — Why tracing is
  one header and one log field rather than a tracing stack, what that buys, and
  what it gives up.
- [Hybrid RAG design](../architecture/docs-rag.md) — Why the search layer is
  built the way it is, and — most importantly — what is deliberately kept
  **out** of the index.

# Architecture & Technical Design

Technical designs, system boundaries, shared conventions, and engineering
guidelines.

## Contents

- [Architecture Overview](./architecture.md) — High-level system architecture,
  service boundaries, and data flows.
- [API Contracts](./api-contracts.md) — Shared REST API naming, versioning, and
  error-handling standards.
- [Distributed Tracing](./distributed-tracing.md) — How one header and one log
  field let a request be followed across every service, with no tracing SDK,
  exporter, or collector — and an honest account of what that trades away.
- [Shared Cache](./shared-cache.md) — One cache server, three roles (owner,
  consumer, operator), a failure policy per operation, and the work queue and
  batch lock built on the same primitives.
- [Hybrid RAG over the Team Documentation](./docs-rag.md) — How the workspace
  makes its own docs searchable by an AI agent: hybrid dense + BM25 retrieval,
  blue-green index rebuilds, and the reliability engineering around them.

## Related guides

- [Tracing a Request](../guides/tracing-a-request.md) — the runbook for the
  tracing design above: getting an id, assembling the chain, and reading the
  result without drawing false conclusions.
- [Debugging the Cache](../guides/debugging-the-cache.md) — the runbook for the
  cache design above: stale entries, silent misses, dead invalidations.
- [Docs Search Operations](../guides/docs-rag-operations.md) — runbook for the
  index described above.
- [Evaluating Retrieval Quality](../guides/docs-rag-evaluation.md) — the periodic
  check that keeps it accurate as the corpus grows.
- [Workspace Automation](../guides/workspace-automation.md) — the five triggers
  that keep it current, and the security surface they create.
- [Running Qdrant](../guides/qdrant-runtimes.md) — container runtime options.

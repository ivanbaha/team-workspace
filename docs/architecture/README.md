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
- [Hybrid RAG over the Team Documentation](./docs-rag.md) — How the workspace
  makes its own docs searchable by an AI agent: hybrid dense + BM25 retrieval,
  blue-green index rebuilds, and the reliability engineering around them.

## Related guides

- [Tracing a Request](../guides/tracing-a-request.md) — the runbook for the
  tracing design above: getting an id, assembling the chain, and reading the
  result without drawing false conclusions.
- [Docs Search Operations](../guides/docs-rag-operations.md) — runbook for the
  index described above.
- [Evaluating Retrieval Quality](../guides/docs-rag-evaluation.md) — the periodic
  check that keeps it accurate as the corpus grows.
- [Workspace Automation](../guides/workspace-automation.md) — the five triggers
  that keep it current, and the security surface they create.
- [Running Qdrant](../guides/qdrant-runtimes.md) — container runtime options.

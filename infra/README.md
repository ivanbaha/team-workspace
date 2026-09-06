# Infrastructure

Infrastructure configuration and GitOps resources for all environments.

---

## Structure

- [git-ops](./git-ops/README.md) — Kubernetes manifests and GitOps pipeline configuration (ArgoCD / Flux)

---

## Philosophy

Infrastructure is treated as code. All changes go through pull requests and pass automated linting (e.g. `kubeval`, `helm lint`) before merging.

Environment promotion follows the path: `dev -> test -> staging -> production`.

---

## Observability

Logs are the observability surface. Services write one JSON line per record to stdout; the
node-level log shipper forwards it; Loki indexes the pod labels. Nothing is injected into
application pods.

Because every line carries a `traceId`, one query returns a whole request across every service —
see [Distributed Tracing](../docs/architecture/distributed-tracing.md). The deployment-side
requirement is small but not optional: see
[required environment](./git-ops/README.md#required-environment-for-tracing).

---

## Tooling

- Kubernetes (k8s) for container orchestration
- Helm for templated manifests
- ArgoCD for GitOps continuous delivery
- Terraform for cloud resource provisioning

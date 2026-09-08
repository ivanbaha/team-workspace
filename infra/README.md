# Infrastructure

Infrastructure configuration and GitOps resources for all environments.

---

## Structure

- [git-ops](./git-ops/README.md) — Kubernetes manifests and GitOps pipeline configuration (ArgoCD / Flux)

---

## Philosophy

Infrastructure is treated as code. All changes go through merge requests and must build
(`kubectl kustomize`) before merging.

There are three environments, and promotion is one-directional:

```
dev  ──(promote)──▶  test  ──(promote)──▶  prod
```

`dev` tracks `main` automatically and is allowed to be unstable. `test` is the stable set QA
works against and changes only through a release MR. `prod` is deployed manually in a release
window, and only ever from a composition that has been in `test`.

The promotion is prepared by the [`release-mr`](../.ai/skills/release-mr/SKILL.md) skill; the
rule behind it is in
[`.ai/rules/environments-and-ownership.md`](../.ai/rules/environments-and-ownership.md).

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
- Kustomize for environment overlays — one base, three overlays, no templating language
- ArgoCD for GitOps continuous delivery
- Terraform for cloud resource provisioning

```bash
yarn gitops:versions     # what is pinned in each environment, drift marked
yarn gitops:validate     # do all three overlays still build?
```

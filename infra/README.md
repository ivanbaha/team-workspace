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

## Tooling

- Kubernetes (k8s) for container orchestration
- Helm for templated manifests
- ArgoCD for GitOps continuous delivery
- Terraform for cloud resource provisioning

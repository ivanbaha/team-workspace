# git-ops

GitOps deployment manifests for all environments. Changes to this directory trigger automated deployments via ArgoCD.

---

## Structure

```txt
git-ops/
  base/                     — Shared base Kubernetes manifests
    deployment.yaml
    service.yaml
    ingress.yaml
  overlays/
    dev/                    — Dev environment patches
    test/                   — Test environment patches (see also test-env-global)
    staging/                — Staging environment patches
    production/             — Production environment patches
```

---

## Environments

| Env        | Cluster         | Auto-deploy on merge     |
| ---------- | --------------- | ------------------------ |
| dev        | dev-cluster     | Yes (from `main`)        |
| test       | test-cluster    | Yes (from `main`)        |
| staging    | staging-cluster | Yes (from `release/*`)   |
| production | prod-cluster    | Manual approval required |

---

## Deploying

Changes to overlays trigger ArgoCD sync automatically. For production deployments, a manual sync approval is required in the ArgoCD UI.

For the shared test environment configuration, see [test-env-global](../apps/test-env-global/README.md).

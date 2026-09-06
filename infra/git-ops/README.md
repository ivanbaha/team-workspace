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

## Required environment for tracing

Every service deployment must set these, or its log lines cannot be correlated:

```yaml
env:
  # MUST equal the container name. It becomes `serviceName` on every log line AND the outbound
  # User-Agent, which is the only thing that creates a caller -> callee edge in a trace. When it
  # disagrees with the container name, the service's calls appear as orphaned roots — and every
  # individual log line still looks perfectly correct, which is what makes it hard to spot.
  - name: DEPLOYMENT_NAME
    value: users-service
  # Identifies the replica, so you can tell "one pod misbehaving" from "the whole deployment".
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: LOGGER_LEVEL
    value: info
  - name: LOGGER_FORMAT
    value: json        # `pretty` is not machine-parseable — never deploy it
```

`LOGGER_REQUEST_LOGGING` defaults to `compact`, which is what traces need, so it does not have to be
set. Setting it to `off` keeps the trace id on application log lines but removes the request/response
pair — the chain loses its edges, status codes and durations.

Nothing else is added to the pod. No sidecar, no agent, no exporter: services write JSON to stdout
and the node-level log shipper does the rest.

See [Distributed Tracing](../../docs/architecture/distributed-tracing.md).

---

## Deploying

Changes to overlays trigger ArgoCD sync automatically. For production deployments, a manual sync approval is required in the ArgoCD UI.

For the shared test environment configuration, see the [infra overview](../README.md).

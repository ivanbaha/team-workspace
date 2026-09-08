# git-ops

**The record of what is deployed where.** A service's deployed version is the `newTag` pinned
for its image in an environment's overlay — there is no separate release registry, and no
place a version can be "deployed" without appearing here.

Changes to this directory trigger deployment: automatically for `dev` and `test`, and by
manual sync for `prod`.

---

## Structure

```txt
git-ops/
  base/                           — environment-agnostic definition of every service
    kustomization.yaml
    <service>/
      deployment.yaml             — container spec, probes, resources, tracing env
      service.yaml
      kustomization.yaml
  overlays/
    dev/
      kustomization.yaml          — namespace, pinned versions, config generators
      config/<service>.env        — this environment's configuration, KEY=value
    test/
      …
    prod/
      kustomization.yaml
      config/<service>.env
      replicas.yaml               — production runs more replicas than dev/test
```

`base/` carries no namespace, no real image tag and no configuration values. Its images sit
on a placeholder `0.0.0-base` tag, so an overlay that forgets to pin a service fails to pull
rather than silently deploying whatever `:latest` happens to be — **a missing pin should be
loud.**

---

## The three environments

| Env | Namespace | What it is | How it changes |
|---|---|---|---|
| **dev** | `team-workspace-dev` | Unstable integration | CI rewrites the tags on every merge to `main` |
| **test** | `team-workspace-test` | The stable set QA works against | Only by a release MR promoting from `dev` |
| **prod** | `team-workspace-prod` | Production | Only by a release MR promoting from `test`, synced manually in a release window |

Promotion is one-directional and does not skip:

```
dev  ──(promote)──▶  test  ──(promote)──▶  prod
```

**A version reaches production by having been in `test`.** A hotfix is a normal promotion
whose release happens to contain one service — not one that skips a step. The full rule is in
[`.ai/rules/environments-and-ownership.md`](../../.ai/rules/environments-and-ownership.md).

`dev` is *allowed* to be broken; that is what it is for. `test` being broken is a release
blocker, because it is what QA works against.

---

## Doing a promotion

Use the [`release-mr`](../../.ai/skills/release-mr/SKILL.md) skill — it reads the source
overlay, reports the version and configuration deltas for approval, writes the target,
validates every overlay builds, and opens the MR.

The scripts behind it also stand alone:

```bash
yarn gitops:versions          # every environment, side by side, drift marked
yarn gitops:validate          # do all three overlays still build?

node .ai/skills/release-mr/scripts/diff-envs.mjs --to=test        # what a promotion carries
node .ai/skills/release-mr/scripts/apply-versions.mjs --to=test --dry-run
```

**Versions are copied mechanically; configuration is not.** `apply-versions.mjs` touches only
`newTag:` lines, so a promotion diff is one line per service and reviewable at a glance.
Configuration deltas are reported by `diff-envs.mjs` and applied by hand, because the value
that is right in the source environment is frequently wrong in the target — a URL, a feature
flag, a cache TTL sized for different load.

---

## Configuration

Per-environment values live in `overlays/<env>/config/<service>.env` as plain `KEY=value`
lines, turned into a ConfigMap by that overlay's `configMapGenerator` and reaching the
container through `envFrom`.

Plain env files rather than inline YAML for one reason: **a promotion diff has to be
readable.** A line-oriented file diffs line by line; a YAML block re-serialised by a tool
diffs as a rewritten block.

`generatorOptions.disableNameSuffixHash: true` is set for the same reason. Without it,
kustomize appends a content hash to each ConfigMap name and rewrites every `envFrom`
reference — safer in general, since it forces a roll when config changes, but it makes every
service show a changed reference whether or not its values moved.

**A new environment variable must be added to every overlay the service runs in**, in the
same change as the code that reads it. Otherwise the service starts and fails at runtime in
whichever environment was missed, and the MR itself looks perfect.

---

## Required environment for tracing

Every service deployment must set these, or its log lines cannot be correlated. They are in
`base/<service>/deployment.yaml` and should not be removed per environment:

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
```

And in each overlay's `config/<service>.env`:

```ini
LOGGER_LEVEL=info
LOGGER_FORMAT=json        # `pretty` is not machine-parseable — never deploy it
```

`LOGGER_REQUEST_LOGGING` defaults to `compact`, which is what traces need, so it does not have
to be set. Setting it to `off` keeps the trace id on application log lines but removes the
request/response pair — the chain loses its edges, status codes and durations.

Nothing else is added to the pod. No sidecar, no agent, no exporter: services write JSON to
stdout and the node-level log shipper does the rest. See
[Distributed Tracing](../../docs/architecture/distributed-tracing.md).

---

## Validating a change

Never commit an overlay you have not built. Hand-edited kustomize YAML fails in a specific
way: the diff looks entirely reasonable and the build does not work — a config file removed
but still referenced by a generator, a patch naming a resource that no longer exists, one
wrong indent level.

```bash
yarn gitops:validate
# or directly
kubectl kustomize infra/git-ops/overlays/test > /dev/null
```

A `PostToolUse` hook (`scripts/hooks/validate-overlay.mjs`) runs this automatically after an
agent edits anything here, so a break surfaces at the edit rather than at sync time.

---

## Release-window operations

Anything a release needs that is *not* a version bump — a data migration, a backfill, an index
build — belongs in a runbook under [`docs/release/`](../../docs/release/README.md), written
before the window rather than improvised during it. A version promotion is reversible in about
a minute; a half-finished migration is not.

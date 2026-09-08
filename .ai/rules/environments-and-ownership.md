# Environments & Ownership

What each environment means, how a version moves between them, and which repos in this
workspace we own.

---

## The three environments

| Env | What it is | Who deploys | What may be there |
| --- | --- | --- | --- |
| **dev** | Unstable integration. Whatever is on `main`. | CI, automatically on every merge | Anything that built |
| **test** | Stable set for QA. Changes only when a release is promoted. | Merge of a `release/*` MR into `main` of `infra/git-ops` | Version compositions someone deliberately chose |
| **prod** | Production. | Manual, inside a release window | Only a composition QA has signed off in `test` |

They are three overlays of one base in [`infra/git-ops`](../../infra/git-ops/README.md), and
a service's deployed version is the `newTag` pinned for its image in that overlay's
`kustomization.yaml`. There is no separate release registry: **the git-ops repo is the
record of what is deployed where.**

### Promotion is one-directional

```txt
dev  ──(promote)──▶  test  ──(promote)──▶  prod
```

- **Never** copy a version into `prod` that has not been in `test`.
- **Never** promote from `dev` straight to `prod`, even for a one-line fix. A hotfix is a
  normal promotion through `test`; what makes it a hotfix is that it is the only thing in
  the release, not that it skips a step.
- A promotion carries **versions and the configuration deltas that go with them**. A config
  change that reached `test` and was never promoted is a change that will surprise someone
  on release night.

Both promotions are done by the [`release-mr`](../skills/release-mr/SKILL.md) skill, which
reads the source overlay, writes the target overlay, diffs the non-version configuration,
validates the build, and opens the MR.

### What `dev` being unstable means in practice

`dev` is allowed to be broken. Do not treat a red `dev` as a release blocker on its own,
and do not "fix" `dev` by pinning it backwards — it tracks `main` on purpose, and pinning it
hides the breakage instead of surfacing it.

`test` being broken **is** a release blocker, because `test` is what QA works against.

---

## Which repos are ours

The workspace clones repos from several sources. Only the ones we own are subject to these
rules.

### Ours

- Everything listed in [`configs/workspace-repos.json`](../../configs/workspace-repos.json)
  under `frontends`, `backends`, and `libs`.
- The workspace (meta) repo itself — `docs/`, `scripts/`, `configs/`, `infra/`, `mcp/`,
  `.ai/`.

Our standards, our conventions, our migrations.

### Not ours

Repos cloned for reference or occasional cross-team contribution. When you work in one:

- **Review correctness, contracts, and the impact on our services.** That is legitimate and
  welcome.
- **Do not apply our standards, conventions or migration plans to them.** Their repo, their
  house style.
- **Do not use them as examples of how our services work**, and do not cite them in our
  architecture docs.
- Respect their commit and hook conventions rather than ours.

When a repo's ownership is unclear, ask before changing anything in it. Getting this wrong
costs another team a cleanup and costs us their goodwill.

---

## Configuration lives in git-ops, not in the service

A service reads its configuration from the environment. The values for each environment are
in that environment's overlay, and nowhere else.

- A **new environment variable** must be added to every overlay the service runs in, in the
  same change that introduces the code reading it — or the service starts and fails at
  runtime in whichever environment was missed.
- A **removed** variable is removed from every overlay, so the next promotion diff does not
  keep re-proposing it.
- Tracing requires `DEPLOYMENT_NAME`, `POD_NAME`, `LOGGER_LEVEL` and `LOGGER_FORMAT` on
  every deployment. `DEPLOYMENT_NAME` **must equal the container name** — when it does not,
  the service's calls appear as orphaned roots in a trace and every individual log line
  still looks perfectly correct, which is what makes it hard to spot. See
  [`infra/git-ops/README.md`](../../infra/git-ops/README.md#required-environment-for-tracing).

Never hardcode an environment-specific value in a service. Never read one environment's
config to decide another's behaviour.

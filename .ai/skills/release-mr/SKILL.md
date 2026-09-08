---
name: release-mr
description: "Prepare a release merge request that promotes service versions between environments in infra/git-ops — dev → test, or test → prod. Reads the pinned versions from the source overlay, reports the version and configuration deltas for approval, writes the target overlay, validates that every overlay still builds, and opens the MR on a release/* branch. Use when the user says 'cut a release', 'promote to test', 'prepare the prod release', 'release MR', or names a release version."
---

# Release MR

You are preparing a release. A release in this workspace is **a change to
[`infra/git-ops`](../../../infra/git-ops/README.md) and nothing else**: the git-ops repo is
the record of what is deployed where, and a service's deployed version is the `newTag`
pinned for its image in an environment's overlay.

Three environments, one direction:

```txt
dev  ──(promote)──▶  test  ──(promote)──▶  prod
```

| Env | What it is | How it changes |
| --- | --- | --- |
| **dev** | Unstable integration | CI rewrites the tags on every merge to `main`. Never promoted *into*. |
| **test** | Stable set QA works against | Only by a release MR from `dev` |
| **prod** | Production | Only by a release MR from `test`, merged in a release window |

Two properties define this skill:

- **Versions are mechanical; configuration is not.** The scripts copy version pins without
  asking. Every configuration difference is presented for a decision, because the value that
  is right in the source environment is frequently wrong in the target.
- **Nothing is committed, pushed, or merged without explicit approval for that action.**
  A release MR to `prod` changes what customers run.

Scripts live in `.ai/skills/release-mr/scripts/`. Scratch output goes to
`.ai/skills/release-mr/output/`, which is git-ignored — never commit it.

---

## Step 1: Establish the target and the version

Ask for, or confirm from what the user said:

- **Target environment** — `test` or `prod`. The source follows from it (`dev` → `test`,
  `test` → `prod`) and does not need to be asked for.
- **Release version** — the label for the release branch and MR title, e.g. `26.3.2`.

**Never promote `dev` → `prod`.** The scripts refuse it without `--force`, and the rule is in
[`.ai/rules/environments-and-ownership.md`](../../rules/environments-and-ownership.md): a
version reaches production by having been in `test`. A hotfix is a normal promotion whose
release happens to contain one service — not one that skips a step. If the user insists,
state plainly what has not been tested and let them decide.

Then get oriented — this one command shows how far the environments have drifted, which is
usually the fastest way to spot that something unexpected is in flight:

```bash
node .ai/skills/release-mr/scripts/read-versions.mjs --all
```

---

## Step 2: Prepare the branch

Work in the workspace's own `infra/git-ops` — it is part of the meta repo, not a separate
clone.

```bash
git -C . status --porcelain infra/git-ops
```

**If there are uncommitted changes under `infra/git-ops`, stop and ask.** Someone may have a
release half-prepared. Never stash or discard it to make room.

Then branch from an up-to-date `main`:

```bash
git checkout main
git pull --ff-only
git checkout -b release/<version>
```

For a `prod` release the branch may already exist from an earlier round — check
`git branch -a | grep release/` first and check it out rather than creating a second one.
**Do not merge `main` into an existing release branch**; that pulls in everything that landed
since, which is exactly the composition QA did not test.

---

## Step 3: Report the delta and get approval

```bash
node .ai/skills/release-mr/scripts/diff-envs.mjs --to=<test|prod>
```

This prints two independent sections. Present **both** to the user before touching a file.

### Versions

Each service that would move, with the bump classified. Three rows always deserve a comment
from you rather than a table entry:

- **`MAJOR`** — say what the major bump is, from the service's changelog or commit range. A
  major that nobody noticed is the classic release-night failure.
- **`rollback`** — the target is *ahead* of the source. Something is wrong: either a hotfix
  went straight to the target and was never promoted forward, or the source was reverted.
  **Stop and resolve it** — promoting would silently undo the hotfix.
- **`new-service`** — a service pinned in the source but absent from the target. It needs its
  `config/<service>.env` created in the target overlay too, or it will not start.

### Configuration

Every key that differs structurally between the two overlays:

- `+ KEY=value (in <source>, absent in <target>)` — usually needs adding, because the code
  that reads it is in the versions you are about to promote. **Ask for the target's value**;
  do not copy the source's blindly.
- `- KEY=value (in <target>, absent in <source>)` — the source dropped it. Confirm whether it
  should be removed here too, or is genuinely target-only.
- `~ KEY: current → proposed` — a value difference on a key both sides have.

Keys listed as *environment-specific* (`NODE_ENV`, `LOGGER_LEVEL`, and the rest of
`ENV_SPECIFIC_KEYS` in `scripts/lib/overlays.mjs`) are reported and ignored on purpose. If a
release keeps surfacing a key that is legitimately per-environment, add it to that set rather
than approving it every time.

### The approval gate

Present the version table and the configuration list, then ask:

> **Approve this promotion.** Versions: all, or name the services to hold back.
> Configuration: for each `+`/`-`/`~` item, apply it, skip it, or give me the value to use in
> `<target>`.

Wait for an answer. "Looks good" covers the versions; the configuration items each need a
decision, so ask again for anything left unanswered.

---

## Step 4: Apply

Versions first — this is the mechanical half:

```bash
# everything the user approved
node .ai/skills/release-mr/scripts/apply-versions.mjs --to=<target>

# or holding some back
node .ai/skills/release-mr/scripts/apply-versions.mjs --to=<target> --exclude=products-service
```

Add `--dry-run` first if the selection is at all complicated. Only `newTag:` lines change, so
the resulting diff is one line per promoted service.

Then apply the approved **configuration** changes by editing
`infra/git-ops/overlays/<target>/config/<service>.env` **by hand**. There is deliberately no
script for this: each edit was an individual decision in Step 3, and a script would invite
applying them in bulk.

Keep the `.env` files' comment headers intact, and keep keys in the order they already have —
a reordered file makes the next release's diff unreadable for no benefit.

---

## Step 5: Validate the build

```bash
node .ai/skills/release-mr/scripts/validate-overlays.mjs
```

Every overlay must build, not just the one you edited — a change under `base/` or a shared
config affects all three. The script also fails when an overlay builds but produces zero
objects, or when an image is still on the `0.0.0-base` placeholder tag; both are silent
failures that a plain exit-code check would pass.

**Do not commit an overlay that fails to build.** If `kustomize`/`kubectl` is unavailable,
say so and hand the command to the operator — do not commit unvalidated.

Then read the diff yourself:

```bash
git diff infra/git-ops
```

It should be *only* `newTag:` lines and the config keys that were approved. Anything else —
a reformatted block, a reordered generator, a stray whitespace change — means an editor or a
formatter touched the file. Revert it; release diffs are read by people under time pressure.

---

## Step 6: Commit, push, and open the MR

Ask for the task code if the user has not given one.

```bash
git add infra/git-ops
git commit -m "chore(<TASK-CODE>): promoted <n> services to <target> for release <version>"
```

`chore` is the right type here, and deliberately so: `infra/git-ops` is not a semver-published
artifact, so a promotion has no version of its own to bump — the version being released is the
*composition*, which lives in the overlay. Typing it `feat` would be claiming a release of the
manifests. See [`git-workflow.md`](../../rules/git-workflow.md). Then push with the MCP tool,
never raw `git push`:

```txt
gitlab_safe_push { project_id: <workspace repo id>, branch: "release/<version>", working_dir: <workspace root> }
```

Then `gitlab_create_mr`:

- `source_branch`: `release/<version>`
- `target_branch`: `main`
- `title`: `chore(<TASK-CODE>): <target> release <version>`
- `remove_source_branch`: `true` for a `test` release; **`false`** for `prod`, where the
  branch is often the base for a follow-up round.

### The description

A release MR is the one place the "explain the goal, don't inventory the diff" rule does
**not** apply. The version table *is* the substance of the change — a reviewer approving a
production release needs to see exactly what moves, and a prose summary of it is strictly
worse. Use:

```markdown
Promotes <n> services from `<source>` to `<target>` for release <version>.

| Service | <target> now | → | Bump |
|---|---|---|---|
| users-service | 1.8.3 | 1.9.0 | minor |
| products-service | 2.4.0 | 2.4.1 | patch |

**Configuration**

- `products-service`: added `FEATURE_PRODUCT_REVIEWS=false` (enabled in dev; off here until QA signs off)

**Held back**

- `host-frontend` stays on 3.1.4 — 3.2.0 needs the API in users-service 1.9.0, promoting together next round

**Deploy note**

<Anything about ordering, a migration that must run first, or a service that is inert until another lands.>

---

Jira: [<TASK-CODE>](<url>)
```

Always include **Held back** when anything was excluded — the absence of a service from the
table otherwise looks like an oversight, and the next release inherits the question.

Report the MR URL. **Do not approve or merge it**, whatever the user's hurry: a release MR is
reviewed by someone who did not prepare it.

---

## Step 7: After the merge

- **`test`** — CI syncs on merge. Confirm the pods rolled and tell QA which composition is up.
- **`prod`** — merging is not deploying. The deploy is a manual sync in the release window.
  Say explicitly that the MR is merged and the deploy is still pending, so nobody reads a
  green MR as "shipped".

If the release needs one-off operations inside the window — a data migration, a backfill, an
index build — they belong in a runbook under [`docs/release/`](../../../docs/release/README.md),
written **before** the window, not improvised during it.

---

## Never

- Promote `dev` → `prod`, or write a version into `prod` that was never in `test`.
- Copy a configuration value between environments without asking. Versions are mechanical;
  configuration is a decision every time.
- Merge `main` into an existing release branch.
- Commit an overlay you have not built.
- Commit, push, or create the MR without explicit approval for that specific action.
- Approve or merge your own release MR.
- Edit `overlays/dev/kustomization.yaml` tags by hand — CI owns them and overwrites the next
  time anything merges.
- Commit anything from `.ai/skills/release-mr/output/`.

# scripts

Workspace-level automation. Not application code — these handle developer setup,
repo synchronisation, and keeping the AI context layer current.

Full behavioural reference: [Workspace Automation](../docs/guides/workspace-automation.md).

---

## Scripts

| File | Command | Description |
|---|---|---|
| `setup-workspace.mjs` | `yarn setup` | Install hooks, clone (and optionally pull) repos, rebuild the docs index |
| `update-workspace.mjs` | `yarn update` | Pull all nested repos; clone any that are missing |
| `install-git-hooks.mjs` | `yarn hooks:install` | Point git at `.githooks/` and repair the executable bit |
| `daily-setup-guard.mjs` | `yarn daily-setup` | Once-per-day flow, run automatically on folder open |
| `lib/repo-sync.mjs` | — | Shared clone/pull logic + docs-change detection |
| `lib/docs-ingest.mjs` | — | Shared rebuild decision + foreground ingest runner |
| `lib/doc-markdown.mjs` | — | The single definition of "documentation markdown" |

The `lib/` modules exist so the hooks and the setup scripts share one
implementation. In particular `doc-markdown.mjs` holds the CHANGELOG exclusion:
if the hook and the setup disagreed about what counts as a doc, one would
reindex for files the other ignored, and nobody would notice until they measured
it.

---

## setup-workspace.mjs

Run when joining the project or bootstrapping a fresh clone. Also the engine
behind the daily guard.

1. Install/repair the git hooks.
2. Clone every repo in [configs/workspace-repos.json](../configs/workspace-repos.json)
   that is missing; with `--pull`, also pull the ones already on disk.
3. Rebuild the docs search index **once** at the end, if the flags warrant it.

Step 3 is why this script owns the rebuild rather than leaving it to the hooks:
a bulk sync touches every repo, and every pull hook would otherwise schedule its
own ingest. `WS_SETUP_ACTIVE=1` is exported before the first git call and
inherited by every child, so those hooks stand down.

### Flags

| Flag | Behaviour |
|---|---|
| *(none)* | always rebuild the docs index |
| `--pull` | also pull repos that already exist |
| `--skip-docs` | never rebuild |
| `--docs-if-changed` | rebuild only if a pulled/cloned repo moved docs markdown |
| `--external-changed` | seed "docs changed = true" (the guard's own meta-repo pull) |
| `--docs-dry-run` | print the decision without paying the multi-minute cost |

```txt
$ yarn setup --pull --docs-if-changed --docs-dry-run

[1/3] Installing git hooks...
git core.hooksPath -> .githooks

[2/3] Cloning missing and pulling existing repos...

[frontends]
  PULL  users-frontend
  OK    users-frontend (12 file(s) changed, docs markdown among them)

Done. Pulled: 5  Cloned: 0  Skipped: 0  Failed: 0
Docs markdown changed in: users-frontend

[3/3] Docs index...
      Decision: REBUILD — --docs-if-changed and docs markdown moved in at least one repo
      --docs-dry-run: stopping here without rebuilding.
```

`--docs-dry-run` earns its place: a change-detection heuristic you cannot
inspect without waiting 20 minutes is a heuristic nobody debugs.

---

## update-workspace.mjs

Day-to-day sync of nested repos. Repo exists → `git pull --ff-only`; repo
missing → `git clone`.

This script deliberately does **not** rebuild the docs index. The hook that
calls it decides that separately, based on whether documentation markdown
actually moved. Keeping the concerns apart is what lets `yarn update` stay a
fast, predictable operation.

---

## daily-setup-guard.mjs

Runs on **every** folder open via [.vscode/tasks.json](../.vscode/tasks.json),
and gates the real work to once per calendar day via `.git/last-daily-setup`.

The guard exists because the useful trigger — "the first time someone starts
work today" — is not an event any tool emits. Folder-open is the closest proxy
and fires a dozen times a day, so the gate is the whole design.

Today's date is stamped **only on success**, so a failed run retries on the next
folder open rather than skipping a broken day entirely.

```bash
yarn daily-setup           # respects today's stamp
yarn daily-setup --force   # run anyway
tail -40 .git/daily-setup.log
```

> Requires `"task.allowAutomaticTasks": "on"` in **user** settings. It cannot be
> enabled from workspace settings, by design. Without it the task never runs and
> the automation looks broken with no error anywhere.

---

## Git hooks

Tracked in [`.githooks/`](../.githooks/), activated by
`git config core.hooksPath .githooks` (done by `yarn hooks:install` and by
`yarn setup`).

| Hook | Fires on |
|---|---|
| `post-merge` | `git pull` / `git merge` that brought commits |
| `post-rewrite` | `git pull --rebase` — a rebase replays commits, so `post-merge` never fires |
| `post-update.mjs` | The shared implementation both delegate to |

`post-rewrite` is the one teams forget. On a rebase-by-default team a
`post-merge`-only setup never runs, and the automation looks silently broken.

The shared implementation syncs nested repos, then rebuilds the docs index
**only** if documentation markdown actually changed — guarded by
`WS_SETUP_ACTIVE`, a 30-minute-stale `.git/docs-ingest.lock`, and a preflight
check that skips with an actionable hint when the feature is off, deps are
missing, or Qdrant is down. A hook never fails the git command that triggered
it, and the rebuild is detached so it outlives the terminal.

```bash
tail -f .git/hooks-post-update.log   # a background ingest's only record
```

---

## Adding a New Repo to the Workspace

Nested repos are declared in
[configs/workspace-repos.json](../configs/workspace-repos.json), grouped by
category (`frontends`, `backends`, `libs`). Add an entry:

```jsonc
{
  "name": "orders-service",              // directory name AND the label in output
  "description": "REST API — Orders domain",
  "git": "git@github.com:your-org/tw-orders-service.git",
  "path": "./backend"                    // parent directory, relative to the workspace root
}
```

Then clone it:

```bash
yarn setup     # clones anything missing; existing repos are untouched
```

Three things to know:

- **`name` is the directory name.** The repo is cloned to `<path>/<name>`,
  regardless of what the remote is called — so `tw-orders-service.git` becomes
  `backend/orders-service`.
- **Entries still pointing at `your-org` are treated as placeholders** and
  skipped with a `TODO` notice rather than failing setup. That is what lets a
  fresh clone of this example workspace run green before anyone has filled in
  real remotes.
- **A new service's README is indexed automatically.** The docs corpus uses
  `depth: 1` on `frontend/`, `backend/` and `libs/`, so the next ingest picks up
  `backend/orders-service/README.md` with no edit to `sources.js`. Deeper
  per-module READMEs are not — add those explicitly if they carry knowledge
  worth retrieving. See
  [corpus hygiene](../docs/architecture/docs-rag.md#the-corpus--declared-not-discovered).

To **remove** a repo, delete its entry and delete the directory. Nothing else
references it; the next ingest drops its content from the index automatically,
because each rebuild indexes exactly what exists rather than diffing.

---

## Adding a New Script

Add the `.mjs` file here and register it in the `"scripts"` section of the root
[package.json](../package.json). If it needs to decide what counts as
documentation, import `lib/doc-markdown.mjs` rather than re-implementing the
rule.

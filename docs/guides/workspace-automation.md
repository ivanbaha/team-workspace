# Workspace Automation

How the workspace keeps itself — and the AI agent's search index — current
without anyone remembering to do it.

Related: [Hybrid RAG design](../architecture/docs-rag.md) ·
[Docs Search Operations](./docs-rag-operations.md) ·
[Evaluating Retrieval Quality](./docs-rag-evaluation.md)

> **Automation runs code on your machine without asking.** If you enable the
> `folderOpen` task, read
> [Security: automation is code execution](#security-automation-is-code-execution)
> and adopt the audit habit it describes.

---

## What runs automatically

| Trigger | Fires when | Blocking? | Guard |
|---|---|---|---|
| **1. Startup self-heal** (`mcp/src/docs/bootstrap.js`) | MCP server starts and the index is missing/empty | no — background child | health check on both halves |
| **2. Daily staleness** (`bootstrap.js` + `ingest-state.js`) | MCP server starts and last success > 24 h | no — background child | marker file, success-only |
| **3. Git `post-merge` / `post-rewrite`** | `git pull` brought docs markdown | no — detached process | `docs-ingest.lock`, `WS_SETUP_ACTIVE` |
| **4. Daily workspace setup** (`folderOpen` task) | first folder open of the day, if any repo's markdown changed | yes, within setup | date marker, `--docs-if-changed` |
| **5. Manual** | `yarn docs:ingest` | yes | — |

Every trigger runs the *same* `mcp/scripts/ingest-docs.mjs`. None of them
special-cases anything; they differ only in when they fire and how they decide
it is worth it.

Because rebuilds are [blue-green](../architecture/docs-rag.md#blue-green-index-updates--zero-downtime-re-indexing),
any of these can fire while someone is actively searching. That is what makes
"just trigger it from five places" a safe design rather than a reckless one.

---

## 1–2. Startup self-heal and daily staleness

`bootstrapDocsSearch()` runs on MCP server start when `DOCS_SEARCH_ENABLED=true`.
It starts the Qdrant container, validates the index, and rebuilds in the
background if the index is missing/empty or the daily refresh is due.

**Validating eagerly instead of trusting the timer is the design point.** The
timer says "we ingested successfully 3 hours ago", which is true and useless if
someone has since deleted `.qdrant-storage/` or pruned the Docker volume.
Without the health check, the tool returns *zero results with a success-shaped
response* until tomorrow — the exact silent failure the whole design exists to
avoid.

Health means **both** halves are present, because either one alone produces
wrong answers rather than errors:

- the Qdrant alias resolves to a collection with `points_count > 0`;
- the local BM25 model file exists.

`isIndexReady()` is specifically *not* a ping. An alias pointing at the empty
bootstrap collection is "reachable" and completely useless.

The rebuild is spawned as a **child process**, and its `stdio` must **not** be
inherited: the parent's stdout *is* the MCP protocol channel, and one stray
progress line on it corrupts the JSON-RPC stream and takes down the whole server,
every tool with it. Child output is piped and re-emitted through the logger,
which writes to stderr. **Any MCP server that spawns children has this
constraint.**

Only `markIngestSuccess()` writes the state file, and only after a clean exit. A
failed run leaves the marker untouched and **retries on the next start** instead
of being silently skipped for 24 hours. A corrupt or unreadable marker is treated
as stale, not as an error: fail toward doing the work.

---

## 3. Git hooks — change-aware rebuild on pull

The daily timer is a freshness *ceiling*, not a change trigger. Between daily
runs people pull the docs constantly, and a 24-hour-stale index right after
pulling a rewritten architecture doc is exactly when it matters.

Two tracked hooks close that gap, both delegating to `.githooks/post-update.mjs`:

| Hook | Fires on |
|---|---|
| `post-merge` | `git pull` / `git merge` that brought commits |
| `post-rewrite` | `git pull --rebase` (rebase replays commits, so `post-merge` never fires) |

**`post-rewrite` is the one everybody forgets.** If your team rebases on pull, a
`post-merge`-only hook never runs and the automation looks like it silently
doesn't work.

Install (or repair) them:

```bash
yarn hooks:install
```

This sets `core.hooksPath` to `.githooks/` and restores the executable bit if a
checkout lost it — git silently ignores a non-executable hook, which turns the
whole automation into a no-op with no error anywhere.

### The decision sequence

```
1. Nothing changed?                              → exit
2. package.json / yarn.lock moved?               → yarn install
3. Nested repos configured?                      → sync them
4. No documentation markdown changed?            → exit
5. WS_SETUP_ACTIVE=1?                            → let the bulk setup rebuild
6. docs_search off / deps missing / Qdrant down? → skip, print a hint
7. Otherwise                                     → schedule a detached ingest
```

Four guards, each earning its place. They are given their own sections below
because each is independently the answer to a real question someone will ask.

#### Guard 1 — `CHANGELOG.md` is never a reason to reindex

`CHANGELOG.md` is excluded at any depth, case-insensitively. Release tooling
rewrites changelogs on every pipeline; without this exclusion roughly every pull
triggers a multi-minute rebuild for content nobody ever searches.

The rule lives in one place — `scripts/lib/doc-markdown.mjs` — shared by the
hooks and the setup scripts. If they disagreed about what counts as a doc, one
would reindex for files the other ignored, and nobody would notice until they
measured it.

#### Guard 2 — `WS_SETUP_ACTIVE` stops a stampede of rebuilds

`WS_SETUP_ACTIVE=1` is exported by the daily guard and by `setup-workspace.mjs`
before they touch git, and is inherited by every git child process. The daily
flow pulls every nested repo and deliberately runs **one** ingest at the end;
without this flag each pull's hook would fire its own, serialising a dozen
rebuilds.

**This is the coordination primitive worth copying** — an env var inherited
through the process tree. No lock protocol, no IPC, no shared file to corrupt;
the process tree already carries exactly the "am I inside a bulk operation?"
information you need.

#### Guard 3 — the ingest lock, and why it expires

`.git/docs-ingest.lock` prevents two independent runs from overlapping — a hook
firing while a manual `yarn docs:ingest` is already going, say. The lock holds
the owning pid and a timestamp.

It is treated as **stale after 30 minutes**, and a run that finds a stale lock
takes it over. This matters more than the lock itself: a lock without a
staleness rule is a footgun. One ingest killed by a laptop sleeping, and every
future rebuild is blocked forever — silently, because a skipped rebuild looks
exactly like a rebuild that had nothing to do.

If you ever suspect it, the lock is a plain file:

```bash
cat .git/docs-ingest.lock      # pid, then epoch millis
rm .git/docs-ingest.lock       # safe: the next run re-creates it
```

#### Guard 4 — a preflight that skips with a hint, not an error

Before scheduling anything the hook checks that the feature is on, that
`mcp/node_modules` exists, and that Qdrant is reachable. When one of those is
false it logs an actionable hint and stops — these are expected states (a
teammate who has not opted in, a fresh clone, a stopped container), not failures
worth interrupting someone's `git pull` over.

A hook **never fails the git command that triggered it** — every path exits 0.
When the feature is off, `mcp/node_modules` is missing, or Qdrant is unreachable,
it self-skips with a *hint rather than an error*.

Everything is appended to `.git/hooks-post-update.log`, which is where a
background ingest's only record lives:

```bash
tail -f .git/hooks-post-update.log
```

> **A Windows gotcha worth the paragraph.** `detached: true` maps to
> `DETACHED_PROCESS`, so the background runner owns **no console**. When it then
> spawns a console app, Windows allocates a fresh console — surfacing as a blank
> terminal window. Closing it, the obvious reaction, delivers `CTRL_CLOSE_EVENT`
> and kills the ingest with exit `3221225786` (`0xC000013A`,
> `STATUS_CONTROL_C_EXIT`). The fix is `windowsHide: true` on the **inner** spawn
> only — Windows rejects `DETACHED_PROCESS` combined with `CREATE_NO_WINDOW`, so
> putting it on the outer spawn breaks detachment outright. The hook names that
> exit code in its log so it reads as "interrupted", not "crashed".

---

## 4. Daily workspace setup — one ingest for every repo

A `folderOpen` task in [`.vscode/tasks.json`](../../.vscode/tasks.json) runs
`scripts/daily-setup-guard.mjs` on **every** folder open, and the guard gates the
real work to once per calendar day via `.git/last-daily-setup`.

The guard exists because the useful trigger — "the first time someone starts
work today" — is not an event any tool emits. Folder-open is the closest proxy,
and it fires a dozen times a day, so the gate is the whole design.

When it does run:

1. Install/repair the git hooks.
2. Pull the workspace repo, diffing `old..new` to detect docs markdown changes.
3. Run `yarn setup --pull --docs-if-changed [--external-changed]`, which pulls
   every nested repo, tracks whether **any** of them moved markdown (a fresh
   clone always counts), and rebuilds the index **once** at the end only if
   something did.
4. Stamp today's date **only on success**, so a failure retries on the next
   folder open rather than skipping a broken day entirely.

Run it by hand:

```bash
yarn daily-setup           # respects today's stamp
yarn daily-setup --force   # ignore the stamp and run anyway
```

Its log, one `=====` header per run:

```bash
tail -40 .git/daily-setup.log
```

### Setup flags

`setup-workspace.mjs` exposes the rebuild decision as flags, which makes the
behaviour testable rather than implicit:

| Flag | Behaviour |
|---|---|
| *(none)* | always rebuild |
| `--pull` | also pull repos that already exist, not just clone missing ones |
| `--skip-docs` | never rebuild |
| `--docs-if-changed` | rebuild only if a pulled/cloned repo moved docs markdown |
| `--external-changed` | seed "docs changed = true" (the guard's own meta-repo pull) |
| `--docs-dry-run` | print the decision without paying the multi-minute cost |

`--docs-dry-run` deserves special mention: **a change-detection heuristic you
cannot inspect without waiting 20 minutes is a heuristic nobody debugs.**

```bash
yarn setup --pull --docs-if-changed --docs-dry-run
# [3/3] Docs index...
#       Decision: SKIP — --docs-if-changed and no repo moved docs markdown
```

The setup-driven ingest runs in the **foreground** with inherited stdio (it is
an interactive CLI, not the MCP server) so progress streams live instead of
buffering, bounded by `DOCS_INGEST_TIMEOUT_MS` (default 20 min). Failure is
**non-blocking** and prints the manual retry command: the rest of setup
succeeded, and a day-stale index is an inconvenience, not a reason to fail the
developer's first action of the day.

> **The `folderOpen` task requires `"task.allowAutomaticTasks": "on"` in USER
> settings.** It cannot be enabled from workspace settings, by design — an
> auto-running task is a code-execution vector, so the editor requires the human
> to opt in per machine. Without it the task never runs and the automation looks
> broken with no error anywhere. This is the single most common reason someone
> reports "the daily setup never happens".

---

## Security: automation is code execution

Everything on this page runs code on your machine without asking. That is the
point — and it is also a real risk worth stating plainly rather than burying.

Two mechanisms here execute code automatically:

| Mechanism | Runs when | Enabled by |
|---|---|---|
| **`folderOpen` task** | Every time the folder is opened in the editor | `"task.allowAutomaticTasks": "on"` in **user** settings |
| **Git hooks** | Every `git pull` / `git merge` / rebase | `git config core.hooksPath .githooks` |

Both read their definitions from **version-controlled files** — `.vscode/tasks.json`
and `.githooks/`. That is what makes the automation shareable, and it is exactly
what makes it a supply-chain surface: *anyone who can land a commit can change
what runs on your machine.*

### The realistic threat

Not a movie hack. The ordinary paths:

- **A merged pull request** that adds a step to `tasks.json` or a line to a hook.
  Reviewers skim config files; a plausible-looking `node scripts/...` line in a
  200-file PR is easy to wave through.
- **Opening a cloned repo.** With automatic tasks enabled, opening an untrusted
  repository is enough. No command is typed and nothing is confirmed.
- **A compromised dependency.** The hook runs `yarn install` when manifests move.
  A malicious postinstall script needs no help from `tasks.json` at all.
- **A stale local edit.** `.git/hooks/` and local task edits are not tracked, so
  a change made months ago on your machine is invisible in every diff.

The failure mode is the same as everywhere else in this design: **it is silent.**
A malicious task that also does the legitimate work looks exactly like a working
setup.

### If you enable automatic tasks, audit them

The setting is per-machine and cannot be granted by a workspace — that is a
deliberate safety boundary, not an inconvenience. Having accepted it, take on
the review habit that goes with it:

- **Review `.vscode/tasks.json` and `.githooks/` in every PR that touches them,
  properly.** These are not config files in the "formatting preferences" sense.
  Treat a diff to them the way you would treat a diff to a deploy script. It is
  worth a CODEOWNERS entry so they cannot be changed without a named reviewer.
- **Audit what is actually installed, periodically** — quarterly, or whenever you
  return to a workspace you have not opened in a while. Tracked files are only
  half the picture; check for untracked local hooks too:

  ```bash
  # What will run on folder open?
  cat .vscode/tasks.json

  # What will run on git operations?
  git config core.hooksPath          # expect: .githooks
  ls -la .githooks/                  # tracked, reviewable
  ls -la .git/hooks/                 # NOT tracked — anything here is local-only
  git log --oneline -- .githooks .vscode/tasks.json | head
  ```

  That last command is the useful one: it shows who changed the automation and
  when. An entry you do not recognise is worth ten minutes.
- **Keep tasks thin.** Every task here is a one-line call into a tracked script
  under `scripts/`, so the reviewable surface is normal code that goes through
  normal review — not logic hidden in a JSON string that no linter reads and no
  test covers.
- **Turn the setting off if you open untrusted repositories.** If you clone
  widely — reviewing external contributions, exploring OSS — the honest answer
  is to leave automatic tasks off and run `yarn daily-setup` by hand. It costs
  one command a day.
- **Keep editor Workspace Trust enabled.** It is the backstop that prevents an
  unopened, untrusted folder from executing anything, and it is the reason
  "restricted mode" exists.

### Why this workspace is still built this way

The alternative — no automation — has its own failure mode: a stale index that
silently returns wrong answers, which is the problem this whole system exists to
solve. The mitigation is not to avoid automation but to keep it **small,
tracked, reviewable, and boring**:

- every automated action lives in a tracked file that shows up in `git log`;
- tasks and hooks delegate to normal scripts rather than embedding logic;
- nothing here needs elevated privileges, and nothing writes outside the
  workspace and its own `.git/` directory;
- the hooks fail open — they never block a git command — so removing them breaks
  nothing except freshness.

---

## 5. What is still manual

Automation is triggered by **git activity and staleness**, not by the
filesystem. Editing a doc in your editor does **not** reindex it — there is no
file watcher. Your local edit is searchable after the next daily rebuild, or
immediately after:

```bash
yarn docs:ingest
```

This is a conscious trade: a watcher would either debounce into minute-long
delays anyway or thrash a multi-minute CPU job on every keystroke. Incremental
single-file reindexing is the real fix, and it is blocked on BM25 being
corpus-wide — you cannot re-embed one chunk without refitting IDF across the
corpus, or accepting that the vocabulary drifts out of sync.

---

## Command reference

| Command | What it does |
|---|---|
| `yarn setup` | Install hooks, clone missing repos, rebuild the index |
| `yarn update` | Pull all nested repos (does **not** rebuild the index) |
| `yarn hooks:install` | Install/repair the git hooks |
| `yarn daily-setup [--force]` | Run the once-a-day flow by hand |
| `yarn docs:ingest` | Full index rebuild (blue-green, safe while in use) |
| `yarn docs:health` | Diagnose the index — see [Operations](./docs-rag-operations.md) |
| `yarn docs:eval` | Measure retrieval quality — see [Evaluation](./docs-rag-evaluation.md) |
| `yarn docs:query "…"` | Run a search from the terminal |
| `yarn docs:sources` | Print the resolved corpus |
| `yarn qdrant status` | Container engine and endpoint health |

## Log reference

| Log | Contents |
|---|---|
| `.git/hooks-post-update.log` | hook runs + **background ingests** (their only record) |
| `.git/daily-setup.log` | every daily-guard run, with a `=====` header per run |
| MCP server stderr | startup, health checks, alias swaps, forwarded ingest output |
| `docker logs workspace-docs-qdrant` | Qdrant's own view |

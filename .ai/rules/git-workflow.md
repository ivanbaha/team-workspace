# Git Workflow

How branches, commits, pushes and merge requests work in this workspace.

Applies to every repo cloned under `frontend/`, `backend/` and `libs/`, and to the
workspace (meta) repo itself. Repos we do not own are covered in
[environments-and-ownership.md](./environments-and-ownership.md) — their house style wins.

---

## Commits — Conventional Commits

```txt
{type}({TASK-CODE}): {description}
```

This is the standard [Conventional Commits](https://www.conventionalcommits.org) format, and
CI reads it: the version bump on release is derived from the commit types since the last tag
by whichever standard tool the repo uses. `semantic-release`, `standard-version`,
`release-please` and `commitizen` all agree on the mapping below, so nothing here is a local
invention and nothing needs a custom bumping script.

**The scope is the task code.** The specification leaves scope free-form, and we spend it on
the ticket: it links every commit to the tracker — Jira, GitLab and GitHub all pick the key
up from the message — and `git log --grep TW-412` answers "what shipped for this ticket"
without any integration at all. If a commit also wants to name a component, keep the task
code in the scope and put the component in the description.

### The types, and what each does to the version

| Type | Bump | Use for |
| --- | --- | --- |
| `feat` | **minor** | New behaviour a user or a caller can observe |
| `fix` | **patch** | A defect corrected |
| `perf` | **patch** | Faster or cheaper, same behaviour |
| `revert` | **patch** | Reverts a previous commit |
| `refactor` | — | Restructuring with no behaviour change |
| `docs` | — | Documentation only |
| `test` | — | Tests only |
| `build` | — | Build system, Dockerfile, dependency bumps that are not fixes |
| `ci` | — | Pipeline configuration |
| `style` | — | Formatting only, no change in meaning |
| `chore` | — | Anything else that is not product behaviour |

**A breaking change is a `!` after the scope, a `BREAKING CHANGE:` footer, or both — and it
bumps MAJOR whatever the type:**

```txt
feat(TW-503)!: replaced the paging cursor with a page number

BREAKING CHANGE: `GET /products?cursor=` is gone. Callers move to `?page=`.
```

The footer is what lands in the changelog, so write it for the person who has to migrate.

### "—" means no release *on its own*, not "does not ship"

A `docs` or `refactor` commit does not trigger a release by itself. It still ships: it rides
in the next release that a `feat`, `fix` or `perf` triggers, and it still appears in the
changelog. That is the point — correcting a typo in a README should not bump a version.

**The trap that creates, and the one rule worth memorising:** a branch whose commits are
*all* no-release types produces **no release at all**. The MR merges, the pipeline goes
green, and nothing is published. So ask one question before choosing a type — *must this
reach an environment on its own?*

- **Yes** → it is a `fix` (or `feat`/`perf`). A dependency bump that closes a CVE is
  `fix(TW-420): bumped vulnerable transitive dependencies` — it has to ship, so it is not
  `build` or `chore`, whatever the diff looks like.
- **No, it can wait for the next real change** → use the honest type.

Do not mislabel a `refactor` as a `fix` to force a release. If it genuinely has to go out
now, it is not a pure refactor — say what it fixes.

### Message

One active-voice sentence, lower case, no trailing period.

```txt
feat(TW-412): added cursor pagination to the products list endpoint
fix(TW-418): corrected basket total when every line item is removed
perf(TW-431): replaced the N+1 owner lookup with a single batched call
refactor(TW-433): extracted the price formatter into tw-common-frontend
build(TW-440): moved the base image to node 24
```

Commit at logical milestones — one working change per commit — not once at the end and not
after every keystroke.

**Never commit without explicit approval for that specific commit.** Finishing the work,
verifying it and typechecking it are not authorization to commit it. Report that it is
ready and leave it in the working tree. Approval for one commit does not carry to the next.

---

## Branches

Create a branch when a task starts. Never work directly on `main`.

```txt
{type}/{TASK-CODE}-{short-description}
```

**`{type}` is the same vocabulary as the commit types above** — `feat`, `fix`, `perf`,
`refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore` — so a branch name predicts what
its commits look like and whether merging it will cut a release.

Name the branch for its *primary* change. A `feat/` branch carrying an incidental `docs`
commit is normal and correct.

Two branch prefixes are not commit types:

| Prefix | Use for |
| --- | --- |
| `release/` | Release branches in `infra/git-ops` only, named `release/<version>` with no task code — see [environments-and-ownership.md](./environments-and-ownership.md) |
| `revert/` | Backing out something already on `main`, carrying `revert:` commits |

Examples:

```txt
feat/TW-412-paginate-products
fix/TW-418-null-basket-total
refactor/TW-433-extract-price-formatter
release/26.3.2
```

Before branching: check for uncommitted work. If the tree is dirty, **stash it and say so** —
never discard someone's work to make room.

---

## Pushing

**Use `gitlab_safe_push` (MCP), not `git push`.** It validates branch protections, refuses a
direct push to the default branch, and uses `--force-with-lease` when a force is genuinely
needed.

```txt
gitlab_safe_push { project_id, branch, working_dir }
```

`project_id` comes from `configs/workspace-repos.json` — every entry carries a `projectId`
and a `localPath`. **Never invent a project ID.** A wrong one pushes to a stranger's repo.

A `PreToolUse` hook (`scripts/hooks/guard-protected-branch.mjs`) blocks a raw `git push` to
`main`/`master` and points back here, so getting this wrong is loud rather than silent.

---

## Merge requests

### Title

Same as the commit message: `{prefix}({TASK-CODE}): {message}`.

### Description — explain the goal, do not inventory the diff

A reviewer opens the MR already able to see which files changed and what the tests say.
What they cannot see is *why*, and *what happens when it merges*. A few short paragraphs.

```txt
{The problem, and what now happens instead — 1-3 short paragraphs.}

{Any non-obvious decision a reviewer would otherwise have to ask about.}

{Deployment or ordering note, when merging alone changes behaviour — or notably does not.}

---

Jira: [{TASK-CODE}]({url})
```

**Always:**

- Lead with the behaviour change in plain terms — what was wrong, what it does now.
- Link the ticket so the reasoning is one click away instead of restated.
- Keep a deployment note when ordering matters. *"Safe to merge alone, inert until X lands"*
  is often the single most useful line in the description, because it answers the first
  question a reviewer has.
- Call out a decision that looks wrong without context — a deliberate fallback, a
  non-unique index, a check that only exists to avoid a downstream 400.
- Mention an unrelated change that rides along (a base-image bump, say), so it is not
  mistaken for part of the feature.

**Never:**

- List touched files or add a per-file change table. The diff shows this, and it goes stale
  the moment the branch is updated.
- Restate test names or counts. Asserting "tests pass" is the pipeline's job.
- Paste requirement IDs or section names as the explanation — link the source and write the
  reason in prose.
- Reproduce code that is already in the diff.

Descriptions that mirror the diff are written once and wrong thereafter, and they bury the
two things only the author knows: the intent, and the merge-order risk.

### Release and automation MRs are a different genre

A `release-mr` description is a version table and an environment delta. That table **is**
the substance of the change, not a restatement of a diff — do not trim it to match the rule
above. See [`.ai/skills/release-mr/SKILL.md`](../skills/release-mr/SKILL.md).

---

## Never

- Push with raw `git push` when `gitlab_safe_push` is available.
- Commit without explicit approval for that commit.
- Mislabel a commit type to force or dodge a release. If a change must ship on its own it is
  a `feat`/`fix`/`perf`, and the description should say why.
- Land a branch whose commits are all no-release types when the change was meant to ship — it
  merges green and publishes nothing.
- Force-push a shared branch.
- Discard or stash-and-forget someone else's uncommitted work.
- Commit `.env`, credentials, or anything matching a token pattern. A `PreToolUse` hook
  (`scripts/hooks/guard-secrets.mjs`) blocks this, but the hook is a backstop, not a policy.

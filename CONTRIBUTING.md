# Contributing to the Team Workspace

This document is the **entry point for how work is done here** — for people and for coding
agents alike. It is an index, not a rulebook: each rule lives in its own file under
[`.ai/rules/`](.ai/rules/) so an agent can load the one topic it needs instead of everything.

Agent rule files (`AGENTS.md`, `CLAUDE.md`, `.agents/AGENTS.md`,
`.github/copilot-instructions.md`, `.kiro/steering/00-workspace-rules.md`,
`.cursor/rules/workspace-rules.md`) all point here. They are **generated** — see
[Keeping the pointers in sync](#keeping-the-pointers-in-sync).

---

## The rules

| Rule | Read it before |
| --- | --- |
| **[Git Workflow](.ai/rules/git-workflow.md)** | Branching, committing, pushing, or opening an MR. Covers the Conventional Commits types and what each one does to the version, and what an MR description should and should not contain. |
| **[Code Style](.ai/rules/code-style.md)** | Writing code. What the real gates are (typecheck, tests, the service starting — never the linter), when a comment earns its place, and what makes a test worth having. |
| **[Environments & Ownership](.ai/rules/environments-and-ownership.md)** | Touching `infra/git-ops`, promoting a version, or working in a repo that might not be ours. Defines `dev` / `test` / `prod` and the one-directional promotion path. |
| **[Local Environment](.ai/rules/local-environment.md)** | Running anything in the shell. Which commands to hand to the operator instead of running, and how to behave when the terminal degrades. |
| **[Finding Things](.ai/rules/docs-index.md)** | Grepping, or writing a script that might already exist. Search-first with `docs_search`, and what is deliberately kept out of the index. |
| **[Work Triage](.ai/rules/work-triage.md)** | Starting anything new. How much process the work earns — a spec, a one-page task, or nothing — and whether new scope amends an existing spec or starts a linked one. |
| **[Requirements & Estimates](.ai/rules/requirements-and-estimates.md)** | Writing or reviewing acceptance criteria, or sizing work. EARS criteria, the gap-interrogation checklist, one-issue-per-service slicing, Fibonacci-only points. |

---

## The short version

- **Branch** `{type}/TW-123-short-description` off `main`. Commit as Conventional Commits with
  the task code as the scope: `feat(TW-123): did the thing`. `feat` bumps minor, `fix` and
  `perf` bump patch, `!`/`BREAKING CHANGE:` bumps major; `refactor`, `docs`, `test`, `build`,
  `ci`, `style` and `chore` ship without cutting a release of their own — so a branch of
  *only* those merges green and publishes nothing.
- **Never commit or push without explicit approval for that specific action.** Push through
  `gitlab_safe_push`, never raw `git push`.
- **The gates are typecheck, tests, and the service starting.** Lint and formatting are not
  gates and are never worth holding up delivery for.
- **`dev` → `test` → `prod`, one direction, no skipping.** A version reaches production only
  by having been in `test` first.
- **Search before you build.** `docs_search` the *problem* before writing a script or
  starting a `grep` sweep.
- **Hand slow or destructive commands to the operator** — installs, `yarn setup`,
  `yarn docs:ingest`. Do not work around them.
- **Triage before you start.** Two or more signals from the rubric means a spec; one means a
  one-page task; none, on trivial work, means no artifact. Ties go to the *lighter* tier.
- **A change is not done until its docs deliverable ships or is consciously skipped.**
  "No `docs/` impact" is a valid answer; silence is not.

---

## Where things live

| Path | What it is |
| --- | --- |
| [`.ai/rules/`](.ai/rules/) | **Canonical rules.** Agent-neutral markdown. This document indexes them. |
| [`.ai/skills/`](.ai/skills/README.md) | **Canonical skills** — step-by-step procedures for multi-step jobs (review an MR, cut a release, fix a vulnerability). |
| [`.ai/connectors/`](.ai/README.md) | Standalone Node scripts for external services, run from the shell. |
| [`mcp/`](mcp/README.md) | The MCP server: GitLab, Jira, Grafana, MongoDB tools plus hybrid docs search. |
| [`docs/`](docs/README.md) | Team knowledge, indexed for `docs_search`. |
| [`docs/sdlc/`](docs/sdlc/README.md) | **How work flows** from idea to verified change — the four phases, their owners, and the hand-offs. |
| [`docs/SPECs/`](docs/SPECs/README.md) | Feature specifications. Kept out of the search index on purpose. |
| [`docs/tasks/`](docs/tasks/README.md) | One-page plans for small work. Also kept out of the index. |
| [`infra/git-ops/`](infra/git-ops/README.md) | The record of what is deployed to each environment. |
| [`scripts/`](scripts/README.md) | Workspace automation, including the agent hooks under `scripts/hooks/`. |
| [`configs/workspace-repos.json`](configs/workspace-repos.json) | The repo registry: git remote, local path, and GitLab project ID. |

---

## How work flows

Work moves through four phases, each with an owner and an explicit hand-off. Not everything
goes through every phase — that is the point of the triage rubric.

| Phase | Owner | Artifact it produces |
| --- | --- | --- |
| **1 · Origination** | BA / PO | An Epic carrying the intent, or a Story / Task for small work |
| **2 · Specification** | BA seeds → Architect / Dev completes | A spec under [`docs/SPECs/`](docs/SPECs/README.md) — big features only |
| **3 · Development** | Dev | Code, an MR, and the `docs/` deliverable |
| **4 · Verification** | QA + AQA | Scenarios designed from the acceptance criteria, and their results |

Three rules from that flow are worth knowing before you read any of it:

- **Most work does not deserve a spec.** [Triage](.ai/rules/work-triage.md) first — two or
  more signals means a spec, one means a one-page task, none means just do it.
- **Coverage is designed by QA from the acceptance criteria**, not by the BA who wrote them
  or the developer who built the feature. Both are blind in the same places.
- **Amendments go back into the original spec.** A superseded criterion with a recorded
  reason is useful; one that still reads as current is worse than no criterion at all.

Full write-up, including the mermaid flow and who hands what to whom:
**[`docs/sdlc/`](docs/sdlc/README.md)**. Starting a ticket right now:
[SDLC Quickstart](docs/guides/sdlc-quickstart.md).

---

## Skills

A **skill** is a written procedure for a job that takes many steps and has to come out the
same way every time. They live in [`.ai/skills/`](.ai/skills/README.md) as plain markdown and
are wrapped thinly for each agent.

| Skill | Use it when |
| --- | --- |
| [`plan-task`](.ai/skills/plan-task/SKILL.md) | Starting new work — it triages to spec / task / direct |
| [`author-spec`](.ai/skills/author-spec/SKILL.md) | Writing or amending a feature spec |
| [`implement-task`](.ai/skills/implement-task/SKILL.md) | Executing one unit of work through to the MR and the docs |
| [`review-mr`](.ai/skills/review-mr/SKILL.md) | Reviewing someone's merge request |
| [`release-mr`](.ai/skills/release-mr/SKILL.md) | Promoting versions `dev` → `test` or `test` → `prod` |
| [`fix-security-vulnerabilities`](.ai/skills/fix-security-vulnerabilities/SKILL.md) | A scan found vulnerabilities and they need a fix plan |
| [`debug-and-report`](.ai/skills/debug-and-report/SKILL.md) | Debugging from logs, then raising the bug |

---

## Agent hooks

Five hooks enforce the expensive-to-get-wrong parts of these rules automatically. They are
plain Node scripts under [`scripts/hooks/`](scripts/hooks/README.md), wired for Claude Code
in `.claude/settings.json` and portable to any agent that can run a command on a tool event.

| Hook | What it does |
| --- | --- |
| `guard-secrets.mjs` | Blocks a commit that would stage `.env`, a key file, or a token-shaped string |
| `guard-protected-branch.mjs` | Blocks a raw `git push` to `main`/`master`, points at `gitlab_safe_push` |
| `docs-index-staleness.mjs` | Notes that `docs_search` is now stale for a file you just edited |
| `validate-overlay.mjs` | Builds a git-ops overlay you just edited, so a broken one surfaces immediately |
| `docs-delivery-gate.mjs` | After a push, makes the `docs/` deliverable a tracked step rather than an intention |

---

## Keeping the pointers in sync

Each agent reads its rules from its own conventional path. Rather than maintaining six
copies by hand, they are generated from one template:

```bash
yarn rules:sync     # regenerate every pointer file
yarn rules:check    # exit non-zero if any pointer has drifted — use in CI
```

Edit [`.ai/rules/`](.ai/rules/) and this file. Never edit a pointer file directly; the next
`yarn rules:sync` overwrites it.

---

## Adding to the workspace

- **A rule** → new file in `.ai/rules/`, listed in the table above, in
  [`.ai/rules/README.md`](.ai/rules/README.md), and in the ordered list at the top of
  `scripts/sync-agent-rules.mjs`. Then `yarn rules:sync`.
- **A skill** → `.ai/skills/<name>/SKILL.md` plus the four thin wrappers, then a row in
  [`.ai/skills/README.md`](.ai/skills/README.md). Run `yarn skills:check` to verify the
  wrappers exist.
- **A connector** → `.ai/connectors/<service>/`, credentials shape added to `example.env`.
- **A doc** → the right folder under `docs/`, linked from that folder's `README.md` and from
  [`docs/README.md`](docs/README.md). Say that the search index is stale for it.
- **A repo** → an entry in `configs/workspace-repos.json` with `projectId` and `localPath`.
- **A spec** → `docs/SPECs/<code>-<slug>/`, copied from
  [`_template/`](docs/SPECs/_template/README.md). Only for work the triage rubric scores at
  two or more signals.
- **A task one-pager** → `docs/tasks/<code>.task.md`, from
  [`_template.task.md`](docs/tasks/_template.task.md).

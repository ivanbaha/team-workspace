---
name: implement-task
description: "Execute one unit of work end to end: a raw ticket, a docs/tasks/*.task.md one-pager, or a task.N.md from a spec. Handles codebase investigation, a confirmed micro-plan, git setup, implementation, the quality gates, the MR, spec progress sync, and the docs deliverable. Use when the user says 'implement', 'execute this task', 'do this spec task', 'build it', or after plan-task routed work here."
---

# Implement Task (Executor)

You are the single execution engine. You take **one already-triaged unit of work** and carry
it from investigation through implementation, the quality gates, the MR, and the docs
deliverable.

Heavy up-front planning is owned by [`plan-task`](../plan-task/SKILL.md) and
[`author-spec`](../author-spec/SKILL.md), not here. You still produce a short in-chat
micro-plan and confirm it (Step 5) before touching files, but you do not author spec
artifacts. Reviewing someone else's MR is [`review-mr`](../review-mr/SKILL.md).

Three properties hold throughout:

- **Nothing is committed, pushed, or opened as an MR without explicit approval for that
  specific action.** Approval for the commit is not approval for the push.
- **The gates are typecheck, tests, and the service starting** — never the linter
  ([`code-style.md`](../../rules/code-style.md)).
- **The task is not done until the docs deliverable ships or is consciously skipped**
  (Step 12).

> **Feature owning.** The team's model is that one developer carries a feature from its
> technical spec through to production, including the fixes verification turns up
> ([Phase 3](../../../docs/sdlc/03-development.md#feature-owning)). Assume the operator
> running you on a spec task is the feature's owner and will be back for its siblings: keep
> the spec's tracking honest (Step 11), and record findings in the artifact rather than only
> in chat.

---

## Step 1: Intake — identify the input

Three kinds of input. Detect which one you were given.

1. **Spec task** — a `task.N.md` inside `docs/SPECs/<code>-<slug>/`. The richest input: it
   already names the repo, project ID, exact files, code, commit message and delivery step.
   Read it **and** its sibling `requirements.md` and `design.md` — particularly the
   **correctness properties**, which are what the implementation has to satisfy. On
   completion you **must** sync spec progress (Step 11).
2. **Task one-pager** — a `docs/tasks/<code>.task.md`. Read it for the plan, scope,
   acceptance and `Docs Impact`.
3. **Raw ticket** — a code, a URL, or pasted details, with no artifact (the `direct` tier).
   Extract the code with `<letters>-<numbers>`. Ad-hoc work with no ticket uses `TW-0`.
   Fetch details with `jira_issue_get` if you were given only a code or URL.

From whichever input, establish the primary service(s), the task type (`bug-fix` |
`feature` | `enhancement`), and the full set of requirements.

**Spec task or one-pager → Steps 3 and 4 can be light**, because the plan already exists.
**Raw ticket → do the full investigation.**

## Step 2: Sync the codebase

Before investigating anything, make sure you are reading current code. Pull the latest on
the current branch and confirm the working tree state. Branch selection happens in Step 6 —
this step only exists so you do not investigate a stale checkout.

## Step 3: Investigate

1. **`docs_search` the problem first.** There may already be a guide, a spike, or a prior
   task covering it — including one that says why the obvious approach does not work. See
   [`docs-index.md`](../../rules/docs-index.md).
2. **Locate the target repo** via [`configs/workspace-repos.json`](../../../configs/workspace-repos.json)
   (`localPath`, `projectId`) and read its README.
3. **Identify** the architecture patterns and conventions in use, the frameworks and
   libraries, the relevant existing code — entry points, DTOs, handlers in scope — and any
   cross-service dependency.
4. **For a bug**, establish which environments are affected. If the ticket does not say,
   ask.

### Dependencies

Prefer, in order: **an internal shared library** (`libs/`) → an existing dependency already
in the repo → **a new public package, last**.

For any new public runtime dependency: **stop, explain why it is needed, name the internal
alternatives you considered, and wait for approval.** Use `yarn` — never `npm` or `pnpm`.

## Step 4: Clarification

Ask only what the investigation could not answer. Do not produce a generic checklist — ask
about the specific gaps you hit.

Present the questions as a numbered list and wait. If the answer is partial or the operator
is unavailable, **state the assumptions you are making and proceed** — then record them in
the micro-plan and, for a `task`, in the one-pager's Notes.

If there are no open questions, say so and move on.

## Step 5: Micro-plan — in chat, not persisted

Present a concise plan:

- Which files will be created or modified
- The approach, and the order
- The assumptions being made
- **Anything that deviates from existing patterns, or from the written plan**

For a spec task or a one-pager this is a short confirmation of an already-written plan,
plus any deviation you intend. For a raw ticket it is your full proposed approach.

Then ask: **"Does this look right — should I proceed?"** Wait before touching any file.

The durable plan lives in the artifact. This one exists so a wrong turn is caught before
the diff, not after.

## Step 6: Git setup

Follow [`git-workflow.md`](../../rules/git-workflow.md).

1. **Check for uncommitted work.** If the tree is dirty, analyse it against this task:
   - Clearly related and consistent with the plan → preserve it and continue.
   - Related but conflicting with the plan → explain the conflict and ask: adapt, stash, or
     revert.
   - Unrelated → ask the operator to commit or stash it first. **Never discard someone's
     work to make room.**
2. **Determine the base branch.** `main`, pulled fresh, unless the operator names another.
3. **Determine the branch type** from the task type — `fix/` for a bug, `feat/` for a
   feature or enhancement. When it is genuinely ambiguous, ask; the prefix predicts whether
   merging cuts a release, so guessing it wrong is not cosmetic.
4. **Create the branch:** `{type}/{TASK-CODE}-{short-description}`, the description
   lowercase and hyphenated, derived from the ticket summary.

## Step 7: Implementation

Follow the confirmed plan, one logical unit at a time, keeping consistency with the patterns
found in Step 3.

**Stop and ask when:**

- A rule, an existing pattern and the task requirements conflict.
- Several valid approaches exist and the choice has real trade-offs.
- An **existing** test fails because of your change.
- A new public package is needed.

## Step 8: Quality gates

In order. **Typecheck, tests, and the service starting are the gates. Lint is not.**

1. **Typecheck** — `yarn typecheck`. Fix every error your change introduced.
2. **Tests** — run the relevant ones, then the suite. **If an existing test fails, stop
   immediately and report it with the failure output.** Do not modify a test to make it
   pass without saying so and getting agreement — a failing existing test is information,
   and editing it destroys the information.
3. **It starts** — for a service change, confirm the service actually boots. A green
   typecheck on a service that will not start is not a passing gate.
4. **Lint** — one optional pass over the lines you touched. Never block delivery on it,
   never re-run it chasing a clean result, and report what you left alone rather than
   fixing unrelated findings.

Maintain or improve existing coverage. Do not chase an arbitrary percentage.

## Step 9: Completion summary

Before any git operation, present:

- What was implemented — files changed, key decisions, and **any deviation from the plan**
- Gate results: typecheck, tests, service start — and anything skipped or left unfixed

Then ask: **"Implementation is complete. Commit, push, and open the MR?"**

The operator may confirm all three or a subset. **Proceed only with what was confirmed.**

## Step 10: Git finalisation

1. **Commit** — `{type}({TASK-CODE}): {description}`, one active-voice sentence, lower case,
   past tense, no trailing period. The type must match the branch prefix. Full type table
   and the release consequences: [`git-workflow.md`](../../rules/git-workflow.md).
2. **Push** with `gitlab_safe_push { project_id, branch, working_dir }`. Never raw
   `git push`. The `project_id` comes from `configs/workspace-repos.json` — **never invent
   one.**
3. **Open the MR** with `gitlab_create_mr`:
   - **Title:** the commit message.
   - **Description:** the goal, not an inventory of the diff. One to three short paragraphs
     — the problem, what happens now instead, and any non-obvious decision a reviewer would
     otherwise have to ask about. Add a deployment or ordering note when merging alone
     changes behaviour, or notably does not. Then the ticket link, and for a spec task a
     link to the spec and which task of how many.
   - **Do not** list touched files, per-file tables, or test counts. The diff shows them and
     they go stale the moment the branch is updated.

### One MR per service — fold same-repo tasks together

When several tasks target the **same** repo, they share **one** branch and **one** MR. Open
the MR after the first task is pushed so review overlaps the rest; later tasks push to the
same branch and update it. **Never open a second MR for the same repo.**

Different repos get their own branch and MR, and each MR references the others.

### Multi-service work

Do not start implementing any service until the integration picture is clear:

1. **Define the contracts first** — shared DTO shapes, endpoint signatures, any shared types
   that must live in a library. Present them and confirm before writing code.
2. **Implement the provider before the consumer.**
3. Run Steps 6–8 independently per repo.

## Step 11: Spec progress sync — spec tasks only

If the input was a `task.N.md` from a spec, update the spec's tracking after delivery.
Otherwise the spec rots, and a progress table that lies is worse than none.

1. In `tasks.md`, tick the task's checkbox and append the outcome — the MR link.
2. In `README.md`, update the matching **Progress** rows, stamp them with the operator and
   the date, and bump **Updated at**.
3. **If delivery revealed a spec-level change** — a criterion changed, an assumption was
   wrong, a blocker appeared, or the fix alters documented behaviour — hand back to
   [`author-spec`](../author-spec/SKILL.md) to amend requirements or design and add a
   CHANGELOG entry. **Do not silently edit requirements from here.**

   The amendment goes into **the same spec** by default. What is not acceptable is leaving
   the deviation undocumented. Whether a large rework instead earns its own linked spec is a
   planning decision for the operator — raise it, do not settle it.

Skip this step entirely for `task` and `direct` tier work.

## Step 12: Docs delivery

Team documentation under `docs/` lives in **this** repo, which is a different git repo from
the service you just delivered. So docs never ride in the service MR — they are their own
commit here, as the natural next step after the code is pushed.

1. **Recall the planned impact.** Read `## Docs Impact` in the `.task.md`, or in the spec's
   `design.md`.
2. **Reconcile it with what actually shipped.** If the implementation changed documented
   behaviour, architecture, a business flow, or a guide, the docs need updating **even if
   the plan said "none"** — and the reverse holds too.
3. **Prepare the edits.** Use `docs_search` / `docs_map` to find the exact files and
   sections, then edit them here, scoped to what changed.
4. **Propose — do not auto-push.** Present the edits and ask: **"Docs updated for <code>.
   Commit and push, or will you handle it?"**
5. **If there is genuinely no impact, say so explicitly** — "No `docs/` impact for this
   change" — so it is a conscious decision rather than a silent omission.
6. **Say the search index is stale** for anything you edited in the indexed corpus. You must
   not run `yarn docs:ingest` yourself
   ([`local-environment.md`](../../rules/local-environment.md)).

Do not block the service MR on this. Do not consider the task done without it.

---

## Never

- **Never commit, push, or open an MR without explicit approval for that specific action.**
- **Never use raw `git push`.** `gitlab_safe_push`, always.
- **Never invent a project ID.** A wrong one pushes to a stranger's repository.
- **Never modify a failing existing test to make it pass** without stopping, reporting it,
  and getting agreement. The failure is information.
- **Never block delivery on the linter**, and never re-run it chasing a clean result.
- **Never add a new public runtime dependency without approval.**
- **Never open a second MR for a repo that already has one for this spec.**
- **Never edit a spec's requirements from here.** Hand back to `author-spec`.
- **Never call the task done with the docs deliverable unaccounted for.** "None" is a valid
  answer; silence is not.
- **Never discard or stash-and-forget someone else's uncommitted work.**

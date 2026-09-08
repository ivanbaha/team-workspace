---
name: author-spec
description: "Create or amend a feature spec (requirements → design → tasks → testing) under docs/SPECs/. Authoring is staged and role-scoped: a BA seeds the non-technical parts, an architect or developer completes the technical parts. Four mandatory review gates, and amendments go back into the same spec by default. Use when the user says 'spec', 'seed a spec', 'complete the spec', 'author a spec', 'SDD', 'write the requirements and design', or when plan-task routed work to the spec tier."
---

# Author / Amend a Spec

You produce or update a spec under `docs/SPECs/<code>-<slug>/`. You do **not** implement
code here — each `task.N.md` is implemented later by
[`implement-task`](../implement-task/SKILL.md).

Template: [`docs/SPECs/_template/`](../../../docs/SPECs/_template/README.md). Match its
format. Process background: [Phase 2](../../../docs/sdlc/02-specification.md).

> Specs live in **this** repo and are shared by committing and pushing here. That commit
> *is* the hand-off between roles — there is no other ceremony.

---

## Review gates — pause after each one (MANDATORY)

Spec authoring is incremental and collaborative. After each major artifact you **stop, show
what you produced, and ask the operator to approve or clarify. Never silently continue.**

The gates, in order:

1. **Meta files + requirements** → pause.
2. **Design** (non-technical and/or technical) → pause.
3. **Tasks** (`tasks.md` + every `task.N.md`) → pause.
4. **Tests** (`testing.manual.md` / `testing.auto.md`) → pause.

At every gate:

- Give a short summary — two to four lines — of what you wrote, plus any open decisions or
  assumptions the operator should weigh in on.
- Ask explicitly, e.g. **"Requirements are ready — approve, or add clarifications?"**
- **Wait.** If they have comments, revise *this* artifact and re-present the *same* gate
  until it is approved.
- Produce the next artifact **only after** the current gate is approved. **Do not draft
  ahead.**
- Skip a gate only when the operator explicitly says so.

Closely related artifacts produced together may share one gate — meta files with
requirements, for instance. Requirements, design and tasks may never share one.

**Why this is not negotiable.** A model that produces requirements, design and a task
breakdown in one pass produces a *coherent* set — each artifact consistent with the previous
one, including everywhere the previous one was wrong. Reviewing that is far harder than
reviewing four steps, because the errors have already been propagated and justified. The
pause is also where the operator's knowledge enters: most of what makes a spec correct is
not in the repo.

---

## Authoring is staged and role-scoped

A spec is built by two roles in two stages. **Never overwrite sections that belong to the
other stage** — fill your own, leave theirs as placeholders, and flag the gaps you need
closed.

| Stage | Owner | Produces |
| --- | --- | --- |
| **A · Seed** | BA / PO | Intent and summary, `requirements.md`, **non-technical** `design.md` (UI, UX, business rules), **optional** must-have scenarios, meta files (README, CHANGELOG placeholder) |
| **B · Complete** | Architect / Dev — **the most experienced engineer available**, not necessarily the implementer | **Technical** `design.md` (architecture, components, API, types, data flow, correctness properties, error handling, Docs Impact), `tasks.md` + `task.N.md` with the waves graph, `testing.auto.md` |

**Stage B is assigned by expertise, not to whoever will write the code.** The spec is the
source of truth for everything downstream, so the quality of the technical design caps the
quality of the result. Implementation may then go to the author, to someone else, or to
several developers in parallel — which is exactly what the `waves` graph and
service-scoped tasks exist to make safe.

---

## Step 0: Identify the operator and the stage

1. Read the operator from `.ai/whoami.md` if it exists (name + role). If it does not, fall
   back to `git config user.name` / `user.email` and **ask which role they are acting in** —
   do not guess, because the role selects which half of the spec is theirs to write.
2. Choose the default stage from the role:
   - BA → **Stage A (Seed)**
   - Architect / Dev → **Stage B (Complete)** of an already-seeded spec, or a full pass if
     they explicitly author solo.
3. State which stage you are doing, and confirm before writing anything.
4. **Attribution:** fill the operator into the matching **Implementors** row, and stamp any
   Progress items you complete with `— <date> — <name>`.

## Step 1: Create, complete, or amend?

| Situation | Action |
| --- | --- |
| No `docs/SPECs/<code>-*` folder | **Create** — Stage A seeds a new spec at v1.0 |
| Folder exists, technical sections are placeholders | **Stage B** — complete it |
| Folder exists and is complete | **Amend** it (Step 6) — unless the scope is large enough to earn its own linked spec, which is the operator's call |

## Step 2: Investigate before writing — both stages

Ground the spec in reality. Never draft from the ticket text alone.

1. `docs_search` the problem and read what comes back. Architecture, business flows, prior
   spikes, the service README. See [`docs-index.md`](../../rules/docs-index.md).
2. Read the target repos to find the existing patterns, DTOs and cross-service dependencies
   the design has to fit. [`configs/workspace-repos.json`](../../../configs/workspace-repos.json)
   maps every repo to its `localPath` and `projectId`.
3. Prefer what already exists: an internal library over a new public dependency. **Flag any
   new public dependency explicitly** — it needs approval, and it belongs in Open Decisions
   rather than quietly in a design.

---

## Stage A — Seed (BA)

1. **Scaffold.** Copy `docs/SPECs/_template/` to `docs/SPECs/<code>-<slug>/`, where `<slug>`
   is a short hyphenated feature name. Delete the files that do not apply.
2. **README.** Intent (about 150 words — the *full* intent lives in the Epic), summary,
   Implementors table, Progress checklist, Related Artifacts, Open Decisions.
3. **`requirements.md`.** Introduction, Glossary, Out of Scope, then numbered requirements
   with EARS criteria (`WHEN <trigger>, THE System SHALL <observable behaviour>`). Every
   criterion observable, independently testable, unambiguous and decidable. Follow
   [`requirements-and-estimates.md`](../../rules/requirements-and-estimates.md), including
   its **gap-interrogation table** — walk it and either cover each row or record it as out
   of scope.

   > **PAUSE — Gate 1.** Present the meta files and the requirements. Approve or clarify.

4. **`design.md` — non-technical only.** Overview, UI mockups, UX and business rules.
   **Leave Architecture / API / Types / Data Flow / Correctness Properties / Error Handling
   / Docs Impact as template placeholders for Stage B.**

   > **PAUSE — Gate 2.** Present the non-technical design.

5. **`testing.manual.md` — optional, and deliberately partial.** Seed scenarios **only** for
   cases that must demonstrably be covered, plus a basic happy path if the operator wants
   one. **Do not attempt full coverage, and do not treat a thin or absent
   `testing.manual.md` as an incomplete spec.** Designing the full set belongs to QA, who
   derives it from `requirements.md` independently — that independence is the entire point
   ([Phase 4](../../../docs/sdlc/04-verification.md#coverage-is-designed-by-qa-from-the-criteria)).
   Tag any scenario you do write with the requirement it validates. Seed the shared
   `data-testid` stub in `testing.md` if the feature has UI.

   > **PAUSE — Gate 4.** Present the must-have scenarios — or state that there are none,
   > and why.

6. **`CHANGELOG.md`** stays as the v1.0 placeholder.

Once the gates are approved, **propose committing and pushing** so an architect or developer
can pick it up.

---

## Stage B — Complete (Architect / Dev)

1. **`design.md` — the technical layer.** Architecture and component structure, API layer,
   types, data flow, data models, **correctness properties**, error handling, testing
   strategy, and **Docs Impact**.

   Two sections carry most of the value and are the ones to spend time on:

   - **Correctness properties.** Invariants that must always hold, each naming the criteria
     it validates (`**Validates: Requirements 2.1, 2.4**`). They feed unit tests and
     automation directly, they are what a reviewer checks the implementation against, and
     they survive amendments in a way that prose does not. Include what must hold under
     concurrency, retries and partial failure.
   - **Docs Impact.** Which `docs/` files change. Declared now, because documentation
     written a week later is written from memory — by which point the non-obvious decision
     is the one that has been forgotten.

   > **PAUSE — Gate 2.** Present the technical design and any open decisions. Do not write
   > tasks until this is approved.

2. **`tasks.md` + `task.N.md`.** Decompose into the smallest **independently deliverable**
   units.

   - **Scope tasks by service or library, never finer.** Over-granular tasks buy no
     parallelism and fight the one-MR-per-service rule.
   - **Multi-repo work defines the shared contracts first**, and implements provider before
     consumer.
   - Each `task.N.md` must be concrete enough for the executor: exact repo, project ID,
     package name and version, file paths, code where it helps, the commit message, and the
     delivery step.
   - **Fold same-repo tasks into one MR.** When several tasks target the same repo, their
     delivery steps share a single branch and MR — open the MR after the first task so
     review overlaps the rest. Only different repos get separate MRs.
   - Fill the `waves` dependency graph, and write the **ordering rules** in prose next to
     it. The graph says what may run in parallel; the prose says why.

   > **PAUSE — Gate 3.** Present the breakdown and the dependency graph.

3. **`testing.auto.md`.** The E2E automation scope — omit the file if there is none. Scope
   it against the requirement criteria; the concrete cases follow QA's manual scenarios once
   those exist.

   > **PAUSE — Gate 4.** Present the automation scope.

Once every gate is approved, either implement via
[`implement-task`](../implement-task/SKILL.md), or **propose committing and pushing** for
later.

---

## Step 6: Amendments

**Amending the existing spec is the default.** Most later change to a feature belongs in the
spec that produced it: requirements changed during or after implementation, a blocker or a
wrong assumption found while building, defects from testing or production, adjustments
agreed in review, and follow-up tickets that refine behaviour.

What is never acceptable is an **undocumented deviation** — changed behaviour that exists
only in code or a commit message.

When amending:

1. Edit the affected `requirements.md` / `design.md` criteria **in place**. Keep criterion
   numbers stable and annotate inline: `<!-- v1.3, TW-1290: was … -->`.
2. Add any new `task.N.md` and link it from `tasks.md`.
3. Bump **Version** and **Updated at** in `README.md`, and update the Progress table.
4. **Always add a CHANGELOG entry** — Source, Changed / Added / Fixed, and an Impact list of
   every file touched.

A code-only fix that changes nothing documented needs no version bump, but still gets a line
under *Fixed (code-only, no spec change needed)*.

Why in place rather than appended: **a superseded criterion with a recorded reason is
useful; one that still reads as current is worse than no criterion at all.**

### Amend, or a new linked spec? Help the operator decide

When new scope arrives for a feature that already has a spec, **assess it and present the
recommendation — do not decide silently in either direction.** Both outcomes are valid and
the wrong call is expensive either way, so make the trade-off visible.

| Points to amending | Points to a new, linked spec |
| --- | --- |
| It refines, corrects or completes what the original set out to do — same business outcome | The outcome itself is different; this supersedes rather than sharpens |
| It came out of implementing, reviewing, testing or running the original | It has its own Epic, timeline and fix version, and ships independently |
| The affected criteria can be edited in place and still read coherently | An amended `requirements.md` would be dominated by superseded wording, so "what is current" becomes genuinely ambiguous |
| Same surfaces and services; the task breakdown mostly holds | Little of the task breakdown or technical design survives |
| The original is still in flight | The original is delivered and closed; this is a distinct next phase |

**How to present it:** say which way you lean, name the two or three signals that decided
it, and give the size of the delta — roughly how many criteria change, and whether the
surfaces are the same. Then ask explicitly: amend, or start a linked spec? **The operator's
choice wins.**

If a new spec is agreed, keep the history navigable. This part is not optional:

1. The **new** spec's Intent says what it supersedes or continues, and links the
   predecessor.
2. Its **Related Artifacts** table carries a row for the predecessor.
3. The **old** spec gets a version bump and a CHANGELOG entry recording that the scope
   moved, linking forward. Without this the old spec silently reads as current — exactly the
   failure the amendment discipline exists to prevent.
4. The old spec's delivered content stays intact. Do not strip criteria out of it to make
   room.

---

## Step 7: Validate and hand off

1. Re-read what you wrote for format breakage — broken relative links, a criterion with no
   number, a `**Validates:**` line pointing at a criterion that does not exist.
2. Present a summary: the stage completed, files created or updated, the version, and the
   task list.
3. Name the next role and action:
   - Stage A → "ready for an architect or developer to complete."
   - Stage B → "ready to implement — see `tasks.md`."
4. Say that the spec is **not** in the `docs_search` index, and that whoever picks it up
   should be pointed at the path.

---

## Never

- **Never draft past an unapproved gate.** Four gates, in order, every time.
- **Never overwrite the other stage's sections.** Leave placeholders and flag the gap.
- **Never write full test coverage into `testing.manual.md` as the BA.** It is a floor.
  QA designs the set.
- **Never invent the technical answer to an open question** to make the spec look finished.
  An Open Decision on the record beats a guess presented as a design.
- **Never create branches, commit code, or write implementation here.** You may commit the
  spec artifacts themselves — with approval for that specific commit
  ([`git-workflow.md`](../../rules/git-workflow.md)).
- **Never edit requirements silently on behalf of implementation.** A finding from
  implementation comes back through this skill as an amendment, with a CHANGELOG entry.
- **Never decide amend-vs-new-spec on your own.** Assess it, recommend, and let the operator
  choose.

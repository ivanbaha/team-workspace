---
name: plan-task
description: "Front door for starting new work. Intakes a ticket code, URL, pasted details or an ad-hoc problem, runs a first analysis, and routes it to the right tier: spec (big feature), task (small planned work), or direct (trivial fix). Scaffolds the one-pager for the task tier. Use when the user says 'start', 'plan this', 'pick up', 'new task', 'triage', 'let's work on TW-1234', or gives a ticket code or URL without saying how to approach it."
---

# Plan Task — Intake & Triage

You are the front door for new work. Your job is to understand a piece of work well enough
to judge how much process it earns, then route it. You do the analysis and the routing
decision — you do **not** write the heavy artifacts or the implementation yourself.

The two properties that define this skill:

- **You propose; the developer decides.** Every triage ends with a recommendation and a
  question, never with an artifact created on your own judgement.
- **The lighter tier wins a tie.** Ceremony on small work is what kills this practice. A
  spec that should have been a one-pager costs more than a one-pager that should have been
  a spec.

The rubric is [`.ai/rules/work-triage.md`](../../rules/work-triage.md). Read it — do not
reconstruct it from memory.

---

## Step 1: Intake

Accept any of:

- A ticket code — `TW-1234`
- A ticket URL — extract the code with `<letters>-<numbers>`
- Pasted ticket details
- An ad-hoc problem with no ticket → use the code `TW-0`

If you were given only a code or a URL, fetch the details with `jira_issue_get`.

**Two short-circuits, checked before anything else:**

1. **A spec already covers this work** — `docs/SPECs/<code>-*` exists, or the work is
   plainly a task inside one. Do **not** re-triage. Say which spec and which `task.N.md`,
   and hand off to [`implement-task`](../implement-task/SKILL.md).
2. **The developer stated the tier up front** — "make a spec for TW-1287", "just implement
   this". Honour it. Skip to Step 4 with that tier, and still show a one-line rationale so a
   mismatch is visible.

---

## Step 2: First analysis

A light, fast investigation — enough to judge complexity, not a design. Keep it cheap: this
step exists to make the triage honest, not to pre-empt Phase 2.

1. **Search before reading.** `docs_search` the *problem*, not the filename — the team may
   already have solved it, and a prior spike or guide changes the triage. See
   [`docs-index.md`](../../rules/docs-index.md).
2. **Locate the target repos.** [`configs/workspace-repos.json`](../../../configs/workspace-repos.json)
   is the registry — every entry carries `name`, `projectId` and `localPath`. Read the area
   README (`frontend/`, `backend/`, `libs/`) to spot cross-service dependencies.
3. **Determine** the primary service(s), the task type (`bug-fix` | `feature` |
   `enhancement`), and the rough shape of the change.
4. **Assess docs impact.** Note whether the change likely touches anything documented in
   `docs/` — architecture, business flows, a guide, a service README. This feeds the
   `Docs Impact` section of the artifact, so documentation is a planned deliverable rather
   than an afterthought.

For a bug, also establish **which environment it was seen in** (`dev` / `test` / `prod`) —
it changes both the investigation scope and the urgency.

---

## Step 3: Score the rubric

Apply [`work-triage.md`](../../rules/work-triage.md). Count how many of the eight signals
fire:

multi-repo · cross-team · needs non-dev roles · data-model or contract change · UX sign-off ·
many unknowns · hard to reverse · long-lived or phased

- **2+ → propose `spec`**
- **1, or a single-repo change that still wants a plan → propose `task`**
- **0 and genuinely trivial → propose `direct`**

Name the signals that fired. A count with no names is not reviewable, and the developer
overriding you needs to see what you counted.

---

## Step 4: Propose and confirm — always

Present:

- The tier you recommend
- The signals that fired, named, and the count
- A one-line rationale
- Where it will land — the exact artifact path, or "no artifact"

Then ask explicitly:

> **I recommend the `<tier>` approach — proceed, or choose a different tier (spec / task /
> direct)?**

**Wait for the answer.** The developer's choice overrides your recommendation, and an
override is a normal outcome rather than an exception.

---

## Step 5: Route

### → spec

A `spec` outcome means the work belongs in the **SDD path**, which normally starts with the
BA formalising the intent into an Epic ([Phase 1](../../../docs/sdlc/01-origination.md)).

- **Escalate rather than solo-author, by default.** Say that this should become a spec and
  that the BA and architect should be looped in.
- If the developer decides to author it themselves — legitimate, and their call — hand off
  to [`author-spec`](../author-spec/SKILL.md). **Pass the ticket details and your
  first-analysis findings** so it does not re-investigate from scratch.

### → task

1. Create `docs/tasks/<code>.task.md` from
   [`docs/tasks/_template.task.md`](../../../docs/tasks/_template.task.md). Naming:
   `<code>.task.md`, or `<code>.1.task.md`, `<code>.2.task.md` when one code needs several
   units.
2. Fill it from the first analysis — including a real `Docs Impact` section, or an explicit
   "none".
3. Hand off to [`implement-task`](../implement-task/SKILL.md), pointing at the new file.

Keep it a genuine one-pager. **If it starts growing requirements and design sections, that
is the signal it should have been a `spec`** — say so and offer to switch tiers rather than
letting a one-pager quietly become a bad spec.

### → direct

Hand off immediately to [`implement-task`](../implement-task/SKILL.md) with the raw code or
description. **Create no artifact.**

---

## Hand-off note

Both `task` and `direct` are executed by `implement-task`, which owns git setup, its own
in-chat plan confirmation, implementation, the quality gates, the MR, and the docs
deliverable. Your job ends once the tier is confirmed and — for `task` — the one-pager is
scaffolded.

---

## Never

- **Never create an artifact before the developer confirms the tier.** The proposal is the
  product of this skill; the file is a consequence of their answer.
- **Never re-triage work a spec already covers.** Implement its tasks.
- **Never let the analysis in Step 2 become the design.** If you find yourself deciding *how*
  rather than *how big*, you are in the wrong phase — that is `author-spec`'s job, or
  `implement-task`'s.
- **Never invent a project ID.** It comes from `configs/workspace-repos.json`. A wrong one
  points every downstream step at a stranger's repository.
- **Never round a hard call up to `spec` to be safe.** Ties go to the lighter tier, on
  purpose.

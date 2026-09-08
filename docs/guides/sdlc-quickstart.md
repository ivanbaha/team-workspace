# SDLC Quickstart

You have a ticket. What do you actually do?

This is the short, practical path through the [four phases](../sdlc/README.md). Read that
one when you want to know *why*; read this one when you want to start.

---

## 1. Is there already a spec for it?

```bash
ls docs/SPECs | grep -i <code>
```

**Yes** → there is nothing to triage. Open its `tasks.md`, pick the next unticked
`task.N.md`, and go to step 4.

**No** → keep reading.

## 2. Triage it

Ask the agent to run [`plan-task`](../../.ai/skills/plan-task/SKILL.md) — or count the
signals yourself, from [`work-triage.md`](../../.ai/rules/work-triage.md):

> multi-repo · cross-team · needs non-dev roles · data-model or contract change ·
> UX sign-off · many unknowns · hard to reverse · long-lived or phased

| Signals | Tier | What happens next |
| --- | --- | --- |
| **2+** | `spec` | Escalate — loop in the BA and architect, and go to step 3 |
| **1** | `task` | A one-pager lands in `docs/tasks/<code>.task.md`; go to step 4 |
| **0**, and trivial | `direct` | No artifact at all; go to step 4 |

**When it is a close call, take the lighter tier.** A spec that should have been a one-pager
costs more than the reverse.

The agent proposes and waits. Overriding it is normal — you have context it does not.

## 3. If it is spec-sized

Specs are authored in two stages, by two roles, and neither overwrites the other's
sections. Run [`author-spec`](../../.ai/skills/author-spec/SKILL.md); it will work out which
stage you are in from your role.

| You are… | You write | Then |
| --- | --- | --- |
| **BA / PO** | `requirements.md` with EARS criteria, the non-technical half of `design.md`, any must-have scenarios | Commit and push — that *is* the hand-off |
| **Architect / Dev** | The technical half of `design.md`, `tasks.md` + each `task.N.md`, `testing.auto.md` | Commit and push, then implement |

It pauses at four gates — requirements, design, tasks, tests — and will not draft ahead.
Use the pauses: most of what makes a spec correct is in your head, not in the repo.

Two things to get right, because everything downstream leans on them:

- **Every acceptance criterion must be decidable.** If QA cannot turn it into a pass/fail
  scenario, it is a requirements defect — fix the criterion, do not paper over it.
- **Fill in the correctness properties** in `design.md`. Invariants that must always hold,
  each naming the criteria it validates. It is the section that feeds the tests and survives
  the amendments.

## 4. Implement it

Ask the agent to run [`implement-task`](../../.ai/skills/implement-task/SKILL.md), pointing
at the `task.N.md`, the `.task.md`, or just the ticket.

What it will stop and ask you about:

- The **micro-plan**, before touching a file.
- Any **new public dependency**.
- Any **existing test that fails** because of the change.
- **The commit, the push, and the MR** — each one separately. Approval for the commit is not
  approval for the push.

The gates are **typecheck, tests, and the service starting**. Lint is not a gate and never
blocks delivery ([`code-style.md`](../../.ai/rules/code-style.md)).

Branch and commit conventions are in
[`git-workflow.md`](../../.ai/rules/git-workflow.md) — the short version:

```txt
feat/TW-1287-paginate-products
feat(TW-1287): added cursor pagination to the products list endpoint
```

## 5. Deliver the docs

After the push, the Docs Delivery Gate will remind you. Team docs live in **this** repo, so
they never ride in the service MR — they are their own commit here.

The agent reads the `Docs Impact` section you wrote at plan time, reconciles it against what
actually shipped, and proposes the edits. **"No `docs/` impact" is a valid answer** — say it
out loud rather than staying silent.

Then mention that `docs_search` is stale for anything you edited. Do not run
`yarn docs:ingest` yourself.

## 6. Close the loop

- **Spec task?** The executor ticks `tasks.md` and stamps the README Progress table. Check
  it did.
- **Something changed that the spec documented?** Hand back to `author-spec` for an
  amendment — same spec, criteria edited in place, CHANGELOG entry. Never leave a deviation
  that lives only in code.
- **Hand to QA.** They design the scenarios from `requirements.md`, not from what you built.
  Expect them to find criteria that cannot be tested; that feedback is the point.

---

## Common situations

**"It turned out much bigger than the triage said."**
Say so and switch tiers. A one-pager growing requirements and design sections is the signal.
Better to re-tier at hour three than to end up with a bad spec.

**"The requirements are wrong and I found out mid-implementation."**
That is normal, and it is an amendment to the same spec — not a code comment, and not a
silent deviation. `author-spec` handles it: edit the criterion in place, keep its number,
annotate it, bump the version, add a CHANGELOG entry.

**"There is no ticket."**
Use `TW-0`. It is almost always `direct` — just do it.

**"This is a follow-up to a feature we already spec'd."**
Default to amending that spec. A new linked spec is right only when the business outcome has
genuinely changed rather than been sharpened —
[the signal table](../../.ai/rules/work-triage.md#second-decision-the-work-touches-a-feature-that-already-has-a-spec)
decides, and it is a planning call, not the agent's.

**"Do I need a spec for a bug?"**
Almost never. A bug that reveals the *intended behaviour* was wrong is a spec amendment; a
bug that is just broken code is `task` or `direct`.

---

## Where things live

| | |
| --- | --- |
| The process, in full | [`docs/sdlc/`](../sdlc/README.md) |
| Why it is shaped this way | [SDD in Practice](../sdlc/sdd-in-practice.md) |
| Specs | [`docs/SPECs/`](../SPECs/README.md) · [template](../SPECs/_template/README.md) |
| Task one-pagers | [`docs/tasks/`](../tasks/README.md) · [template](../tasks/_template.task.md) |
| The triage rubric | [`work-triage.md`](../../.ai/rules/work-triage.md) |
| Writing criteria and estimates | [`requirements-and-estimates.md`](../../.ai/rules/requirements-and-estimates.md) |
| All the conventions | [CONTRIBUTING.md](../../CONTRIBUTING.md) |

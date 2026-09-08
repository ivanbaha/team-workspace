# Work Triage — Spec, Task, or Direct

How much process a piece of work earns. This is the single source of truth for the tier
decision, referenced by the [`plan-task`](../skills/plan-task/SKILL.md) skill and by any
developer making the call by hand.

Read it before starting work that arrived without a predetermined path — a ticket, a bug
report, a problem someone mentioned. **If a spec already covers the work, there is nothing
to triage**: implement its `task.N.md` files.

---

## The three tiers

| Tier | Artifact | For | Executed by |
| --- | --- | --- | --- |
| **spec** | [`docs/SPECs/<code>-<slug>/`](../../docs/SPECs/README.md) | Big or risky features that need requirements, design and a plan before code | [`author-spec`](../skills/author-spec/SKILL.md), then `implement-task` per task |
| **task** | [`docs/tasks/<code>.task.md`](../../docs/tasks/README.md) | Small, well-understood work that still benefits from a written plan | `plan-task` scaffolds it, [`implement-task`](../skills/implement-task/SKILL.md) executes |
| **direct** | _none_ | Trivial, low-risk fixes not worth tracking | `implement-task`, straight away |

---

## The signals

Count how many of these the work triggers:

1. **Multiple repos or services** — the change spans more than one repository.
2. **Cross-team coordination** — it needs a contract or a hand-off with another team, or
   with a repo we do not own.
3. **Needs non-dev roles** — a BA, architect, QA or AQA has to be involved for it to be
   delivered correctly.
4. **Data-model or contract change** — new or changed API contracts, DTOs, database schema,
   shared types, or events.
5. **UX sign-off** — new UI that needs design alignment or stakeholder review.
6. **Many unknowns** — the approach is not clear yet; it needs investigation or design
   decisions before any code.
7. **Hard to reverse, or a large blast radius** — auth, permissions, migrations, infra, or
   anything awkward to roll back.
8. **Long-lived or phased** — expected to evolve across several drops or tickets, so it
   will want a version history.

## The rule

- **2 or more signals → `spec`.**
- **Exactly 1 signal, or a clear single-repo change that still wants a written plan →
  `task`.**
- **0 signals and genuinely trivial** — a copy tweak, a one-line fix, a small bug with an
  obvious cause → **`direct`.**

**When it is ambiguous, take the lighter tier.** The failure mode worth defending against
is ceremony on small work: under-specification is visible and gets corrected, while
ceremony quietly kills the practice. A team that writes a spec per ticket stops writing
specs within a month.

This is a guideline, not a gate. `plan-task` always **proposes** a tier with its signal
count and reasoning, then waits. **The developer's explicit choice wins**, including when it
goes against the recommendation.

---

## Second decision: the work touches a feature that already has a spec

Once the tier is `spec`, there is a further call — and it is a **planning decision**, owned
by whoever is planning the work, not something the agent settles. Both answers are
legitimate. State the assessment, name the signals that decided it, and let them choose.

**Default — amend the existing spec.** Most follow-on work belongs in the spec that produced
it: refinements, corrections, blockers found while implementing, defects from testing or
production, and follow-up tickets that sharpen behaviour. The mechanics — edit criteria in
place, keep their numbers, bump the version, add a CHANGELOG entry — are in
[`author-spec`](../skills/author-spec/SKILL.md#step-6-amendments) and
[Phase 2](../../docs/sdlc/02-specification.md#amendments--the-default-is-the-same-spec).

**A large enough rework earns its own spec, linked to the old one.** Weigh these:

| Points to amending | Points to a new, linked spec |
| --- | --- |
| Same business outcome, sharpened | The outcome itself is different — this supersedes rather than refines |
| The affected criteria can be edited in place and still read coherently | An amended `requirements.md` would be mostly superseded wording, so "what is current" becomes ambiguous |
| Same surfaces and services; the task breakdown mostly holds | Little of the task breakdown or technical design survives |
| Ships as part of the same effort | Has its own Epic, timeline and fix version, and ships independently |
| The original is still in flight | The original is delivered and closed; this is a distinct next phase |

**The deciding question is which document a newcomer could trust.** The amendment habit
exists so history is not scattered — but a spec amended past the point where current and
superseded criteria are distinguishable fails that same test, and the resulting ambiguity
costs the quality of the new work.

**If a new spec is agreed, link it both ways.** The new spec's Intent names what it
supersedes, its Related Artifacts row points at the predecessor, and **the old spec gets a
version bump and a CHANGELOG entry** recording that the scope moved. Without that entry, the
superseded spec silently reads as current.

The one thing that is never acceptable either way: an **undocumented deviation** — changed
behaviour that lives only in code or a commit message.

---

## Artifact naming

| Case | Path |
| --- | --- |
| Task, one unit for a code | `docs/tasks/TW-1287.task.md` |
| Task, several units under one code | `docs/tasks/TW-1287.1.task.md`, `TW-1287.2.task.md`, … |
| Spec | `docs/SPECs/TW-1287-<short-slug>/` |
| Ad-hoc work with no ticket | code `TW-0` — almost always `direct`, and rarely needs a file |

---

## Notes

- A `spec` decomposes into `task.N.md` files implemented one at a time through the **same**
  `implement-task` executor. There is no separate "spec implementation" path.
- A `task` that starts growing requirements and design sections should have been a spec.
  Say so and offer to switch tiers — do not let a one-pager quietly become a bad spec.
- A `spec` outcome from triage normally means **escalate**, not solo-author: the SDD path
  starts with the BA formalising the intent into an Epic
  ([Phase 1](../../docs/sdlc/01-origination.md)). A developer authoring one alone is
  legitimate, but it is a decision, not the default.

Full process: [`docs/sdlc/`](../../docs/sdlc/README.md).

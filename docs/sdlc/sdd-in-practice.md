# SDD in Practice

**Audience:** anyone deciding whether to adopt this workflow, or wondering why it is shaped
the way it is.

The [phase docs](./README.md) say *what* to do. This one says *why*, what it costs, and
where it strains. Read it once; you will not need it again.

---

## 1. The one-paragraph version

We write the specification before the code, and we keep it in a repo the coding agent
reads. Work flows through four phases with named owners: a BA turns an idea into an Epic
and **seeds** a spec (requirements + business design); an architect or developer
**completes** it (technical design + task breakdown + automation scope); a developer
implements each task through a single executor that also handles git, the quality gates,
the MR and the docs; QA designs coverage from the acceptance criteria and verifies it. Big
features get the full path. Small work skips straight to development. Trivial fixes get no
artifact at all.

The part that makes it work is not the template. It is that **the specs, the team docs, the
conventions and the automation all live in one repo the agent has immediate access to** —
so "how we work" is not a wiki page people forget, it is context the tooling enforces.

To be precise about that, since it is the thing most often misread: nothing bulk-loads the
documentation into the model's context. A small set of rules is delivered on every session
through the [pointer files](../../CONTRIBUTING.md#keeping-the-pointers-in-sync); everything
else is *reachable* — the agent resolves what a given session needs on demand, through
`docs_search` and plain reading. That selectivity is the point. It is why the analysis is
grounded in the actual repo rather than in a summary of it, and why the corpus can keep
growing without diluting what the agent works from.

---

## 2. Where everything lives

| Thing | Path | Indexed for `docs_search`? |
| --- | --- | --- |
| Process — the four phases | [`docs/sdlc/`](./README.md) | yes |
| Specs | [`docs/SPECs/<code>-<slug>/`](../SPECs/README.md) | **no** — see below |
| Task one-pagers | [`docs/tasks/<code>.task.md`](../tasks/README.md) | **no** |
| Reference docs — how the system actually works | the rest of `docs/` | yes |
| Rules given to every agent | [`.ai/rules/`](../../.ai/rules/README.md) | **no** |
| Procedures the agent runs | [`.ai/skills/`](../../.ai/skills/README.md) | **no** |
| Guards on tool calls | [`scripts/hooks/`](../../scripts/hooks/README.md) | — |

The three exclusions are one decision made three times, and it is the single most important
retrieval decision in the workspace. **Specs and tasks describe intent; the rest of `docs/`
describes reality.** Retrieval has no notion of *planned* versus *shipped*, so an indexed
spec for a feature nobody built reads exactly like documentation of one that works — same
vocabulary, same confident declarative sentences, often *more* detail, because it was
written while someone was thinking hard about the problem. The result is an agent that
describes a feature that does not exist, which is strictly worse than finding nothing: a
missing answer is visible, a fabricated one is not.

Rules and skills are excluded for a related reason — they are instructions addressed to an
agent, already delivered by the agent runtime. Indexing them adds a second, worse delivery
path in which procedural text competes with reference docs on the domain words it
necessarily contains. Full reasoning:
[`mcp/src/docs/sources.js`](../../mcp/src/docs/sources.js).

None of this makes specs less useful. An agent pointed at `docs/SPECs/` reads them
directly, *knowing what they are*.

---

## 3. Triage is what keeps SDD affordable

The objection to spec-driven development is always the same, and it is correct: **most work
does not deserve a spec.** A team that writes one per ticket abandons the practice within a
month, and is right to.

So the first decision in the flow is how much process the work earns. Eight signals,
counted, in [`work-triage.md`](../../.ai/rules/work-triage.md): multi-repo, cross-team,
needs non-dev roles, data-model or contract change, UX sign-off, many unknowns, hard to
reverse, long-lived. **2+ → spec. 1 → a one-page task. 0 and trivial → nothing at all.**

Three properties make the rubric survive contact with reality:

- **It is counted, not argued.** A rubric you can disagree with is a rubric you will
  disagree with, every time, in a meeting.
- **Ties go to the lighter tier.** The failure mode being defended against is ceremony on
  small work, not under-specification of large work — the second is visible and gets fixed;
  the first quietly kills adoption.
- **The agent proposes; the developer decides.** `plan-task` shows the signals it counted
  and its recommendation, then waits. An override is a normal outcome, not an exception.

The honest consequence: **Phase 2 is skipped more often than it runs.** That is the design
working, not the process being ignored.

---

## 4. Staged authoring is what makes collaboration possible

A spec written by one person is a document. A spec written by three is a merge conflict —
unless the sections are owned.

| Stage | Owner | Owns these sections |
| --- | --- | --- |
| **A · Seed** | BA / PO | Intent, summary, `requirements.md`, non-technical `design.md` (UI, UX, business rules), optional must-have scenarios, meta files |
| **B · Complete** | Architect / Dev | Technical `design.md` (architecture, API, types, data flow, correctness properties, Docs Impact), `tasks.md` + `task.N.md`, `testing.auto.md` |

**Never overwrite another stage's sections.** Fill your own, leave theirs as placeholders,
flag the gaps you need closed. The hand-off is a commit and a push — no ceremony, no
meeting, no document attached to an email.

Two rules inside this that are easy to get wrong:

**Stage B goes to expertise, not to the implementer.** The technical design caps the
quality of everything downstream, so it is worth the most experienced person available. The
implementation may then go to anyone — or to several people at once, which is what the
`waves` graph in `tasks.md` exists to make safe.

**Coverage is designed by QA, not by the BA and not by the developer.** A BA writes
scenarios from what they intended; a developer from what they built. Both are blind in the
same places. QA deriving coverage independently from the acceptance criteria is what lets a
scenario fail because the feature is *wrong* rather than because everyone shared an
assumption. A spec with no `testing.manual.md` is therefore not incomplete — it means the
BA had no must-have case.

---

## 5. Four gates, and why they are mandatory

`author-spec` pauses after each major artifact and asks for approval:

1. Meta files + requirements
2. Design
3. Tasks
4. Tests

It does not draft ahead. The reason is specific to working with an agent: a model that
produces requirements, design and a task breakdown in one pass produces a *coherent* set —
each artifact consistent with the previous one, including where the previous one was wrong.
Reviewing that is much harder than reviewing four separate steps, because the errors have
already been propagated and justified.

The gates are also where the operator's knowledge enters. Most of what makes a spec correct
is not in the repo — it is a constraint another team mentioned, or a decision taken last
quarter. The pause is the moment that arrives.

---

## 6. The highest-value section of a spec

If you adopt one thing from the template, make it **correctness properties** in
`design.md`.

Requirements say what the system does. Properties say what must always be true, and each
one names the criteria it validates:

```markdown
### Property 2: Availability never goes negative
No sequence of reservations and releases can drive `available` below zero, including
concurrent ones on the same SKU.
**Validates: Requirements 2.1, 2.4**
```

They are the section that feeds unit tests and automation directly, they are what a
reviewer checks the implementation against, and they are the part a newcomer reads to
understand the shape of the thing. Prose in an Overview does not survive contact with a
year of amendments; an invariant does.

---

## 7. Amendments — the discipline that decides whether specs stay honest

**Later change to a feature goes back into its original spec.** Requirements that changed
during implementation, a wrong assumption found while building, defects from testing or
production, a follow-up ticket that refines behaviour — all of it edits the original
criteria in place, keeping their numbers, with a version bump and a CHANGELOG entry.

The reason is that the spec is what somebody reads months later to understand *why the
feature behaves like this*. Scatter that history across documents and none of them is
authoritative. Leave a change out and the spec actively misleads.

**A superseded criterion with a recorded reason is useful. One that still reads as current
is worse than no criterion at all.** That is the whole argument for annotating in place
rather than rewriting.

The exception is scale. When the incoming scope is large enough that an amended
`requirements.md` would be dominated by superseded wording, a new linked spec is the more
honest answer — and the link goes both ways, including a CHANGELOG entry on the old spec
recording that the scope moved. Without that entry the superseded spec silently reads as
current, which is the exact failure the amendment habit exists to prevent.

The one thing that is never acceptable either way: an **undocumented deviation** — changed
behaviour that exists only in code or in a commit message.

---

## 8. Documentation as a tracked deliverable

Docs are the step that gets skipped, universally, because nothing fails when they are
missing. So here they are made structurally hard to skip:

1. **Declared while planning** — `Docs Impact` in the task one-pager or the spec's
   `design.md`, written when the change is understood rather than remembered.
2. **Triggered by the push** — a hook fires after a completed push and tells the agent to
   account for the deliverable.
3. **Reconciled, not recited** — the agent compares what was planned against what actually
   shipped, and updates the docs even when the plan said "none".
4. **Proposed, never auto-pushed** — the operator confirms.
5. **"No impact" is a valid answer**, said out loud. A conscious "none" is fine; a silent
   omission is not.

Two things make this worth the ceremony. Documentation written a week later is written from
memory, by which point the non-obvious decision — the one worth writing down — is gone. And
an indexed doc that has become wrong is worse than a missing one, because `docs_search` will
answer from it with confidence.

---

## 9. Feature owning

**One developer carries a feature from its technical spec to production**, including the
fixes verification turns up. The owner accumulates the context that is never written down —
which options were rejected, which external constraint forced an awkward shape, where the
fragile edges are — and most defects live in the hand-offs this removes.

The standard objection is bus factor. The answer is the spec: requirements, design,
decisions with reasoning, the task breakdown with its ordering rules, and a CHANGELOG of
everything since v1.0. Ramp-up becomes reading time rather than re-investigation.

Which is worth stating plainly, because it cuts both ways: **feature owning without a spec
is a genuine bus-factor risk.** The two practices are not independent, and adopting the
ownership model without the artifact is the version of this that fails.

---

## 10. What is actually enforced, versus what is written down

A process document is a suggestion. These are the parts the tooling holds:

| Enforced by | What it holds |
| --- | --- |
| **Skills** | The stopping points. `author-spec` will not draft past an unapproved gate; `review-mr` posts nothing without per-item approval; `release-mr` refuses `dev` → `prod`; `implement-task` will not commit or push without approval for that specific action |
| **Hooks** | The expensive-to-undo cases: a credential guard, a protected-branch guard, a docs-index staleness notice, a git-ops overlay build check, and the docs delivery gate |
| **Generators** | `yarn agents:check` fails CI when a rule pointer or skill wrapper has drifted from its canonical source, so the same skill cannot mean different things to different agents |
| **Nothing** | Everything else — the tier you pick, the quality of a criterion, whether you actually read the docs first. Process is not a substitute for judgement, and pretending otherwise is how teams end up with elaborate ceremony and bad specs |

---

## 11. Honest limitations

- **Specs cost real effort.** A large feature's design can run to several hundred lines.
  That is only justified by blast radius — many services, an authorisation model, a data
  migration. It is not a template for a two-day change, which is exactly why the triage
  rubric is the first step and not the last.
- **The estimate calibration is a starting proposal, not history.** The point-to-shape
  table in
  [`requirements-and-estimates.md`](../../.ai/rules/requirements-and-estimates.md#part-3--approximate-estimates)
  is labelled as such. Confirm it against your own actuals before using it in planning.
- **The tracker conventions in [Phase 1](./01-origination.md#tracker-conventions) assume a
  tracker with Epics, Stories and Tasks.** The shapes map onto most tools, but the field
  names will not — adapt them rather than inventing an issue type to match the doc.
- **Retrieval quality versus spec volume is an open question.** Specs are excluded from the
  index today, which sidesteps it. If searching them ever becomes necessary, the right
  shape is a *separate collection behind a separate tool*, so the caller chooses between
  "what is planned?" and "what is true?" instead of being handed a blend with no way to
  tell which is which. Not built.
- **The QA-owned coverage split needs a QA engineer who will exercise it.** Where a
  developer ends up writing the scenarios, you have the format without the property that
  made it worth having — say so, rather than claiming the coverage is independent.
- **None of this survives being adopted partially in the wrong order.** The failure mode is
  taking the spec template and skipping the triage rubric: every ticket gets a spec, the
  specs get thin, and within a month nobody reads them.

---

## 12. If you want to try this

In the order that makes each step pay for itself:

1. **The triage rubric first** ([`work-triage.md`](../../.ai/rules/work-triage.md)). On its
   own, with no specs at all, it stops the arguments about how much process something
   needs.
2. **The task one-pager** ([`docs/tasks/`](../tasks/README.md)). One page, five minutes,
   and it is where most work actually lands.
3. **EARS acceptance criteria**, even without a spec folder. Observable, independently
   testable, decidable — most of the value of a spec is in this one habit.
4. **One real spec**, on something with genuine blast radius. Use
   [the template](../SPECs/_template/README.md), and take the gates seriously.
5. **The docs deliverable**, once implementation is flowing. It is the step that decays
   first, and the hook is what stops it.
6. **The rest of the automation**, last. Skills and hooks encode a process; they cannot
   invent one.

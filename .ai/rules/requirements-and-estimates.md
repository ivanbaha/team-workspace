# Requirements, Scope & Estimates

How to turn an intent into requirements, a scope breakdown, and a rough estimate. Read it
when writing or reviewing a `requirements.md`, and when sizing work before a spec exists.

This is the BA/PO-facing counterpart to [`work-triage.md`](./work-triage.md), which decides
*how much process* the work earns. This one decides *what the work actually is*.

---

## Ground rules

- **Business language first.** Requirements describe observable behaviour and outcomes, not
  implementation. "THE System SHALL", not "the service SHALL call".
- **Ground every statement.** Read the relevant docs (`docs_search` first — see
  [`docs-index.md`](./docs-index.md)) and the target repos before writing. Never draft from
  a ticket title alone; that is how a requirement ends up describing a system we do not
  have.
- **Flag, don't decide.** Anything needing an approach, architecture or data-model call goes
  into an **Open Decisions** list addressed to the architect. Do not invent the technical
  answer to make the estimate look tidier — an open decision on the record is worth more
  than a guess presented as a design.
- **Separate effort from commitment.** Produce the analysis and the numbers; the tech lead
  owns the final estimate and the PO owns the commitment.

---

## Part 1 — Requirements

### Shape

Follow [the template](../../docs/SPECs/_template/requirements.md): Introduction, Glossary,
Out of Scope, then numbered requirements, each with a user story and EARS criteria.

```txt
WHEN <trigger>, THE System SHALL <observable behaviour>.
IF <condition>, THEN THE System SHALL <observable behaviour>.
```

One requirement = one coherent capability a stakeholder would recognise. If a requirement
needs more than about six criteria, it is probably two requirements.

### Every criterion must be

- **Observable** — a tester can see it happen without reading code.
- **Independently testable** — it maps to exactly one scenario.
- **Unambiguous** — no "properly", "correctly", "as needed", "if applicable".
- **Decidable** — a definite pass or fail, including for the negative path.

A criterion QA cannot turn into a decidable scenario is a **requirements defect**, not a QA
problem. Expect that feedback and treat it as valuable.

### Interrogate these gaps before declaring requirements ready

Walk the list and either cover each row or record it as out of scope. **Silence here is the
main source of mid-sprint surprises**, and every row below is one somebody has been bitten
by.

| Area | Ask |
| --- | --- |
| Roles & permissions | Which roles can see or do this? Does any authorisation rule change? |
| Scoping | Is the data filtered by tenant, region, customer, or owner? |
| States | Empty, loading, partial data, error — what does the user actually see? |
| Validation | What is rejected, and what message does the user get? |
| Volume | Does this need pagination, search or bulk actions to be usable at real size? |
| Existing data | Do existing records need a backfill or migration? Who runs it, and when? |
| Concurrency | What happens when two people do this at once? |
| Notifications | Does anyone need to be told when this happens? |
| Audit | Must the change be traceable to a user and a time? |
| Integrations | Does another team own part of the data or the flow? |
| Rollout | Feature-flagged? Environment-specific? |
| Reversibility | Can the user undo it? Can we roll the release back safely? |

### Definition of ready

- [ ] The intent is recorded in the Epic and mirrored in the spec README.
- [ ] Every requirement has a user story and at least one EARS criterion.
- [ ] Roles, permissions and data scoping are stated explicitly.
- [ ] The out-of-scope list is written down.
- [ ] Open Decisions are listed and addressed to an owner.
- [ ] External dependencies are named, with their current status.

### Does this belong in an existing spec?

Before writing requirements for something that touches a feature already spec'd, decide
which document it lands in. **Amending the existing spec is the default**; a large enough
rework earns a new, linked one. The signals and the linking rules are in
[`work-triage.md` § Second decision](./work-triage.md#second-decision-the-work-touches-a-feature-that-already-has-a-spec).

---

## Part 2 — Scope breakdown

Before tasks exist, carve the feature into **slices a stakeholder can understand**. This is
not the `task.N.md` breakdown — that is Stage B, owned by the architect or developer.

### Method

1. **Trace the flow end to end** — where data originates, where it is stored, where it is
   displayed, who acts on it.
2. **Name the touched areas.** Frontends, services, shared libraries, infra and env config,
   `docs/`.
3. **Group into slices — one per service.** See the rule below.
4. **Mark MVP vs. later.** Always propose a thinner first drop.
5. **Call out unknowns as explicit investigation slices.** An unknown is scope.

### One service, one issue

**A slice is bounded by the service, not by the requirement.** All the work landing in one
repo is one slice and one issue, however many requirements it satisfies.

Do **not** raise a separate issue per requirement, per column, per filter, per screen
element, or per acceptance criterion. That inflates the backlog, spreads one MR across
several tickets, and makes the estimate look bigger than the work.

- Two repos touched → two issues. Three repos → three.
- Several requirements satisfied inside one repo → still one issue. List the requirement
  numbers in its description.
- Split **within** a service only when delivery is genuinely staged across releases, or when
  one part is blocked and the other can ship. Then use the trailing slice marker:
  `[repo] Capability - <slice>`.
- Work that is not a code change in a service gets its own issue regardless: technical
  design, manual QA, automation, data backfill, infra or env config.

**Sanity check before creating anything:** count the distinct repos, add the non-dev items,
and that is your issue count. More issues than that means you have split by requirement
instead of by service.

### Output format

One row per service, plus a row for each non-dev item.

| # | Slice | Repo | Requirements | Why it's needed | MVP? | Points | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <what changes in that repo> | `backend/products-service` | R1, R3 | <business reason> | yes | 5 | Med |
| 2 | <what changes in that repo> | `frontend/products-frontend` | R2 | <business reason> | yes | 3 | Med |
| 3 | <investigation> | — | — | <what we don't know yet> | yes | 2 | Low |

Always accompanied by:

- **Out of scope** — as bullets, so the boundary is on the record.
- **Open Decisions** — for the architect.
- **External dependencies** — team, what is needed, current status.

---

## Part 3 — Approximate estimates

> **Calibrate before you rely on this.** The reference shapes below are a starting
> proposal, not history from this team. Confirm them with the tech lead, and adjust once
> there are actuals to compare against.

### Scale — story points, Fibonacci only

Estimates are story points from **1, 2, 3, 5, 8**. Nothing else is a valid estimate: no 4,
no 6, no 13, no decimals, no ranges (`3` — never `2–3`), no `?`.

Points cover implementation, unit tests and review for one developer. They **exclude**
manual QA, automation and release work — those are their own slices.

**Estimate slices, never requirements.**

| Points | Typical shape |
| --- | --- |
| 1 | Copy or config tweak, one-line fix, contained change in one file, no contract change |
| 2 | Small change in one area, following an existing pattern, no contract change |
| 3 | A new endpoint or screen section within existing patterns |
| 5 | A new flow across layers, a new data model, or a migration |
| 8 | Large or uncertain — **prefer splitting**; leave it at 8 only if the slice genuinely cannot be cut |
| >8 | Not an estimate. **Split the slice.** |

### Adders

Adders never produce a non-Fibonacci number. They bump the slice **up one step** on the
1 → 2 → 3 → 5 → 8 ladder, or become their own slice.

| Factor | Effect |
| --- | --- |
| Each additional repo touched | +1 step — a contract, two MRs, and an ordering rule |
| Authorisation or permissions change | +1 step, or its own 1-point slice |
| Data backfill or migration | Its own slice, 3 or 5, plus a dry run on `test` |
| A new public dependency, or an infra change | +1 step, and flag it — it needs approval |
| `docs/` update | Folded into the slice. No extra points |
| Manual QA | Its own slice, sized by QA |
| E2E automation | Its own slice per scenario group, sized by AQA — usually a later drop |

### Rules

- **One number per slice**, from 1, 2, 3, 5, 8. If two numbers feel right, take the higher
  one and say why in the assumptions.
- **Confidence is part of the answer.** High = known pattern in known code. Medium = one
  open decision. Low = the approach is undecided, or another team is involved — do not
  stretch the number; raise it one step, or replace it with a spike slice.
- **Points are relative size, not days.** Never present them as a duration. Converting to
  calendar time is the tech lead's call, with a stated capacity assumption. Cross-team lead
  time is calendar days, tracked separately from points.
- **State the assumptions the number depends on.** If an assumption breaks, the estimate is
  void — say so explicitly.
- **Above 8 means split**, not a bigger guess.
- Where the estimate hinges on a technical approach, present it as *"3 if <approach A>, 8 if
  <approach B> — needs an architect's call"*.
- **The total is a sum of points**, reported as a plain number.

### Summary block

```txt
Scope:     <one line>
Slices:    <n>  ·  MVP: <n>
Estimate:  <total> points (MVP <n> points), confidence <High|Med|Low>
Excludes:  manual QA, automation, release
Assumes:   <the two or three assumptions it rests on>
Blocked:   <items needing a decision, and who owns each>
```

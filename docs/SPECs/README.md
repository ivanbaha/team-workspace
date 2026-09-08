# SPECs

Feature specifications — the durable record of *what we intend to build and why*.

A spec is the artifact of **Phase 2** of the [SDLC](../sdlc/README.md). It is written
before the code, authored in two role-scoped stages, and kept afterwards as the decision
record. It is not a design doc that gets thrown away once the branch merges.

Specs are kept **tool-neutral** and live here in `docs/` rather than inside any one
assistant's directory (`.kiro/`, `.github/`, `.claude/`, …). Editors and agents change; the
team's specifications outlive them, and anything that survives a tooling migration belongs
in `docs/`.

---

## When a spec is the right artifact

Only for work the [triage rubric](../../.ai/rules/work-triage.md) scores at **two or more
signals** — multi-repo, cross-team, needs non-dev roles, a data-model or contract change,
UX sign-off, many unknowns, hard to reverse, long-lived.

Everything else gets a [one-page task](../tasks/README.md) or no artifact at all. **Most
work does not deserve a spec**, and a team that writes one per ticket stops writing them
within a month. The rubric exists to protect the practice from itself.

## Naming and layout

```txt
docs/SPECs/<code>-<slug>/
├── README.md          # metadata, intent, implementors, progress, links
├── requirements.md    # EARS acceptance criteria             (Stage A · BA)
├── design.md          # non-technical (Stage A) + technical  (Stage B)
├── tasks.md           # task index + waves dependency graph  (Stage B)
├── task.N.md          # one per independently deliverable unit
├── testing.md         # index + the shared data-testid contract
├── testing.manual.md  # must-have scenarios only  (Stage A, optional; QA owns the full set)
├── testing.auto.md    # E2E automation scope                 (Stage B)
└── CHANGELOG.md       # from v1.1 onward
```

`<code>` is the ticket code, `<slug>` a short hyphenated feature name —
`TW-1287-paginate-product-listing`. Copy [`_template/`](./_template/README.md) to start;
delete the files that do not apply, but keep `README`, `requirements`, `design` and `tasks`
as the mandatory core.

## How one gets written

Two stages, two owners, and neither overwrites the other's sections. The hand-off is a
commit and a push.

| Stage | Owner | Produces |
| --- | --- | --- |
| **A · Seed** | BA / PO | Intent, summary, `requirements.md`, non-technical `design.md`, optional must-have scenarios, meta files |
| **B · Complete** | Architect / Dev | Technical `design.md`, `tasks.md` + `task.N.md`, `testing.auto.md` |

The [`author-spec`](../../.ai/skills/author-spec/SKILL.md) skill runs this, pausing at four
mandatory review gates. Full detail: [Phase 2 · Specification](../sdlc/02-specification.md).

## Amendments

**Later change to a feature goes back into its original spec** — edited in place, criterion
numbers kept, annotated inline, with a version bump and a CHANGELOG entry. That includes
defects found after the feature is live.

The exception is a rework large enough that the amended requirements would be dominated by
superseded wording; then a **new linked spec** is more honest, and the link goes both ways.
The signals are in
[`work-triage.md` § Second decision](../../.ai/rules/work-triage.md#second-decision-the-work-touches-a-feature-that-already-has-a-spec).

What is never acceptable either way is an **undocumented deviation** — changed behaviour
that exists only in code or a commit message.

---

## Excluded from the search index — on purpose

`docs/SPECs/**` is the one part of `docs/` that `docs_search` does **not** index:

```javascript
// mcp/src/docs/sources.js
{ base: 'docs', match: 'all', exclude: ['SPECs', 'tasks'] },
```

Specs describe **intent**. The rest of `docs/` describes **reality**. Retrieval cannot tell
the two apart — it has no notion of *planned* versus *shipped* — so an indexed spec for a
feature that was never built reads exactly like documentation of one that works. Same
vocabulary, same confident declarative sentences, often *more* detail, because it was
written while someone was thinking hard about the problem.

The result is an agent that confidently describes a feature that does not exist. That is
worse than finding nothing: a missing answer is visible, a fabricated one is not.

Full reasoning, including the duplication and trust-erosion effects:
[Corpus hygiene](../architecture/docs-rag.md#case-study-why-specs-and-tasks-are-the-worst-offenders).

**This does not make specs less useful.** An agent pointed at `docs/SPECs/` reads them
directly, *knowing what they are* — and the skills that need one
([`implement-task`](../../.ai/skills/implement-task/SKILL.md),
[`review-mr`](../../.ai/skills/review-mr/SKILL.md)) open it by path rather than searching
for it. The exclusion only stops specs competing with reference documentation in a single
undifferentiated ranked list.

If searching them ever becomes necessary, the right shape is a **separate collection behind
a separate tool** — so the caller chooses between "what is planned?" and "what is true?"
instead of being handed a blend with no way to tell which is which.

---

## When a spec ships

A spec is finished when the feature ships — which is exactly when its content stops being
safe to read as a description of the system:

1. **Move what is still true into the indexed docs** (`architecture/`, `business/`, or the
   service README). That copy is what people and agents should find.
2. **Leave the spec here as the decision record** — the "why we rejected X" part that
   reference documentation never carries well.
3. **Do not duplicate the same content in both.** Two documents covering one topic split
   the ranking between them, so neither wins.

If a spec is abandoned rather than shipped, **say so at the top of the file**. A plan that
nobody marked as dead is the single most misleading document a repository can contain.

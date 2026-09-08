# .ai/skills — Canonical Skills

A **skill** is a written procedure for a job that takes many steps and has to come out the
same way every time: reviewing someone's merge request, cutting a release, turning a security
scan into a verified fix. Improvising those produces a different result every run, and the
differences are exactly the parts that matter.

Each skill is written once here, as plain markdown. Every agent reads the same text.

---

## The skills

Four of them form the delivery lifecycle — triage, spec, implement, review — and are
described end to end in [`docs/sdlc/`](../../docs/sdlc/README.md). The rest are jobs that
stand on their own.

| Skill | Use it when | Scripts |
| --- | --- | --- |
| [`plan-task`](./plan-task/SKILL.md) | Starting new work that arrived without a plan — it triages to spec / task / direct | — |
| [`author-spec`](./author-spec/SKILL.md) | Writing or amending a feature spec under `docs/SPECs/` | — |
| [`implement-task`](./implement-task/SKILL.md) | Executing one unit of work end to end, through to the MR and the docs deliverable | — |
| [`review-mr`](./review-mr/SKILL.md) | Reviewing a merge request — first pass or a follow-up turn | — |
| [`release-mr`](./release-mr/SKILL.md) | Promoting versions `dev` → `test` or `test` → `prod` in `infra/git-ops` | 4 |
| [`fix-security-vulnerabilities`](./fix-security-vulnerabilities/SKILL.md) | A container scan or dependency audit found vulnerabilities | 4 |
| [`debug-and-report`](./debug-and-report/SKILL.md) | Debugging an environment issue from logs and code, then raising the bug | — |

---

## How a skill reaches an agent

One canonical body, four thin wrappers. Each agent reads the path it already looks in, and
the wrapper carries only the frontmatter that agent needs for discovery plus a pointer back
here.

| Tool | Wrapper | How it is invoked |
| --- | --- | --- |
| **Antigravity** | `.agents/skills/<name>/SKILL.md` | Automatic |
| **Kiro** | `.kiro/skills/<name>/SKILL.md` | Automatic (transcludes the canonical file) |
| **GitHub Copilot** | `.github/skills/<name>/SKILL.md` | Automatic |
| **Claude Code** | `.claude/commands/<name>.md` | `/<name>` slash command |

**The wrappers are generated. Do not hand-edit them.**

```bash
yarn skills:sync     # regenerate every wrapper from the canonical frontmatter
yarn skills:check    # fail if any has drifted (use in CI)
```

The `name` and `description` in a canonical `SKILL.md`'s frontmatter are the source for all
four wrappers. That matters more than it sounds: hand-copied descriptions drift, and a skill
whose description differs per agent *triggers* differently per agent — the same request runs
the skill in one tool and not in another, for no visible reason.

---

## Writing a skill

The description is the trigger. Write it as *"do X … Use when the user says A, B, or C"* —
concrete phrasings, because that is what the agent matches against.

The body is a procedure. What makes one worth writing rather than leaving to judgement:

- **Numbered steps with a stated stopping point.** "Wait for the user's answer before
  proceeding to Step 7" is the whole value of a skill in a workflow that can post to other
  people's repos or move production versions.
- **The reasoning, not only the instruction.** A step that says *what* is followed once and
  worked around the next time the situation is slightly different. A step that says *why*
  survives the variation.
- **An explicit `Never` list at the end.** The failure modes that are cheap to describe and
  expensive to hit.
- **The stopping points stated as gates, not as advice.** `author-spec` pauses after each
  artifact and will not draft ahead; `implement-task` will not commit without approval for
  that specific commit. A model that produces four coherent artifacts in one pass has also
  propagated its first mistake through all four — the pause is what makes that reviewable.
- **Scripts for anything mechanical, prose for anything that is a decision.** `release-mr`
  scripts the version copy and deliberately leaves the configuration changes to hand-editing,
  because each one is an individual judgement — a script there would invite applying them in
  bulk, which is the actual risk.

Skill scripts live in `<skill>/scripts/`, share a `<skill>/scripts/lib/`, and write scratch
output to `<skill>/output/` (git-ignored — never commit it). They are plain Node with no
dependencies beyond Node 18+, the same rule the connectors follow.

---

## Adding one

1. `.ai/skills/<name>/SKILL.md`, with `name` and `description` frontmatter.
2. `yarn skills:sync` to generate the four wrappers.
3. A row in the table above, and in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

Skills are **not** in the `docs_search` index, and that is deliberate — they are instructions
addressed to an agent, already delivered by the agent runtime. Indexing them would put
procedural text into a ranked list against reference docs, matching on the domain words it
necessarily contains. See the comment block in
[`mcp/src/docs/sources.js`](../../mcp/src/docs/sources.js).

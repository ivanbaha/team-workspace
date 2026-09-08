<!--
  SPEC TEMPLATE — copy this folder to `docs/SPECs/<code>-<slug>/` and fill it in.
  Delete the files you don't need (e.g. testing.auto.md when there is no automation
  scope), but keep README / requirements / design / tasks as the mandatory core.
  Process: docs/sdlc/02-specification.md · Skill: .ai/skills/author-spec/SKILL.md
-->

# <CODE> — <Feature Title>

## Metadata

- **Version:** 1.0
- **Updated at:** <YYYY-MM-DD>

## Intent

[<CODE>: <Epic title>](<tracker-url>)

<!--
  Put the intent here, in about 150 words: which system surfaces this touches, and what
  must not break. The *full* intent lives in the Epic — the tracker is written for people
  without the workspace, this file is written for the people building it.
  If this section grows past a screen, it has become design. Move it to design.md.
  If this spec supersedes or continues another one, say so here and link it.
-->

## Summary

<1–3 sentences: what this feature delivers, and for whom.>

## Implementors

<!-- The people actually assigned. Roles, not job titles — one person may hold several. -->

| Role | Person |
| --- | --- |
| BA / PO | <name> |
| Architect | <name> |
| Developer | <name> |
| Manual QA | <name> |
| AQA | <name> |

## Progress

<!--
  Stamp each item with — <date> — <person> as it completes. The executor
  (.ai/skills/implement-task) updates these rows itself when it delivers a spec task.
  A progress table that lies is worse than no progress table.
-->

- [ ] Requirements *(Stage A — BA)* — <date> — <person>
- [ ] Non-technical design: UI/UX + business rules *(Stage A — BA)* — <date> — <person>
- [ ] Must-have test scenarios *(Stage A — BA, optional)* — <date> — <person>
- [ ] Technical design: architecture / API / types *(Stage B — Architect/Dev)* — <date> — <person>
- [ ] Task breakdown *(Stage B — Architect/Dev)* — <date> — <person>
- [ ] Automation scope *(Stage B — Architect/Dev)* — <date> — <person>
- [ ] Implementation — <person>
- [ ] Unit tests — <person>
- [ ] MR merged — <person>
- [ ] Docs delivered — <person>
- [ ] Test scenarios designed from the criteria — @QA
- [ ] Automation tests — @AQA *(or a developer, from the manual scenarios)*
- [ ] Manual testing on `test` — @QA
- [ ] Promoted to `prod` —
- [ ] Post-release verification — @QA

## Spec Files

| File | Description |
| --- | --- |
| [requirements.md](./requirements.md) | Business requirements and EARS acceptance criteria |
| [design.md](./design.md) | UX and business rules, then architecture, types and data models |
| [tasks.md](./tasks.md) | Task index, tracking, and the dependency graph |
| [task.1.md](./task.1.md) | Task 1: <short description> |
| [testing.md](./testing.md) | Testing index + the shared `data-testid` contract |
| [testing.manual.md](./testing.manual.md) | Manual test scenarios |
| [testing.auto.md](./testing.auto.md) | E2E automation scope |
| [CHANGELOG.md](./CHANGELOG.md) | Spec versions, from v1.1 onward |

## Related Artifacts

| Type | Link | Status |
| --- | --- | --- |
| Epic | [<CODE>](<url>) | — |
| Design (Figma / mockups) | [<node>](<url>) | — |
| Predecessor spec | [<code>-<slug>](../<code>-<slug>/README.md) | — |
| MR: `<repo>` | TBD | — |

## Open Decisions

<!--
  Anything that needs an approach, architecture or data-model call, addressed to whoever
  owns it. Do not invent the technical answer to make the spec look finished — an open
  decision on the record is worth more than a guess presented as a design.
-->

- [ ] <question> — owner: <role>

# .ai/rules — Canonical Workspace Rules

This directory is the **single source of truth** for how work is done in this workspace:
git workflow, code style, what the environments mean, which commands the agent must not
run, how to find things before building them, and how much process a piece of work earns.

The last two are the planning rules — [`work-triage.md`](./work-triage.md) and
[`requirements-and-estimates.md`](./requirements-and-estimates.md). They belong here rather
than in `docs/` for the same reason as the rest: they are instructions the agent acts on,
not knowledge about the system. The *lifecycle* they sit inside — who owns which phase, and
what each hands off — is documentation, and lives in
[`docs/sdlc/`](../../docs/sdlc/README.md).

Every coding agent gets the same rules. They are plain markdown with no tool-specific
frontmatter, so Claude Code, Kiro, Copilot, Cursor, Antigravity — or a human — read the
identical text.

## The files

| File | Covers |
| --- | --- |
| [git-workflow.md](./git-workflow.md) | Branch names, commit format, why the prefix matters, MR description shape, pushing |
| [code-style.md](./code-style.md) | Comments, what the real gates are, diff hygiene |
| [environments-and-ownership.md](./environments-and-ownership.md) | What `dev`/`test`/`prod` mean, how a version is promoted, which repos we own |
| [local-environment.md](./local-environment.md) | Commands the agent hands to the operator, and how to behave when the shell degrades |
| [docs-index.md](./docs-index.md) | Search before you grep or build; keeping the index current |
| [work-triage.md](./work-triage.md) | How much process a piece of work earns — spec, one-page task, or nothing — and whether new scope amends an existing spec or starts a new one |
| [requirements-and-estimates.md](./requirements-and-estimates.md) | Writing EARS acceptance criteria, the gap-interrogation checklist, slicing scope one-issue-per-service, and Fibonacci-only estimates |

## How the rules reach an agent

One canonical body, many thin pointers. Each tool reads its own conventional path, and
every one of those files says the same thing: *the rules are in `CONTRIBUTING.md`, which
indexes `.ai/rules/`*.

| Tool | Pointer file |
| --- | --- |
| Any / de-facto standard | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Antigravity | `.agents/AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Kiro | `.kiro/steering/00-workspace-rules.md` |
| Cursor | `.cursor/rules/workspace-rules.md` |

**The pointer files are generated. Do not hand-edit them.** They are written from one
template by `scripts/sync-agent-rules.mjs`:

```bash
yarn rules:sync     # regenerate every pointer file
yarn rules:check    # fail if any pointer has drifted (use in CI)
```

Six identical files is a maintenance smell only when they are maintained by hand. Generate
them, verify them in CI, and the duplication costs nothing — while every agent still finds
the rules at the path it already looks in.

**Every rule here is listed in every pointer, and that is a budget decision.** The pointer
is what an agent reads on every session; the rules themselves are read on demand. So a rule
earns its line in the pointer by being one an agent would otherwise get wrong — which is why
there are seven of these and not thirty.

## Why rules live here and not in `docs/`

`docs/` is *knowledge* — how the system works, indexed for `docs_search`. `.ai/rules/` is
*instructions addressed to an agent*. Mixing the two in one ranked list means procedural
text competes with reference docs on the domain words it necessarily contains, which is the
same reason `.ai/skills/` is excluded from the index. See the comment block in
[`mcp/src/docs/sources.js`](../../mcp/src/docs/sources.js).

The rules are delivered by the agent runtime, through the pointer files above. They do not
need a second, worse delivery path.

## Adding or changing a rule

1. Edit the relevant file here, or add a new one.
2. Add it to the table above **and** to the index in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
3. Add it to the ordered list at the top of
   [`scripts/sync-agent-rules.mjs`](../../scripts/sync-agent-rules.mjs) — a file not named
   there is silently left out of every pointer.
4. Run `yarn rules:sync`.

A rule earns its place when an agent (or a new teammate) would otherwise get it wrong.
If it is obvious from the code, it is not a rule — it is noise that costs context on every
single task.

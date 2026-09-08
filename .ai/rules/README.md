# .ai/rules — Canonical Workspace Rules

This directory is the **single source of truth** for how work is done in this workspace:
git workflow, code style, what the environments mean, which commands the agent must not
run, and how to find things before building them.

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
3. Run `yarn rules:sync` if you changed which files exist.

A rule earns its place when an agent (or a new teammate) would otherwise get it wrong.
If it is obvious from the code, it is not a rule — it is noise that costs context on every
single task.

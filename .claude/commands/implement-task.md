---
description: Execute one unit of work end to end: a raw ticket, a docs/tasks/*.task.md one-pager, or a task.N.md from a spec. Handles codebase investigation, a confirmed micro-plan, git setup, implementation, the quality gates, the MR, spec progress sync, and the docs deliverable. Use when the user says 'implement', 'execute this task', 'do this spec task', 'build it', or after plan-task routed work here.
---

<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->

# implement-task

The user's initial input (may be empty): $ARGUMENTS

Read and follow the full instructions in `.ai/skills/implement-task/SKILL.md` from Step 1.

If `$ARGUMENTS` is non-empty, treat it as the user's starting input and use it to skip or
shorten the context-gathering questions in Step 1 wherever it already answers them.

Connectors live in `.ai/connectors/` and run directly with `node` — no install step
(Node 18+). Workspace rules are in `CONTRIBUTING.md`.

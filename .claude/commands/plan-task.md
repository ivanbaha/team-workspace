---
description: Front door for starting new work. Intakes a ticket code, URL, pasted details or an ad-hoc problem, runs a first analysis, and routes it to the right tier: spec (big feature), task (small planned work), or direct (trivial fix). Scaffolds the one-pager for the task tier. Use when the user says 'start', 'plan this', 'pick up', 'new task', 'triage', 'let's work on TW-1234', or gives a ticket code or URL without saying how to approach it.
---

<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->

# plan-task

The user's initial input (may be empty): $ARGUMENTS

Read and follow the full instructions in `.ai/skills/plan-task/SKILL.md` from Step 1.

If `$ARGUMENTS` is non-empty, treat it as the user's starting input and use it to skip or
shorten the context-gathering questions in Step 1 wherever it already answers them.

Connectors live in `.ai/connectors/` and run directly with `node` — no install step
(Node 18+). Workspace rules are in `CONTRIBUTING.md`.

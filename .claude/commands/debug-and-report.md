---
description: Debug a production/test issue using logs and codebase analysis, then optionally create a Jira bug ticket
---

# Debug & Report

You are starting a debugging session. The user's initial description (if provided): $ARGUMENTS

Read and follow the full instructions in `.ai/skills/debug-and-report/SKILL.md` from Step 1.

If `$ARGUMENTS` is non-empty, treat it as the user's initial issue description and use it to skip
or shorten the context-gathering questions in Step 1 where possible.

Connectors live in `.ai/connectors/`. Run them directly with `node` — no install step needed (Node 18+).

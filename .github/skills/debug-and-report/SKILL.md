---
name: debug-and-report
description: Debug a production/test issue using logs and codebase analysis, then create a Jira bug ticket with all findings
---

<!-- GitHub Copilot wrapper — points to the canonical agent-neutral skill -->

# Debug & Report

Follow the full instructions in `.ai/skills/debug-and-report/SKILL.md` exactly.

Key entry points depending on what the user provides:

- **trace-id given** → go straight to Step 2 (log search) using it as `--search`
- **service name given** → resolve exact name via `backend/README.md`, then Step 2
- **vague description only** → ask one focused follow-up question first (see Step 1)

Connectors live in `.ai/connectors/`. Run them with `node`, no install needed (Node 18+).

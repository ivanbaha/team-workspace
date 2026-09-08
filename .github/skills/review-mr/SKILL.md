---
name: review-mr
description: Review a GitLab merge request end-to-end: resolve it from a link or repo + MR number, read the existing discussion, gather the surrounding documentation, check the branch out locally, and review the change in the context of the whole system and its neighbouring services. Findings are drafted for explicit per-item approval before anything is posted, and the MR is only approved when asked. Supports multi-turn review (comment → fix → verify). Use when the user says 'review this MR', 'review !123', pastes a merge request link, or asks for a code review of someone's branch.
---

<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->
<!-- GitHub Copilot wrapper — the canonical skill is agent-neutral. -->

Follow the full instructions in `.ai/skills/review-mr/SKILL.md` exactly, from Step 1.

Connectors live in `.ai/connectors/` and run directly with `node` — no install step
(Node 18+). Workspace rules are in `CONTRIBUTING.md`.

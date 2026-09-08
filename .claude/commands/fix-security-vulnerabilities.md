---
description: Plan and apply a fix for security vulnerabilities in a service: pull the container-scan results from a pipeline, cross-check them with a local dependency audit, triage by severity, resolve target versions against the registry, generate an applicable fix plan, apply it, and verify the service is clean. Use when the user says 'fix the vulnerabilities', 'the container scan is failing', 'yarn audit found issues', 'security scan', 'CVE', or pastes a failing security pipeline.
---

<!-- GENERATED FILE — DO NOT EDIT. Run `yarn skills:sync`. -->

# fix-security-vulnerabilities

The user's initial input (may be empty): $ARGUMENTS

Read and follow the full instructions in `.ai/skills/fix-security-vulnerabilities/SKILL.md` from Step 1.

If `$ARGUMENTS` is non-empty, treat it as the user's starting input and use it to skip or
shorten the context-gathering questions in Step 1 wherever it already answers them.

Connectors live in `.ai/connectors/` and run directly with `node` — no install step
(Node 18+). Workspace rules are in `CONTRIBUTING.md`.

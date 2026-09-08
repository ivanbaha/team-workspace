# Testing Plan: <CODE> — <Feature Title>

## Overview

| Part | File | Owner | Description |
| --- | --- | --- | --- |
| Manual testing | [testing.manual.md](./testing.manual.md) | Manual QA | Scenario design from the acceptance criteria, then execution on `test` and after promotion to `prod`. **QA owns the full set**; any BA-seeded scenarios are must-haves, not the plan |
| Automation | [testing.auto.md](./testing.auto.md) | AQA, or a developer | E2E automation, derived from the manual scenarios |

## Shared `data-testid` Contract

<!--
  The contract between development and automation. Both sides use the same IDs, so the
  automation can be written before the UI exists rather than waiting on it.
  Agree these in Stage B. Omit the section for backend-only specs.
-->

| Element | `data-testid` |
| --- | --- |
| <element> | `<test-id>` |

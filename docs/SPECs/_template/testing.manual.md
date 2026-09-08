# Manual Testing: <CODE> — <Feature Title>

<!--
  OWNERSHIP — the QA engineer owns this file.

  The BA may seed scenarios in Stage A, but only for cases that must demonstrably be
  covered, or to sketch a basic happy path. Those are a floor, not the plan, and this
  file may be absent from a seeded spec entirely — that is not a gap.

  QA designs the full set from requirements.md and its acceptance criteria, independently
  of what the BA intended and what the developer built, and may add, restructure or
  replace any scenario here. Tag every scenario with the requirement it validates.

  A criterion you cannot turn into a decidable pass/fail scenario is a requirements
  defect — raise it against the criterion rather than inventing an interpretation.

  See docs/sdlc/04-verification.md § Coverage is designed by QA, from the criteria.
-->

**Environments:** `test`, then `prod` after promotion
**Test data:** <accounts, fixtures, seeded records>
**URL pattern:** `<url>`
**Spec references:** [requirements.md](./requirements.md) · [design.md](./design.md)

> **Role selection:** <which roles give the best coverage, and why>

---

## TC-1: <Scenario title>

**Validates:** [Requirement 1: <title>](./requirements.md#requirement-1-title)

**Preconditions:**

- <precondition>

### TC-1.1: <Sub-scenario>

| # | Step | Expected result |
| --- | --- | --- |
| 1 | <action> | <expected> |
| 2 | <action> | <expected> |

## Coverage Check

<!-- Every acceptance criterion appears here at least once, or is recorded as untestable. -->

| Requirement | Criteria | Covered by |
| --- | --- | --- |
| 1 | 1.1, 1.2 | TC-1.1 |

# Requirements Document

<!--
  Stage A (BA). How to write these: .ai/rules/requirements-and-estimates.md
  Business language only — "THE System SHALL", never "the service SHALL call".
-->

## Introduction

<What this spec covers, which repos it touches, and the problem it solves.>

**External dependency:** <CODE, team, or "none"> — <status and notes>.

## Glossary

- **<TERM>**: <definition>
- **<TERM>**: <definition>

## Out of Scope

<!-- Write the boundary down. Silence here is the main source of mid-sprint surprises. -->

- <what this deliberately does not cover>

## Requirements

### Requirement 1: <Title>

**User Story:** As a <role>, I want <capability>, so that <benefit>.

#### Acceptance Criteria

1. WHEN <trigger>, THE System SHALL <observable behaviour>.
2. WHEN <trigger>, THE System SHALL <observable behaviour>.
3. IF <condition>, THEN THE System SHALL <observable behaviour>.

### Requirement 2: <Title>

**User Story:** As a <role>, I want <capability>, so that <benefit>.

#### Acceptance Criteria

1. WHEN <trigger>, THE System SHALL <observable behaviour>.

<!--
  Every criterion must be:
    - Observable      — a tester can see it happen without reading code
    - Independently testable — it maps to exactly one scenario
    - Unambiguous     — no "properly", "correctly", "as needed", "if applicable"
    - Decidable       — a definite pass/fail, including the negative path

  One requirement = one coherent capability a stakeholder would recognise. More than
  about six criteria usually means it is two requirements.

  When a later version changes a criterion, KEEP ITS NUMBER and annotate in place:
    <!-- v1.2, TW-1290: was "within 5 seconds" -->
  A superseded criterion with a recorded reason is useful. One that still reads as
  current is worse than no criterion at all.
-->

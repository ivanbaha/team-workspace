# Design Document

<!--
  Authoring stages — see .ai/skills/author-spec/SKILL.md:
    Stage A (BA):              Overview, UI Design, UX & Business Rules
    Stage B (Architect/Dev):   everything from Architecture down
  Fill only your stage's sections. Leave the other stage's as placeholders.
-->

## Overview

<!-- Stage A — intent-level summary of what the feature does and for whom. -->

<Summary of what the feature delivers.>

## UI Design

<!-- Stage A — text or ASCII mockups of the key screens and dialogs.
     Omit this section entirely for backend-only specs. -->

```txt
<mockup>
```

## UX & Business Rules

<!-- Stage A — non-technical behaviour: who sees what, and under which business
     constraints. Not implementation. -->

- <rule>

---

## Architecture

<!-- Stage B — everything from here down is the technical layer. -->

### Component / Module Structure

```txt
<tree of files and modules to create or modify, marked // new  // modified>
```

### API Layer

<New or changed endpoints, function signatures, request and response shapes.>

### Types

```typescript
<shared types, DTOs, enums — and which library they live in if shared>
```

### Data Flow

1. <step>
2. <step>

## Components and Interfaces

<!-- Stage B — each component or service touched, and what it is responsible for. -->

### <ComponentName> (`<repo>` — new / modified)

<Responsibility, inputs and outputs, and anything a consumer needs to know.>

## Data Models

| Field | Type | Description |
| --- | --- | --- |
| `<field>` | `<type>` | <description> |

## Correctness Properties

<!--
  Invariants that must always hold, each naming the criteria it validates. This is the
  highest-value section of the spec: it feeds unit tests and automation directly, it is
  what a reviewer checks the implementation against, and it is what survives amendments.
  Prose in an Overview does not.
-->

### Property 1: <name>

<Statement of the invariant — what must always be true, including under concurrency,
retries, and partial failure.>

**Validates: Requirements 1.1, 1.3**

## Error Handling

| Failure | Behaviour | Surfaced as |
| --- | --- | --- |
| <error class> | <what the system does> | <what the user or caller sees> |

## Testing Strategy

- **Unit tests:** <what must be covered, tied to the correctness properties above>
- **Gates:** typecheck passes, the existing test suite passes with no regressions, and the
  service starts. See [`code-style.md`](../../../.ai/rules/code-style.md).

## Docs Impact

<!--
  Which docs/ files this feature changes. Declared here, at plan time, because
  documentation written a week later is written from memory — by which point the
  non-obvious decision is the one that has been forgotten.
  The executor reconciles this against what actually shipped and delivers it as its own
  commit: docs/sdlc/03-development.md#docs-delivery
-->

- <`docs/architecture/...` — what changes there, or "none">
- <`docs/business/...` — what changes there, or "none">

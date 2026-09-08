# Implementation Plan: <CODE> — <Feature Title>

## Overview

<Which repos are touched, and the high-level order of work.>

| Repo | Role in this feature | Project ID |
| --- | --- | --- |
| `<repo/path>` | <what changes here> | <id> |

## Tasks

<!--
  Scope tasks by service or library, never finer. Over-granular tasks buy no parallelism
  and fight the one-MR-per-service rule. Tick the box and append the outcome (MR link)
  as each is delivered.
-->

- [ ] 1. [<Task title>](./task.1.md) — <one-line description>. *(added <YYYY-MM-DD>)*

<!--
  Add one row per task, copying task.1.md to task.2.md, task.3.md and so on:
    - [ ] 2. [<Task title>](./task.2.md) — <one-line description>. *(added <YYYY-MM-DD>)*
-->

## Task Dependency Graph

<!--
  "waves" = groups of task IDs that may run in parallel; each wave depends on the one
  before it. A sequential spec has one task per wave. This graph is what makes parallel
  implementation safe — providers before consumers, migrations after the code that
  writes the new values.
-->

```json
{
  "waves": [
    ["1"],
    ["2"]
  ]
}
```

## Ordering Rules

- <e.g. task 1 publishes the shared type; task 2 cannot start until it is released>
- <e.g. the migration in task 4 runs only after task 3 is on `prod`>

## Notes

- <Delivery notes: which tasks share a branch and MR, where to stop for manual
  verification, package name mappings, non-obvious imports.>

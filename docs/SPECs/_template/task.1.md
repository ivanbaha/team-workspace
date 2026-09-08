# Task 1: <Title>

**Repo:** `<repo/path>`
**Package:** `<package name>` (current version `<x.y.z>`) <!-- libraries only -->
**Project ID:** <id> <!-- from configs/workspace-repos.json — never invent one -->
**Spec references:** [requirements.md](./requirements.md) · [design.md](./design.md) · [testing.md](./testing.md)

<!--
  Concrete enough for an executor to follow without re-deriving the design: exact file
  paths, the code where it helps, the commit message, and the delivery step.
-->

## 1.1 <Step title>

<Precise, implementable instructions.>

```typescript
// <path/to/file.ts>
<code>
```

## 1.2 <Step title>

<...>

## 1.x Validate and deliver

```bash
yarn typecheck
yarn test
```

Both must pass, and the service must start.

- **Commit:** `feat(<CODE>): <past-tense description>`
- **Push:** `gitlab_safe_push` with `project_id=<id>`, `branch=feat/<CODE>-<slug>`
- **MR:** <create it / push to the existing MR for this repo / stop for manual verification>
- **Docs impact:** <which `docs/` files this task changes, or "none">

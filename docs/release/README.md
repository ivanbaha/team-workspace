# Release Runbooks

One-off operations that have to happen **inside a deployment window**, written down before
the window rather than improvised during it.

The release itself is not here — a release is a version promotion in
[`infra/git-ops`](../../infra/git-ops/README.md), prepared by the
[`release-mr`](../../.ai/skills/release-mr/SKILL.md) skill. What lives here is everything a
release needs that is *not* a version bump: a data migration, a backfill, an index build, a
cache to clear, a feature flag to flip in a particular order.

---

## The index

*No release runbooks recorded yet.*

<!-- One directory per release: docs/release/<version>/<operation>.md -->

---

## Why these are written down separately

A version promotion is reversible in about a minute: change the tag back, sync, done. The
operations here are usually not — a migration that has rewritten half a collection cannot be
undone by reverting a manifest.

That asymmetry is the whole reason for this directory. The operations that are hard to undo
are the ones being performed at nine in the evening by whoever is on the release call, and
they need to be readable by someone who did not write them and is not going to improvise.

---

## Layout

```txt
docs/release/
  26.3.2/
    reshard-orders-collection.md
    backfill-owner-ids.md
```

## What a runbook contains

- **When it runs** — before the deploy, after it, or between two specific services rolling.
  Ordering is usually the part that matters most and the part most often left implicit.
- **Preconditions**, as commands that produce a yes/no answer. "Confirm the migration has not
  already run" is not checkable; a query that returns a count is.
- **The commands**, copy-pasteable, one at a time, with the expected output next to each.
  Someone will be pasting these under time pressure.
- **How long it takes**, and whether the service is degraded meanwhile. A step that takes
  forty minutes on production data and four seconds locally must say so.
- **How to verify it worked** — not "no errors", but a check that would fail if the operation
  had silently done nothing.
- **How to roll back**, or an explicit statement that it cannot be rolled back and what the
  forward fix is instead. "Cannot roll back" is a legitimate answer; not saying so is not.

Write the runbook when the change that needs it is written, not on release day. If the
operation is risky enough to need a runbook, it is risky enough to have been rehearsed
against a copy of real data — say in the runbook whether it was.

After the release, leave the runbook in place. It is the record of what was actually done to
the data, and the next person doing something similar will start from it.

# Task One-Pagers

Lightweight, single-page plans for **task-tier** work — small, well-understood changes that
still benefit from a written plan, but do not warrant a full
[spec](../SPECs/README.md).

This is where most planned work actually lands. The spec tier is for the minority of
changes with real blast radius; the `direct` tier is for fixes not worth writing down at
all. In between sits one page, five minutes, and a record of what was decided.

## When a file lands here

Created by the [`plan-task`](../../.ai/skills/plan-task/SKILL.md) skill after triage routes
work to the `task` tier — **exactly one** signal from the
[rubric](../../.ai/rules/work-triage.md), or a clear single-repo change that still wants a
plan. Two or more signals go to `docs/SPECs/`; zero, on trivial work, gets no artifact.

## Naming

| Case | File |
| --- | --- |
| One unit of work for a code | `TW-1287.task.md` |
| Several units under one code | `TW-1287.1.task.md`, `TW-1287.2.task.md`, … |
| Ad-hoc work with no ticket | `TW-0.task.md` — rare; ad-hoc work is almost always `direct` |

Start from [`_template.task.md`](./_template.task.md).

## Structure

A genuine one-pager: Intent, Context, Scope, Plan, Acceptance, Docs Impact, Notes.

**If it starts growing requirements and design sections, it should have been a spec.** That
is a signal, not a failure — say so and switch tiers rather than letting a one-pager quietly
become a bad spec.

The section that earns its keep most often is **Docs Impact**, declared while the change is
understood rather than remembered a week later. The executor reconciles it against what
actually shipped: [Docs delivery](../sdlc/03-development.md#docs-delivery).

## Execution

Task files are implemented by [`implement-task`](../../.ai/skills/implement-task/SKILL.md),
which owns git setup, implementation, the quality gates, the MR, and the docs deliverable.

## Not indexed for search

`docs/tasks/**` is excluded from the `docs_search` corpus, for the same reason
[`docs/SPECs/`](../SPECs/README.md#excluded-from-the-search-index--on-purpose) is: these
files describe **intent**, and retrieval cannot tell a plan from a description of something
that exists. A finished task's durable output is the code, plus whatever it added to the
indexed docs — not the one-pager.

Keep the one-pager afterwards anyway. It is cheap, and it is the record of why the change
looks the way it does.

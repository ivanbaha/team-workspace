# Code Style

Conventions for code we own. Repos we do not own keep their own style — see
[environments-and-ownership.md](./environments-and-ownership.md).

---

## The gates are typecheck, tests, and the service starting

Formatters and linters are **never** a gate.

They are useful in repos we own and can be ignored entirely elsewhere. A lint failure in a
repo with an outdated ESLint config says nothing about the change in hand, and it is not
ours to fix.

**Do NOT:**

- Treat a lint or format failure as blocking, or hold up delivery on it.
- Re-run a slow lint command hoping for a different result. One attempt, then report it.
- Chase a formatter that keeps reverting an edit — note it once and stop. A local editor
  formatter configured differently from the repo's is a known failure mode.
- Reformat whole files, or run a formatter across a repo, to satisfy a rule.
- Report lint output as if it were a verification result.

**Always:**

- Match the surrounding style by hand as you write, so a formatter has nothing to say.
- Keep the diff to lines the task needs.
- Report a formatting issue you noticed but did not fix, and let the operator decide.

Diff hygiene is the part that actually matters, and it is a review concern rather than a
tooling one: a reviewer should see only the lines the task required.

---

## Comments explain *why*, not *what*

The code says what it does. A comment earns its place only when intent is not obvious from
the code itself.

**Do NOT:**

- Restate what the code already says (`// increment counter` above `counter++`).
- Narrate every step. A short doc comment on a non-trivial function is enough.
- Leave commented-out code behind.
- Reference tracker artifacts in code — no ticket codes, requirement IDs, or spec section
  names in comments. Traceability belongs in the commit message and the MR description,
  where it stays accurate.

**Always:**

- Prefer a clear name or a small refactor over a comment.
- Comment non-obvious intent, trade-offs, workarounds, or a subtlety a future reader would
  otherwise miss — *"prefixes can't be OR-ed in one query, so query each in turn"*.
- Keep doc comments to purpose and any non-obvious behaviour, not a re-description of the
  parameters.

---

## Tests

New or changed behaviour comes with a test that **would fail if the logic were wrong**.
That is the bar — not a coverage number.

- Assert the behaviour, not that the function ran without throwing.
- Cover the meaningful inputs: empty, partial, boundary, the failure path — not only the
  happy one.
- Do not mock the thing under test so thoroughly that the assertion proves the mock works.

A test that passes either way is worse than no test: it reports safety that is not there.

**The counterweight matters as much.** Some code genuinely resists unit testing — thin
wiring and DI modules, pure framework glue, a query whose behaviour lives in the database,
an integration boundary where every collaborator would have to be mocked into fiction. For
those, the honest answer is that the behaviour belongs in an integration test or is covered
by the pipeline. Never write, or ask for, a test whose only effect is to move a coverage
number. Maintain or improve coverage; there is no target percentage.

---

## Matching the surrounding code

Write code that reads like the code around it: same naming, same idiom, same comment
density. A file where the new function is stylistically obvious is a file that will be
misread later.

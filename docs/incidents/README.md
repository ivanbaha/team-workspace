# Incidents

Security and production incidents: **what happened, whether it reached us, and what each
person has to do about it.**

An incident write-up is not a post-mortem template exercise. It exists so that six months
later somebody can answer three questions without asking anyone: *were we affected?*, *what
did we change?*, and *would we catch it now?*

---

## The index

*No incidents recorded yet.*

<!-- Newest first. One line each: the date, what it was, and the answer to "did it reach us". -->

---

## When to write one

Write an incident document when **something outside a normal bug reached, or nearly reached,
a running environment or a developer machine.** The bar is impact, not blame:

- A production outage or degradation that users noticed.
- A security advisory that affected something we run or install — a compromised package, a
  vulnerable base image actually deployed, a leaked credential.
- Data loss or corruption, including one caught before it spread.
- A near miss whose only reason for being a near miss was luck.

**Not** an incident: a bug found in review, a failing pipeline, a vulnerability found by a
scan before it shipped. Those are ordinary work — the
[`fix-security-vulnerabilities`](../../.ai/skills/fix-security-vulnerabilities/SKILL.md)
skill covers the last one.

---

## Layout

One directory per incident, named `YYYY-MM-DD-<short-slug>/`, with a `README.md`. Anything
supporting — a scan script people need to run, a log excerpt, a query — goes in the same
directory, because the thing readers most often want is *the command*, and a command in a
different repo is a command nobody runs.

```txt
docs/incidents/
  2026-08-04-npm-supply-chain-worm/
    README.md          — the write-up
    scan-hosts.mjs     — what each developer runs on their machine
```

## What the write-up contains

In this order, because it is the order a reader needs it:

1. **Were we affected?** First line, unambiguous. "No — we never resolved the affected
   versions" or "Yes, in test, between 09:12 and 11:40 UTC". Everything else is detail; this
   is the answer people came for.
2. **What each person has to run.** If there is an action for individuals — rotate a token,
   scan a laptop, clear a cache — it goes near the top, as a copy-pasteable command, not
   buried under the narrative.
3. **What happened.** Timeline, plain prose. What was observed, in what order, and what was
   concluded at each point — including the wrong conclusions, because those are what a
   future reader will also reach.
4. **How it reached us, or why it did not.** The mechanism. This is the part that transfers
   to the next incident.
5. **What changed as a result.** Concrete: the pinned version, the added check, the hook, the
   alert. **Link to the commits.** "We should be more careful" is not a change.
6. **What would still not be caught.** The honest section. An incident doc that implies the
   class of problem is now solved will be trusted next time, and it should not be.

Write it while it is fresh — a week later the timeline is already reconstruction. It is fine
to publish with open questions marked as open.

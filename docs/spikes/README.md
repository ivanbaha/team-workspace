# Spikes

Technical investigations, audits, and one-off analyses: **findings worth keeping that are not
reference documentation.**

A spike answers a question — *can we do X?*, *why is Y slow?*, *how much of Z is actually
used?* — and the answer is true as of the day it was written. That is the difference between
this directory and the rest of `docs/`, and it is why spikes carry a date and a verdict while
architecture docs do not.

---

## The index

*No spikes recorded yet.*

<!-- One line each: date, question asked, verdict reached. -->

---

## When to write one

- **A feasibility question** answered by building a throwaway prototype. Write down the
  answer; delete the prototype.
- **An audit** — what is actually deployed, which endpoints nobody calls, how many services
  still use the deprecated helper.
- **A performance or cost investigation** where the numbers matter and were expensive to get.
- **An option comparison** where a decision was made and the rejected options are worth
  recording, so the same three are not re-evaluated next year.

If the finding describes **how the system works**, it is not a spike — it belongs in
`docs/architecture/` or `docs/business/`, where it will be maintained. Writing it here
instead is how a system fact ends up frozen at the date somebody investigated it.

---

## What a spike contains

Short. Four sections, and the first two are the point:

1. **The question**, in one sentence, as it was actually asked.
2. **The verdict**, in one paragraph. Yes/no/it depends, and what to do about it. A reader
   who stops here should have got what they came for.
3. **How it was investigated** — enough that someone could redo it and get the same answer,
   or notice that the answer has changed. Include the queries and the commands.
4. **What would change the answer.** The conditions under which this becomes wrong: a version
   bump, a scale threshold, a dependency's roadmap. This is what turns a stale document into
   a useful one.

## Dating and staleness

**Put the date in the file: `YYYY-MM-DD-<slug>.md`.** A spike's shelf life is unpredictable —
some are permanently true, some expire the moment a library releases — and a filename date is
what lets a reader judge before reading.

Spikes are indexed for `docs_search`, so they will surface alongside reference docs. That is
deliberate and useful, but it means the verdict paragraph has to carry its own date context:
write "as of March 2026, the driver does not support X" rather than "the driver does not
support X".

Do not delete a superseded spike. Add a line at the top pointing at what replaced it — the
old verdict plus the reason it changed is more useful than either alone.

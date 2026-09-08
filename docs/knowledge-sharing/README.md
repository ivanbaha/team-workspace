# Knowledge Sharing

Write-ups from internal sessions, demos and deep dives — **explanations aimed at teammates**,
where the rest of `docs/` is aimed at whoever needs the fact right now.

The distinction is one of shape, not subject. An architecture doc answers a question in the
fewest words that are still correct. A knowledge-sharing write-up teaches something: it can
be long, it can build up from first principles, it can show the wrong approach before the
right one. Both are worth having, and each does the other's job badly.

---

## The index

*No write-ups recorded yet.*

<!-- One line each: title, what a reader will be able to do afterwards. -->

---

## When to write one

- **After giving a demo or a session** — the deck is not the artefact; the write-up is. A
  recording nobody rewatches and a slide deck without narration both lose the reasoning.
- **After learning something the hard way**, where the useful part is the path and not just
  the conclusion. A debugging story that teaches a technique belongs here; the resulting fact
  belongs in `docs/architecture/`.
- **When onboarding keeps hitting the same wall** and the answer is too long for the
  onboarding guide. Write it here and link it.
- **When something we built might be useful to another team.** These write-ups are the ones
  that get shared outward, so they should stand alone without our context.

---

## What makes one worth reading

- **State what the reader will be able to do afterwards**, in the first paragraph. Not "an
  overview of the tracing setup" but "after this you will be able to take a trace id from a
  support ticket and find the failing line".
- **Show the mechanism, not just the interface.** The reason for a long-form write-up is that
  it has room to explain *why* the thing is shaped the way it is.
- **Include what it costs and what it gives up.** A write-up that presents a design as having
  no downsides teaches the reader to distrust it — and the trade-off is usually the most
  transferable part.
- **Keep the real examples.** Sanitised examples are unmemorable. Redact the values, keep the
  shape.

## Staleness

These age differently from reference docs: the *reasoning* usually stays valid long after the
commands stop working. When a write-up goes out of date, add a note at the top saying what
changed and where the current answer lives, rather than rewriting it — a teaching document
edited into a reference document is now bad at both.

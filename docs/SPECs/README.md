# SPECs

Feature specifications — the durable record of *what we intend to build and why*.

> **Coming soon.** A working example of a custom, lightweight **SDD
> (spec-driven development)** implementation will land here: the format, the
> workflow, and how it hands off to the reference documentation in the rest of
> `docs/`. This README is the placeholder that reserves the location and, more
> importantly, records the retrieval decision below — which applies from day one,
> before a single spec exists.

Specs are kept **tool-neutral** and live here in `docs/` rather than inside any
one assistant's directory (`.kiro/`, `.github/`, `.claude/`, …). Editors and
agents change; the team's specifications outlive them, and anything that
survives a tooling migration belongs in `docs/`.

---

## Excluded from the search index — on purpose

`docs/SPECs/**` is the one part of `docs/` that `docs_search` does **not**
index:

```javascript
// mcp/src/docs/sources.js
{ base: 'docs', match: 'all', exclude: ['SPECs'] },
```

Specs describe **intent**. The rest of `docs/` describes **reality**. Retrieval
cannot tell the two apart — it has no notion of *planned* versus *shipped* — so
an indexed spec for a feature that was never built reads exactly like
documentation of one that works. Same vocabulary, same confident declarative
sentences, often *more* detail, because it was written while someone was
thinking hard about the problem.

The result is an agent that confidently describes a feature that does not exist.
That is worse than finding nothing: a missing answer is visible, a fabricated one
is not.

Full reasoning, including the duplication and trust-erosion effects:
[Corpus hygiene](../architecture/docs-rag.md#case-study-why-specs-and-tasks-are-the-worst-offenders).

**This does not make specs less useful.** An agent pointed at `docs/SPECs/`
reads them directly, *knowing what they are*. The exclusion only stops them
competing with reference documentation in a single undifferentiated ranked list.
If searching them ever becomes necessary, the right shape is a **separate
collection behind a separate tool** — so the caller chooses between "what is
planned?" and "what is true?" instead of being handed a blend with no way to
tell which is which.

---

## When a spec ships

A spec is finished when the feature ships — which is exactly when its content
stops being safe to read as a description of the system:

1. **Move what is still true into the indexed docs** (`architecture/`,
   `business/`, or the service README). That copy is what people and agents
   should find.
2. **Leave the spec here as the decision record** — the "why we rejected X" part
   that reference documentation never carries well.
3. **Do not duplicate the same content in both.** Two documents covering one
   topic split the ranking between them, so neither wins.

If a spec is abandoned rather than shipped, **say so at the top of the file**. A
plan that nobody marked as dead is the single most misleading document a
repository can contain.

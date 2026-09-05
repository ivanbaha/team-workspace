# Evaluating Retrieval Quality

A periodic check that `docs_search` still returns *good answers* — as opposed to
[`docs:health`](./docs-rag-operations.md), which only checks that the plumbing
works.

```bash
yarn docs:eval              # summary + failures
yarn docs:eval --verbose    # every case, with the ranked results
yarn docs:eval --json       # machine-readable, for tracking the trend
```

---

## Why this is a scheduled ritual, not a one-off

**Retrieval quality degrades on its own as a corpus grows, and the degradation
is silent.**

Every document you add is another candidate competing for the same five result
slots. A query that ranked the right section first at 300 chunks can rank it
fourth at 3,000 — without anything breaking, erroring, or looking different.
Every response is still well-formed. Every result is still plausible. The agent
still answers confidently.

Nobody notices, because a plausible-but-worse result is indistinguishable from a
good one **unless you wrote down what you expected to get**. That is all a
golden set is.

The effect compounds with poor corpus hygiene. Indexing everything with a `.md`
extension does not merely add noise linearly — it adds documents that are
*especially* good at ranking:

- **Specs and task tickets** are dense with the exact domain vocabulary of the
  questions people ask, and often more detailed than the reference docs, because
  they were written while someone was thinking hard about the problem. They
  outrank the docs on the topics they share.
- **Templates and scaffolding** match structural queries about the section names
  every real document shares.
- **Changelogs and migration runbooks** are highly specific and historical —
  and specificity is what embeddings reward.

So a corpus that doubles in size with unhygienic content degrades much faster
than one that doubles with reference documentation. See
[corpus hygiene](../architecture/docs-rag.md#the-corpus--declared-not-discovered)
for what to keep out and why.

---

## When to run it

| Trigger | Why |
|---|---|
| **Monthly** | The default cadence. Frequent enough to catch a trend, rare enough that nobody resents it. |
| **After the corpus grows noticeably** | A new repo, a new docs directory, a `depth` rule that started matching more than you expected. |
| **After editing `sources.js`** | Always. This is the change most likely to move the numbers. |
| **After changing the chunker, tokenizer, or model** | These change ranking globally, and the effect is not predictable by reading the diff. |
| **When someone reports a bad result** | Reproduce it, then add it as a case so it can never regress unnoticed. |

Adjust the cadence to your growth rate: a corpus that gains a handful of files a
month can be checked quarterly; one absorbing a new repo every sprint deserves
attention every sprint.

---

## What it measures

| Metric | Meaning | Watch for |
|---|---|---|
| **recall@1** | Fraction of queries where the expected file ranked **first** | The most sensitive number. Drops first. |
| **recall@5** | Fraction where it appeared in the top 5 at all | Falling here means content is genuinely missing or unfindable, not merely demoted. |
| **MRR** | Mean reciprocal rank — rewards ranking high, not merely including | **The key trend metric.** |
| **distinct files in top-5** | How many different documents the results span | Very low = one document monopolises every slot; very high = nothing is confidently relevant. |
| **latency** | Embed + fuse, per query | Should stay flat. It is not the thing that degrades. |

**The pattern to watch for is MRR falling while recall@5 stays flat.** That is
the signature of a crowding corpus: the right answer is still there, just pushed
down by new competitors. It is the earliest warning you get, and it appears long
before anyone complains.

Absolute numbers mean little across teams — they depend entirely on your corpus
and how you wrote your cases. **The trend over months is the signal.** Record
each run.

> **Small sets are noisy — read them accordingly.** With 20 cases, one query
> moving between rank 1 and rank 2 shifts recall@1 by 5 points and MRR by ~0.02.
> Editing a single document can do it. So a one-run wobble is not a regression:
> look for a **consistent direction across three or more runs**, and treat a
> single bad month as a prompt to look, not a verdict. Enlarging the set reduces
> the noise, but a set nobody maintains is worse than a small honest one.

```bash
# Append a dated snapshot for trend tracking
yarn docs:eval --json > "eval-$(date +%Y-%m).json"
```

---

## Writing the golden set

The set lives in [`mcp/docs-eval.json`](../../mcp/docs-eval.json).

```jsonc
{
  "thresholds": { "recallAt1": 0.55, "recallAt5": 0.85, "mrr": 0.65 },
  "cases": [
    {
      "query": "what happens when a price changes during checkout",
      "expect": ["docs/business/checkout-flow.md"],
      "note": "Semantic: the answering section shares no words with the question."
    }
  ]
}
```

`expect` is a list because more than one document can legitimately answer a
question; a case passes if **any** of them is retrieved.

Principles that keep the set useful:

- **Real questions only.** Write what a teammate actually asked in chat, not
  what you imagine someone might type. Invented queries measure your imagination.
- **Small.** 15–30 cases you genuinely care about beats 200 synthetic ones. A set
  nobody maintains is worse than none, because its green result is misleading.
- **Cover both halves.** Include conceptual questions (dense retrieval) *and*
  bare identifiers like `WS_SETUP_ACTIVE` (lexical retrieval). A set of only
  prose questions will not notice the day the tokenizer stops preserving your
  identifier punctuation.
- **Add a case for every reported failure.** This is how the set stays honest
  about *your* corpus rather than about retrieval in the abstract, and it is the
  only mechanism that stops the same complaint recurring.
- **Set thresholds from your own baseline**, a little below current numbers.
  They exist to catch regression, not to assert a universal standard.

---

## When it fails

**Check the corpus before touching retrieval.** Degradation is usually content,
not code, and the content fixes are much cheaper:

1. **`yarn docs:sources`** — did something get indexed that should not be? Specs,
   task documents, changelogs and templates describe intent or history and
   outrank reference docs on the queries they share words with.
2. **Look for duplicates.** Two documents covering one topic split the ranking
   between them, so neither wins. This is the most common cause of a single case
   regressing while everything else holds.
3. **Check the headings of the missed sections.** Every chunk carries its full
   heading path into its embedding, so a heading that names the topic is the
   cheapest ranking fix available — often a one-line change.
4. **Only then** consider chunk size, the embedding model, or the tokenizer.
   These are global changes with unpredictable effects, and they are almost
   never the actual problem.

### Two worked examples

Both are from building this workspace, and in both the fix was **content, not
retrieval**.

**1. A section with the wrong heading.** *"What stops two ingests running at the
same time"* did not surface the ingest lock. The lock was documented — inside a
long bullet list under a heading about something else, so the chunk carried a
heading path that never mentioned locking. Giving each guard its own heading
moved that section from **unranked to first**. Every chunk carries its heading
path into its embedding, which makes a heading the cheapest ranking lever there
is.

**2. Content that did not exist.** *"How do I add a new repo to the workspace"*
returned nothing relevant. Investigating showed the obvious cause: `scripts/README.md`
documented adding a *script* but never adding a *repo*. Writing the missing
section moved the case from **missed entirely to rank 3**, and lifted recall@5
across the whole set to 100%.

That second one is the more valuable habit. A golden set is not only a
regression test for retrieval — **it is a coverage report for your
documentation**. A question your team actually asks that retrieval cannot answer
is, more often than not, a question your docs do not answer either.

### The crowding effect, observed

Adding four new guides to this workspace — good documentation, correctly
curated — moved the metrics on an unchanged golden set:

| | Before | After |
|---|---|---|
| chunks | 259 | 310 |
| recall@1 | 60% | 55% |
| MRR | 0.750 | 0.729 |

Nothing broke. Nothing was mis-indexed. The new documents simply discussed
overlapping topics and competed for the same slots. **This is the baseline decay
that happens with a well-maintained corpus** — the floor, not the failure case.
A corpus absorbing specs, task tickets and changelogs degrades considerably
faster, which is the whole argument for
[hygiene](../architecture/docs-rag.md#the-corpus--declared-not-discovered).

The response is not to write fewer docs. It is to notice, and to react —
sharpen headings, merge overlapping documents, split what became two topics.
Which requires measuring.

---

## Investigating a single case

`docs:eval` tells you *that* something regressed. `docs:query --explain` tells
you *why*, by scoring the two halves separately:

```bash
yarn docs:query --limit 10 --explain "what stops two ingests running at the same time"
```

| What you see | What it means |
|---|---|
| Only the **dense** half ranks it | The identifier never entered the BM25 vocabulary — check `tokenize()` |
| Only the **lexical** half ranks it | The chunk lacks the vocabulary of the question — the doc needs a sentence a human would search for |
| Neither half ranks it | Not in the corpus, or the index is stale |
| Both rank it, but something else wins | A competing document — usually the one that should not be indexed |

---

## Automating it

The exit code is CI-friendly: `0` within thresholds, `1` below, `2` could not run.

```yaml
# Run monthly on a schedule; a regression opens an issue rather than blocking a merge.
- run: yarn docs:ingest
- run: yarn docs:eval --json > eval.json
```

Keep it **off** the per-merge path. Retrieval quality is a slow-moving property,
and a red build on a docs typo teaches people to ignore the check — which costs
you the one signal that was going to catch the silent degradation.

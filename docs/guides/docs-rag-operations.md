# Docs Search — Operations Runbook

Diagnosing and repairing the `docs_search` index.

Related: [Hybrid RAG design](../architecture/docs-rag.md) ·
[Workspace Automation](./workspace-automation.md) ·
[Evaluating Retrieval Quality](./docs-rag-evaluation.md) ·
[Running Qdrant](./qdrant-runtimes.md)

> **The premise of this page.** Every failure mode in this system is *silent*.
> A wiped volume, an alias pointing at an empty collection, a BM25 model from a
> different corpus version — none of them throw. `docs_search` keeps returning
> well-formed responses with fewer or zero results, and the agent answers from
> what it got. Nothing here is about handling errors; it is about **detecting
> wrong answers on purpose**.

---

## Is it healthy?

One command, which checks the halves in the order that isolates a fault:

```bash
yarn docs:health
```

It reports, in order: Qdrant reachable → alias resolves → collection has points
→ BM25 model present and non-empty → last successful ingest → orphan
collections. Exit codes: `0` healthy, `1` degraded, `2` could not check.

<details>
<summary>The same checks by hand</summary>

```bash
curl -s http://127.0.0.1:6333/healthz                  # Qdrant up?
curl -s http://127.0.0.1:6333/aliases                  # alias -> which collection?
curl -s http://127.0.0.1:6333/collections              # exactly one? (more = orphans)
curl -s http://127.0.0.1:6333/collections/workspace_docs \
  | grep -o '"points_count":[0-9]*'                    # index populated?
cat mcp/.docs-index/ingest-state.json                  # when did it last succeed?
```

The healthy state is **one alias, one collection**, with a timestamp matching
the last ingest. Anything else — two collections, or an alias pointing at
yesterday's timestamp — tells you precisely which stage failed.

</details>

---

## Is retrieval any good?

Health tells you the index exists. It does not tell you whether it *answers*.

For the systematic version — a golden set, tracked over time — use
`yarn docs:eval` and see [Evaluating Retrieval Quality](./docs-rag-evaluation.md).
Retrieval degrades silently as a corpus grows, and that is the only way to
notice. For a one-off question, run a query the same way the agent does:

```bash
yarn docs:query "how do services report errors"
yarn docs:query --limit 10 --explain "role:workspace:team_lead"
```

`--explain` scores the two halves separately. This is the tool for the most
common report — *"the agent couldn't find X"* — which has two completely
different causes and therefore two different fixes:

| What you see | What it means | Fix |
|---|---|---|
| The right section IS in the CLI results | Retrieval worked; the agent ignored it | Prompt/tool-description problem, not a RAG problem |
| Only the **dense** half ranks it | The identifier never made it into the BM25 vocabulary | Check `tokenize()` against your identifier shape |
| Only the **lexical** half ranks it | The chunk lacks the vocabulary of the question | The doc needs a sentence a human would actually search for |
| Neither half ranks it | The file is not in the corpus, or the index is stale | `yarn docs:sources`, then `yarn docs:ingest` |
| `no query token is in the BM25 vocabulary` | This ran as a dense-only search | Usually fine for prose; a red flag for an identifier query |

---

## Symptom → cause

| Symptom | Likely cause | Action |
|---|---|---|
| `BM25 model not found at …` | never ingested, or `.docs-index/` deleted | `yarn docs:ingest` |
| `docs_search is disabled` | `DOCS_SEARCH_ENABLED` not `true` | set it in `.env`, reconnect the MCP server |
| Zero results for **everything** | alias points at the empty bootstrap collection | `yarn docs:health` confirms; `yarn docs:ingest` |
| Results reference a deleted file | index predates the deletion | expected between rebuilds; `yarn docs:ingest` |
| Results miss a file you can see on disk | file is not in the corpus | `yarn docs:sources` — add it to `sources.js` if it belongs |
| Answers describe a feature that doesn't exist | a spec or task doc got indexed | Remove it from `sources.js` — [why](../architecture/docs-rag.md#case-study-why-specs-and-tasks-are-the-worst-offenders) |
| Results got gradually worse over months | corpus growth crowding the top ranks | `yarn docs:eval`, then review corpus hygiene |
| `QDRANT_ENGINE` errors / wrong engine | engine not installed, or misnamed | `yarn qdrant status`; [runtime options](./qdrant-runtimes.md) |
| Two collections in `/collections` | an ingest died before its alias swap | next ingest sweeps it; or `yarn docs:health` for the names |
| `.qdrant-storage/` far larger than expected | stale collection dirs below the sweeper | `yarn docs:reset --yes` |
| Ingest exits `3221225786` | console-close killed it (Windows detached spawn) | `yarn docs:ingest` |
| Nothing rebuilds after a pull | hooks not wired, or lost their executable bit | `yarn hooks:install` |
| Daily task never runs | `task.allowAutomaticTasks` not `on` in **user** settings | set it, reload the window |
| Rebuilds never fire, no error | a stale `.git/docs-ingest.lock` | it self-clears after 30 min; or delete it |
| Ingest is stuck at 0% for minutes | first run downloading ~106 MB of model weights | watch the log; `yarn docs:download-model` pre-warms it |

---

## Recovery

### Rebuild the index

Safe at any time — blue-green means searches keep working against the old index
until the new one is complete.

```bash
yarn docs:ingest
```

### Full reset from scratch

When the storage volume is suspect (stale directories, a partially wiped
volume, a version change):

```bash
cd mcp && yarn docs:reset --yes
```

This stops Qdrant, deletes `.docs-index/` and `.qdrant-storage/`, restarts the
container and re-ingests. It **keeps** `.cache/` — re-downloading the model
weights is a slow, network-dependent step, and the weights are never the thing
that is broken.

This is safe because **the index is 100% reproducible from the markdown**. There
is no state here worth backing up; recovery is always "re-run the ingest".

### Container control

Engine-agnostic — the commands read `QDRANT_ENGINE` from your `.env`:

```bash
cd mcp
yarn qdrant up       # create + start (first time)
yarn qdrant start    # start an existing, stopped container
yarn qdrant stop     # stop, keeping the volume
yarn qdrant rm       # remove the container (volume survives — it is bind-mounted)
yarn qdrant logs     # Qdrant's own view
yarn qdrant status   # engine, container state, endpoint health
```

Normal operation never needs these: `qdrant-runtime.js` starts the container on
MCP server startup.

Supported engines: `docker`, `podman`, `nerdctl`, `wslc` (Windows, no Docker
Desktop), `container` (macOS 26+), and `external` when Qdrant is managed
elsewhere. Choosing between them, and the platform-specific gotchas for each:
[Running Qdrant](./qdrant-runtimes.md).

Qdrant's dashboard, when you want to look at the data directly:
<http://localhost:6333/dashboard>

---

## After changing the model

`DOCS_RAG_MODEL`, `DOCS_RAG_DIM` and the Qdrant collection are a **matched
triple**. Changing the model without changing the dimension produces a vector
size mismatch at ingest; changing the dimension without rebuilding leaves the
old collection unqueryable.

```bash
# 1. set DOCS_RAG_MODEL and DOCS_RAG_DIM together in .env
# 2. pre-warm the new weights
cd mcp && yarn docs:download-model
# 3. rebuild — the alias swap makes this a clean cutover
yarn docs:ingest
```

The same applies to the BM25 model and the collection: they are a matched
**pair**, written by the same ingest run. A vocabulary from one corpus version
scoring vectors from another does not error — it silently degrades ranking,
which is why `docs:health` checks both halves rather than pinging one.

---

## After changing the corpus

Editing `mcp/src/docs/sources.js` changes what gets indexed. Always inspect the
resolved list before rebuilding — it is instant, and it is the only way to see
what a `depth` or `exclude` rule actually did:

```bash
yarn docs:sources     # prints every resolved file, grouped by top-level area
yarn docs:ingest      # then rebuild
```

If a newly added area does not appear, check it against the rules in
[the corpus section of the design doc](../architecture/docs-rag.md#the-corpus--declared-not-discovered):
`IGNORE_DIRS`, dotted directories, `depth`, and `exclude` all silently drop
files by design.

# Hybrid RAG over the Team Documentation

How the workspace makes its own markdown searchable by an AI agent: a local,
hybrid (semantic + keyword) retrieval layer exposed as the `docs_search` MCP
tool.

- **Operations and troubleshooting:** [Docs Search Operations](../guides/docs-rag-operations.md)
- **What triggers a rebuild:** [Workspace Automation](../guides/workspace-automation.md)
- **Setup and tool catalogue:** [MCP Server Guide](../guides/mcp-server.md)

---

## The 60-second version

Documentation is markdown spread across the workspace: `docs/`, feature specs,
agent connector docs, and the README of every service and lib. Rich, but too
large for a human or an LLM to scan. Without a retrieval layer an agent `grep`s
its way around — slow, context-expensive, and blind to anything phrased
differently from the query.

The agent gets a tool it calls **before opening any file**: it asks *"where is X
documented?"* and gets back a short ranked list of **pointers** — file path,
heading path, line range, snippet, fused score — then reads the real file itself.

Retrieval is **hybrid**:

- **dense** vectors (embeddings) for meaning — *"how does login work?"* finds a
  section titled *"M2M Authentication"*;
- **sparse BM25** vectors for exact tokens — `role:workspace:team_lead`,
  `OPERATIONAL_STATUS_TRANSITION`, service names, project IDs — which pure
  embeddings blur together.

Both live in one Qdrant collection and are fused server-side with **Reciprocal
Rank Fusion**. Everything runs **locally and in-process**: ONNX embeddings inside
Node, Qdrant in a local container. No Python, no cloud API, no data leaving the
machine.

It looks after itself: the index rebuilds when docs change on pull, at most once
a day otherwise, and self-heals if the Qdrant volume is wiped. Rebuilds are
**zero-downtime** via a blue-green alias swap. The feature is **opt-in and
isolated** — off by default, and when it breaks, only this one tool breaks.

---

## Why hybrid, and why small

Three properties of a team-docs corpus drive every decision below. If your
corpus differs, revisit these first.

**It is a routing problem, not a scale problem.** A few thousand chunks is
nothing. The consumer is already a strong LLM that can judge relevance itself
and issue query variants. Retrieval does not need to be clever — it needs to be
a **precise router**. That rules out rerankers, query-rewriting layers and
multi-stage pipelines: they add latency and failure modes for no measurable gain
at this size.

**It is identifier- and table-heavy.** Role values, env var names, market codes,
file paths, project IDs. Dense embeddings compress these into a semantic
neighbourhood where `role:workspace:team_lead` and `role:workspace:regional_admin`
look nearly identical. Exact token matching is not a nice-to-have here; it is
what keeps answers correct. Hence the BM25 half.

**Hand-maintained index files drift.** A `docs/README.md` full of links rots the
moment a file is renamed. Any tool that reads *the real files* on every ingest
is immune to that class of rot.

---

## Two tools, deliberately layered

| Tool | What it returns | Infra needed | Always on? |
| --- | --- | --- | --- |
| `docs_map` | Table of contents of `docs/`: every file → H2/H3 sections → line ranges + a one-line summary each | none | ✅ yes |
| `docs_search` | Hybrid ranked section pointers across the **whole** curated corpus | embedding model + Qdrant | ⛳ opt-in (`DOCS_SEARCH_ENABLED`) |

`docs_map` is the zero-dependency fallback. It parses markdown headings on
demand (milliseconds) and is *always* available, so a team gets most of the
value with no infrastructure at all. It is also the honest answer to *"do we
even need RAG?"* — ship `docs_map` first, use it, and only then build
`docs_search` for the conceptual queries an outline cannot route.

Both obey the same contract: **pointers, not prose.** Neither tool answers the
question. They locate the section; the agent reads the file and answers. This
keeps the retrieval layer dumb, debuggable, and free of the
"summarise-then-hallucinate" failure mode.

Note the scope difference: `docs_map` covers `docs/` only; `docs_search` covers
the wider curated corpus below.

---

## Architecture

```txt
        ┌───────────────────── AI agent (Claude, Kiro, Cline…) ───────────────┐
        │                    calls tools over MCP (stdio)                     │
        └──────────────┬───────────────────────────────────────┬──────────────┘
                       │ docs_search(query, limit)             │ docs_map(filter)
                       ▼                                       ▼
   ┌────────────────────────────────────────────┐   ┌──────────────────────────┐
   │ QUERY PATH  (src/docs/search.js)           │   │ OUTLINE PATH (tools.js)  │
   │ 1. embedQuery()   → dense 768-d vector     │   │ walk docs/ → headings →  │
   │ 2. bm25.encodeQuery() → sparse vector      │   │ table of contents        │
   │ 3. qdrant.hybridSearch() → RRF fusion      │   │ (no deps, no state)      │
   │ 4. map points → {path, heading, lines, …}  │   └──────────────────────────┘
   └───────────────┬────────────────────────────┘
                   │ query ALIAS "workspace_docs"
                   ▼
        ┌──────────────────────┐   blue-green   ┌──────────────────────────────────┐
        │ Qdrant               │◄───────────────│ INGEST PATH                      │
        │ 1 collection         │  alias swap    │ (scripts/ingest-docs.mjs)        │
        │ • dense  (768, cos)  │                │ collect → chunk → fit BM25 →     │
        │ • lexical (sparse)   │                │ embed → upsert → swap → cleanup  │
        │ • payload per chunk  │                └──────────────────────────────────┘
        └──────────────────────┘                              ▲
                                                              │ five triggers
                                          startup self-heal · daily staleness ·
                                          git post-merge/post-rewrite hooks ·
                                          daily workspace setup · manual
```

Each module is one responsibility, which is what makes the design portable:

| File | Responsibility |
| --- | --- |
| `mcp/src/docs/sources.js` | Corpus definition: which files feed the index |
| `mcp/src/docs/chunker.js` | Heading-aware markdown chunking, atomic tables/code |
| `mcp/src/docs/bm25.js` | Sparse lexical encoder: tokenizer + BM25 fit/encode |
| `mcp/src/docs/embedder.js` | Dense embeddings via Transformers.js (ONNX, in-process) |
| `mcp/src/docs/qdrant.js` | Client, hybrid query, blue-green alias lifecycle, retries |
| `mcp/src/docs/search.js` | Query-time orchestration (`docs_search`) |
| `mcp/src/docs/bootstrap.js` | Startup: auto-start Qdrant, validate index, auto-rebuild |
| `mcp/src/docs/qdrant-runtime.js` | Auto-start the local Qdrant container |
| `mcp/src/docs/ingest-state.js` | Daily-refresh bookkeeping |
| `mcp/src/docs/outline.js` + `tools.js` | `docs_map` |
| `mcp/src/docs/schemas.js` | MCP tool declarations |
| `mcp/scripts/ingest-docs.mjs` | The ingestion pipeline |

The retrieval logic proper is a few hundred lines. Most of the rest is the
reliability engineering below — which is the part that turns a working prototype
into something that runs unattended on every machine.

---

## The corpus — declared, not discovered

`sources.js` is a **declarative corpus definition**, deliberately a hand-curated
list rather than "index every `.md` in the workspace". This is the single
highest-leverage decision in the whole design, and the one most often skipped.

Each entry is one of four shapes:

```javascript
{ file }                          // a single markdown file
{ base, match: 'all' }            // every *.md under base (recursive)
{ base, match: 'readme' }         // every README.md under base (recursive)
{ base, match: 'readme', depth }  // README.md limited to `depth` dir levels
// any `base` entry also accepts `exclude: ['dirName', …]`
```

Inspect the resolved list at any time — it is instant, and it is the only way to
see what a `depth` or `exclude` rule actually did:

```bash
cd mcp && yarn docs:sources
```

### Curate by asking two questions

For every candidate file:

1. **Would a teammate ever ask a question this file answers?**
2. **If it ranks first, is that a good answer — or a distraction?**

Question 2 is the one that gets skipped. A file can be genuinely useful to read
and still be harmful in a ranked list, because retrieval does not present it
with any of the context that makes it useful. It arrives as "here is the answer",
stripped of "…according to a plan from last quarter".

### What this workspace deliberately keeps out

| Excluded | Why |
| --- | --- |
| **Feature specs** (`docs/SPECs/`) | Describe *intent*, not reality — see below |
| **Task documents** | Same, plus they are numerous and short-lived |
| **Agent skills** (`.ai/skills/`, and every mirror) | Instructions *to* an agent, not knowledge *about* the system |
| **`CHANGELOG.md`** (anywhere) | Rewritten by CI on every pipeline; never searched |
| **Scaffolding templates** (`_template/`) | Placeholder prose that matches structural queries |
| **`.github/`, `.kiro/`, `.agents/` skill mirrors** | Thin wrappers carrying a skill's *name* but none of its content |
| **`node_modules/`, `dist/`, vendored docs** | Other people's words, in volume |

### Case study: why specs and tasks are the worst offenders

This is worth spelling out, because specs look like exactly the kind of rich
internal documentation a retrieval layer should love. Indexing them alongside
reference docs causes three compounding problems.

**1. Duplication inflates the agent's context.** A spec and the documentation
written after it describe the same feature in similar language. A query about
that feature matches both, so the agent burns two of its five result slots — and
then a chunk of its context window — reading two accounts of one thing. The
second adds nothing but costs the same.

**2. Tense collapse — the dangerous one.** Retrieval has no concept of
*planned* versus *shipped*. A spec for a feature that **was never built** reads
exactly like documentation of one that works: same domain vocabulary, same
confident declarative sentences, often more detail than the real docs because it
was written when someone was thinking hard about it. The agent retrieves it,
believes it, and answers that a feature exists. **That is a wrong answer
delivered with full confidence** — precisely the failure this design exists to
prevent, reintroduced through the corpus instead of the code.

It is worse than a missing answer. A missing answer is visible; the agent says
it could not find anything. A confident description of a non-existent feature is
invisible until it reaches production.

**3. Trust erosion imposes a fact-checking tax.** Once someone has been burned
by (2), no result can be trusted without opening it to check whether it is a
plan or a description. That erases the entire value of a pointer-based
retrieval layer, whose premise is that a ranked pointer is cheap enough to act
on.

**What to do instead.** Specs stay in the repo and stay valuable — an agent
pointed at [`docs/SPECs/`](../SPECs/README.md) reads them directly, *knowing*
what they are. They simply must not compete with reference documentation in one
undifferentiated ranked list.

Note where they live: **inside `docs/`, not in a tool's directory.** Editors and
assistants change; specifications outlive them, so they belong with the rest of
the team's knowledge. Keeping them out of the index is a *retrieval* decision,
expressed as `exclude: ['SPECs']` on the `docs` entry — not a statement that
they are second-class documents. If you genuinely need to search them, index them into a **separate
collection behind a separate tool** (`specs_search` next to `docs_search`), so
the caller chooses between "what is planned?" and "what is true?" rather than
being handed a blend of both with no way to tell which is which.

The same reasoning applies to meeting notes, ADR drafts, incident post-mortems
about since-fixed bugs, and migration runbooks: **recency and specificity are
not relevance.** A high-detail historical or hypothetical document is exactly
what a naive corpus over-retrieves, because detail is what embeddings reward.

### Case study: why agent skills do not belong either

Skill files (`.ai/skills/*/SKILL.md`) are step-by-step instructions addressed to
an AI agent — "ask the user for the ticket ID, then query Grafana, then…". Two
reasons they stay out:

- **The agent already has them.** Every tool picks skills up through its own
  wrapper (`.github/skills`, `.kiro/skills`, `.agents/skills`,
  `.claude/commands`), which routes to the canonical body in `.ai/skills/`.
  Indexing them adds a *second, worse* delivery path for content the runtime
  already delivers correctly.
- **They pollute ranking.** A skill about debugging production issues is dense
  with the vocabulary of production issues, so it competes with the
  architecture doc that actually explains the system — and wins on
  vocabulary while answering a different question. The agent receives
  procedure where it asked for facts.

Their connector docs are a different matter and **are** indexed: those describe
real, runnable tooling and its output contract, which is knowledge.

### Where auto-discovery is safe, use it

Not every rule should be a hand-written list. Two decisions worth stealing:

- **`depth: 1` on `frontend`, `backend` and `libs`** means a newly cloned
  service's README is picked up on the next ingest without anyone editing
  `sources.js`, while nested per-module READMEs stay out. Enumerate where
  enumeration is the point; auto-discover where the shape is predictable.
- **`exclude: ['skills']` on `.ai`** keeps the connector docs and drops the
  agent instructions with one word, instead of listing every connector by hand
  and forgetting the next one.

`IGNORE_DIRS` skips `node_modules`, `.git`, `dist`, `build`, `coverage`,
`.cache`, `.docs-index`, `.qdrant-storage`, `.next`, `.turbo`, and any dotted
directory, at any depth.

### Corpus hygiene is not a one-time decision

A corpus curated correctly at 200 files degrades on its own as the repo grows:
someone adds a docs directory, a new repo arrives with its own conventions, a
`depth: 1` rule quietly starts matching six new services. Nothing breaks — the
results just get a little worse each month.

Two habits keep it honest, both cheap:

- **Read `yarn docs:sources` whenever you change `sources.js`,** and skim it
  quarterly regardless. The list is short enough to actually read, which is the
  reason it is a declaration rather than a glob.
- **Measure retrieval against a golden set on a schedule.** See
  [Evaluating Retrieval Quality](../guides/docs-rag-evaluation.md) — the
  degradation described above is invisible without it.

## The pipeline, stage by stage

### 1. Chunking — heading-aware, tables and code atomic

`chunker.js` segments a document into `heading | code | table | paragraph`
segments, then assembles chunks while tracking the heading stack. The rules, in
priority order:

1. **Split on markdown headings**, so every chunk has one clear topic.
2. **Tables and fenced code blocks are atomic** — never split, even when that
   overshoots the size cap.
3. Oversized sections sub-split **on paragraph boundaries only**.
4. Every chunk carries its **full heading path** (`H1 > H2 > H3`), so a
   three-line paragraph still brings topical context into its embedding.

Rule 2 matters most and is the single most important thing to copy. **A
half-table chunk reads as complete.** The agent retrieves a status table cut off
after four of nine rows, has no signal that anything is missing, and confidently
answers with a subset. That is the worst failure mode a docs assistant has, and
it is silent. Splitting mid-code-fence has the same shape: syntactically
plausible, semantically wrong.

`DOCS_RAG_CHUNK_MAX` (default 1,000 characters) is a *target*, not a hard limit,
precisely so rule 2 can win.

Chunk payload stored per point: `filePath`, `headingPath`, `text`, `startLine`,
`endLine`. The line range is what lets the agent read exactly the right slice of
the file afterwards.

### 2. Local embedding generation — ONNX, in-process, no Python

This is the part teams usually assume needs a Python service or a cloud API. It
does not. `@huggingface/transformers` runs ONNX models directly in Node via the
`onnxruntime-node` backend: one npm dependency, no sidecar process, no HTTP hop,
no Python toolchain on developer machines.

**Model:** `Snowflake/snowflake-arctic-embed-m-v1.5` — Apache-2.0, 768
dimensions, strong on technical documentation and identifiers. The int8 (`q8`)
ONNX weights are ~106 MB on disk. A smaller fallback is
`Xenova/bge-small-en-v1.5` (384 dims — `DOCS_RAG_DIM` and the Qdrant collection
size must change to match).

Five non-obvious details, each of which costs a day if you get it wrong:

- **The query prefix applies to queries only, never to passages.** Omitting it
  does not error — it silently lowers recall. This is the easiest thing in the
  whole build to get wrong and never notice.
- **`normalize: true`** yields unit vectors, so cosine similarity is a plain dot
  product. Pair it with `Distance.Cosine` on the collection.
- **Quantization is selected via `dtype`**, not the v2-era `{ quantized: true }`.
  Passing the old option is accepted and ignored, giving you fp32 weights and 4×
  the memory with no warning.
- **The model is a lazy singleton.** One promise, loaded on first use, reused for
  the life of the process. Loading per call would be catastrophic (~1 s each).
- **Progress must be surfaced.** A first run downloads hundreds of MB; without a
  `progress_callback` that is a silent multi-minute freeze that looks like a
  hang, and people kill it.

Pre-warm the cache on a fresh machine so the first real query isn't slow:

```bash
cd mcp && yarn docs:download-model
```

### 3. Sparse BM25 — the keyword half, in-house

Qdrant's full-text payload index is a **filter, not a ranker**, so the lexical
side is a **sparse vector of BM25 term weights** that Qdrant scores by dot
product. The weight split is the trick that makes it exact BM25:

- **documents** carry the full BM25 weight (IDF × term saturation × length
  normalisation);
- **queries** carry `1.0` per known term.

So `dot(query, document)` reproduces the standard BM25 score, with no
special-casing at query time.

**The tokenizer is where the value is.** A standard word tokenizer destroys
exactly the tokens this corpus is made of. Ours preserves identifier punctuation
**and** additionally emits the split sub-tokens, so both `role:workspace:team_lead`
and its parts are searchable.

The BM25 model (vocabulary → term id + IDF, plus average document length) is
**corpus-wide**, so it must be fit during ingestion, serialized, and reloaded at
query time. It lives at `mcp/.docs-index/bm25-model.json`.

That file is the one piece of local state the query path depends on besides
Qdrant — which is why the startup health check validates it explicitly, and why
it is the main blocker for a shared remote Qdrant (see *What's next*).

### 4. Storage — one collection, two named vectors

Each chunk is a single Qdrant point holding **both** vectors and the payload:

```jsonc
{
  "vectors":        { "dense":   { "size": 768, "distance": "Cosine" } },
  "sparse_vectors": { "lexical": {} },
  "on_disk_payload": true
}
```

Point ids are **deterministic** — a SHA-1 of `filePath#headingPath#startLine`
formatted as a UUID — so re-ingestion upserts in place instead of duplicating.
Idempotency is what makes a re-ingest safe to trigger from a git hook, a daily
timer, and a human, all without coordination.

### 5. The hybrid query — RRF fusion, server-side

Two `prefetch` branches, each pulling `limit × 4` candidates, fused by Qdrant
with `{ fusion: 'rrf' }`.

**Why RRF and not a weighted score blend:** cosine similarity (0…1, tightly
clustered near the top) and BM25 (unbounded, corpus-dependent) live on
incomparable scales. Any weighted sum needs calibration that drifts as the
corpus changes. RRF merges by **rank**, so it needs no calibration at all — it
is the correct default, not a shortcut. A cross-encoder reranker buys nothing at
this size with an LLM doing final judgement.

The response is deliberately minimal — pointers plus a 200-character snippet:

```json
{
  "score": 0.5,
  "filePath": "docs/architecture/api-contracts.md",
  "heading": "API Contracts > Error Handling",
  "lines": "42-58",
  "snippet": "All services return errors in a shared envelope…"
}
```

`limit` defaults to 5, capped at 20. The snippet exists to let the agent decide
*whether to open the file*, not to answer from.

See the fusion in action, and which half is carrying each result:

```bash
cd mcp && yarn docs:query --explain "how do services report errors"
```

### 6. Ingestion end to end

`scripts/ingest-docs.mjs`: **collect → chunk → fit BM25 → embed → upsert →
atomic alias swap**, with per-batch progress and ETA.

Note the ordering: **BM25 is fit and written before any embedding starts.** It
depends on the whole corpus, so it cannot be produced incrementally. It is also
why the BM25 file and the Qdrant collection are a *matched pair* — a vocabulary
from one corpus version scoring vectors from another silently degrades ranking.

---

## Blue-green index updates — zero-downtime re-indexing

This is the design point most worth copying, and the reason a rebuild is safe to
fire from a git hook while someone is actively using the tool.

### The problem with the obvious approach

The naive rebuild is "delete the collection, re-create it, re-upsert
everything." That leaves a multi-minute window during which the index is
**empty or partial**. A search issued then returns nothing, or worse, a
plausible subset. Neither failure announces itself: the agent gets a well-formed
response with fewer results and answers from what it got.

Deterministic point ids make upsert-in-place possible, which avoids the empty
window — but not the *partial* one. Re-indexing in place also cannot express
deletion: a chunk whose heading was renamed gets a new id, and the old point
stays behind forever as a phantom result pointing at a line range that no longer
means what it says.

### The pattern

**Search always queries an alias. Ingest always builds a new collection.**

```txt
before:  alias "workspace_docs" ──► collection "workspace_docs_20260904113335"  ← all reads
during:  alias "workspace_docs" ──► collection "workspace_docs_20260904113335"  ← reads unaffected
                                    collection "workspace_docs_20260905072557"  ← writes only
after:   alias "workspace_docs" ──► collection "workspace_docs_20260905072557"  ← reads, atomically
                                    (old collection deleted)
```

Readers never observe an intermediate state. The alias update is a single atomic
metadata operation; there is no moment when it points at a half-built collection
or at nothing. It also gives deletion for free: the new collection contains
exactly the current corpus, so removed and renamed chunks simply don't exist any
more.

### The write-path operations

**`prepareNewCollection()`** creates a UTC-timestamped collection and remembers
it as the ingest target. Every subsequent `upsert()` writes there.

**`swapAlias()`** is the atomic cutover, then cleanup. Two details worth lifting
verbatim:

- **`delete_alias` + `create_alias` in one `actions` array.** Both are applied
  atomically, and the delete makes the create idempotent. Creating an alias that
  already exists returns a Conflict, so the "obvious" single create fails on
  every run after the first.
- **Cleanup failure is logged, not thrown.** The swap already succeeded; the
  index is live and correct. Throwing would mark a successful ingest as failed
  and trigger a pointless retry.

**`dropIngestCollection()`** is called from the ingest's `catch`. If a run dies
between prepare and swap, the half-built collection is deleted instead of
leaked. The alias never moved, so the old index is still serving.

### Orphan sweeping — self-healing after crashes

A process killed hard (Ctrl+C, machine sleep, OOM) never reaches its `catch`, so
the partial collection survives. `sweepOrphans()` runs **both** at the start of
every ingest and after every successful swap, deleting any `workspace_docs_*`
collection that isn't the live target, the current ingest target, or the
bootstrap.

The generalised lesson: **any blue-green scheme needs a sweeper**, not just a
happy-path cleanup — the failure that leaks is by definition the one that
skipped your cleanup code.

### Bootstrap and the alias/collection name collision

Qdrant will not let an alias share a name with an existing collection. That
bites in two places, both handled in `ensureAlias()`:

- **First ever run.** No alias and no collection, so a search before the first
  ingest would throw "collection not found". `ensureAlias()` creates an empty
  `workspace_docs_bootstrap` collection and points the alias at it, so the query
  path returns *zero results* instead of an error while the first ingest runs.
- **Migrating an existing deployment.** If `workspace_docs` was previously a
  real collection, the name is now needed for the alias, so the legacy
  collection is deleted and the first ingest rebuilds.

An alias left pointing at `workspace_docs_bootstrap` is therefore "reachable and
completely useless" — `yarn docs:health` calls this out explicitly, because it
is the failure that looks healthiest from the outside.

### Transient failure retry

Localhost port-forwarding (notably under WSL) can reset keep-alive sockets
mid-stream, showing up as a bare `fetch failed` partway through a long ingest.
Every Qdrant call goes through `withRetry` — 4 attempts, exponential backoff
from 250 ms, and **only for errors that are actually transient**. The allowlist
matters: retrying a schema error or a 4xx just delays the real failure and hides
it behind three misleading warnings.

### Verifying it in a live system

```bash
yarn --cwd mcp docs:health
```

One alias, one collection, timestamp matching the last ingest. Anything else —
two collections, or an alias pointing at yesterday's timestamp — tells you
precisely which stage failed.

---

## MCP integration — safe by construction

The feature is opt-in and isolated, which is what makes it acceptable to ship
into a server everyone depends on for GitLab, Jira, Grafana and Mongo tooling.

1. **Feature-flagged, off by default** (`DOCS_SEARCH_ENABLED`).
2. **When disabled, the tool does not exist.** It is omitted from `ListTools`,
   so the model never sees it and cannot call it — no "tool failed" turns, no
   wasted context.
3. **Blast radius is contained.** `@huggingface/transformers` and
   `@qdrant/js-client-rest` are declared as **`optionalDependencies`** and
   loaded via dynamic `import()` at first use. If the model is missing, or
   Qdrant is down, or the container engine doesn't exist on this machine, **only
   `docs_search` fails** — every other tool is untouched, and `docs_map` keeps
   working with no dependencies at all.
4. **Errors are values, not exceptions.** Every tool returns
   `{ success, data, message }`, so a failure is a readable message the agent can
   act on ("Run `yarn docs:ingest` first") rather than a protocol-level error.

The three-layer laziness is deliberate: heavy deps import on first *enabled
startup*, the BM25 model and Qdrant connection initialise on first *query*, and
the ONNX session loads on first *embed*. A server that is enabled but never
searched pays almost nothing.

---

## Resource footprint

The fair objection to running an embedding model plus a vector DB on every
developer machine. Short answer: it does not hurt.

| State | CPU | GPU | RAM added | Frequency |
| --- | --- | --- | --- | --- |
| Feature disabled | 0 | 0 | 0 | — |
| Enabled, idle | ~0% | 0 | ~176 MB (after first search) | continuous |
| Single query | sub-second | 0 | no growth | per query |
| First search (cold ONNX load) | brief blip | 0 | +176 MB | once per server start |
| Background ingest | several cores | 0 | ~176 MB in a **child**, freed on exit | ≤ 1×/day + on doc pulls |

**GPU: none, ever.** `onnxruntime-node` uses the CPU execution provider. No
CUDA, no WebGPU (browser-only), no drivers, no contention with anything else the
developer is doing.

**RAM loads once and stays flat** — almost all of it native memory, so it does
not pressure V8's GC, and it does not grow with use.

**Two processes load the model; don't double-count.** The long-lived MCP server
loads it lazily on the first `docs_search` and holds it until restart. The
short-lived ingest child loads its **own** copy, embeds the corpus, and exits,
releasing it.

**Qdrant storage is almost entirely fixed overhead, not your data** — per-segment
payload-store pre-allocation plus WAL. Budget by *segment count*, not corpus
size; a much larger corpus barely moves the number.

**Network:** the model download on first use, then nothing. Fully
offline-capable afterwards; `TRANSFORMERS_OFFLINE=1` enforces it.

### Tuning knobs for constrained machines

| Knob | Effect |
| --- | --- |
| `DOCS_SEARCH_ENABLED=false` | turn it all off; `docs_map` still works at zero cost |
| `OMP_NUM_THREADS` | cap ONNX threads — bounds the ingest CPU spike, trading speed |
| `DOCS_RAG_BATCH` (32) | smaller batches → lower peak memory/CPU per step |
| `DOCS_RAG_DTYPE` (`q8`) | int8 keeps RAM/CPU low; `fp32` is heavier and unnecessary here |
| 24 h refresh window | the only recurring spike; can be widened |

---

## Known limitations

Stated plainly, because a design that only lists strengths is not useful to
someone deciding whether to adopt it.

1. **No incremental indexing.** Every rebuild re-embeds the whole corpus.
   Blocked on BM25 being corpus-wide: IDF and average document length change
   with any edit, so a single-chunk update needs a refit. Fine at a few thousand
   chunks; the first thing to fix at 50k.
2. **Local edits are not picked up automatically.** Triggers are git activity
   and staleness, not the filesystem. Run `yarn docs:ingest` after editing docs
   you want searchable right now. This is a conscious trade: a file watcher
   would either debounce into minute-long delays anyway or thrash a multi-minute
   CPU job on every keystroke.
3. **Every developer re-embeds the same corpus.** Wasteful, and it means two
   machines can hold slightly different indexes. See *What's next*.
4. **English-only tokenisation.** `tokenize()` assumes ASCII-ish identifiers and
   Latin script. Fine for this corpus; would need work for CJK content.
5. **No access control.** Correct today — local stdio MCP, local Qdrant, no
   network exposure — but it is the first thing that changes when Qdrant becomes
   shared.
6. **`docs_map` and `docs_search` have different scopes.** `docs_map` covers
   `docs/` only (rooted at `DOCS_RAG_PATH`) and reports headings down to
   `DOCS_MAP_MAX_HEADING_LEVEL` (default H3); `docs_search` covers the wider
   curated corpus at every heading level. Occasionally surprising — a section
   findable by search may be absent from the outline.
7. **Stale collection directories can survive below the sweeper.** On
   bind-mounted volumes (notably Windows→WSL), Qdrant may drop a collection from
   its registry at the API level while leaving the directory on disk.
   `sweepOrphans()` enumerates via the API, so it cannot see these. Correctness
   is unaffected — the cost is disk. `yarn docs:reset --yes` clears them.

---

## Scaling: when to move the index off developer machines

The local-first design here — every laptop runs its own Qdrant and embeds the
whole corpus — is the **right default**, not a stepping stone. It has no
infrastructure, no access control to get wrong, no shared thing to break, and it
works offline. Most teams should stay here.

But it does not scale indefinitely, and the point at which it stops being right
is worth recognising *before* everyone is quietly annoyed.

### Signals it is time to move

| Signal | Why it matters |
| --- | --- |
| **A full rebuild takes long enough to notice** | Every developer pays the same CPU cost to produce a byte-identical index. At a 10-minute rebuild nobody minds; at 30 it becomes a thing people complain about, then disable. |
| **Rebuild spikes interrupt people** | The ingest is several cores for its duration. On a constrained laptop, mid-morning is the wrong time to find that out. |
| **Machines disagree** | Two developers with differently-timed rebuilds get different search results for the same question, which is confusing in a way that is hard to even describe out loud. |
| **The corpus spans repos not everyone clones** | A partial checkout produces a partial index, silently. Colleagues get different answers and nobody knows why. |
| **Onboarding waits on an index** | A new joiner's first hour is a model download and a full embed. |

Note that none of these are about corpus *size* on its own. They are about
**duplicated work** and **divergence** — which is why the fix is centralisation,
not a bigger machine.

### The shared, CI-built index

Promote Qdrant to a single shared instance and make CI the only writer:

- **One writer.** A CI job runs the same `ingest-docs.mjs` on merge to the docs
  default branch and on a daily schedule. Laptops never write. The pipeline is
  unchanged — this is a deployment change, not a redesign, which is exactly why
  it is safe to defer until the signals appear.
- **Read-only readers.** Developer MCP clients query through a gateway that
  validates the team's existing auth and injects a read-only key. Qdrant itself
  stays private, with no public ingress.
- **Set `QDRANT_ENGINE=external`** on developer machines, so nothing tries to
  start or repair a shared instance locally. See
  [Running Qdrant](../guides/qdrant-runtimes.md#external--qdrant-managed-elsewhere).
- **No backups.** The index is reproducible from the markdown; recovery is
  re-running the pipeline. This is worth stating explicitly to whoever asks
  about disaster recovery.

**Sizing is genuinely small** — a few hundred MB of memory and a 1 GB volume
covers a documentation corpus comfortably. The reason to do this is developer
experience, not capacity.

### What you give up

Being honest about the trade, because it is a real one:

- **Offline stops working.** No network, no search. For a laptop-first team that
  is a meaningful regression.
- **A stale index becomes someone's job.** Today a laptop notices and self-heals.
  In remote mode a stale index is a CI failure, and it needs an owner and an
  alert, or it rots.
- **Access control appears.** Today there is none and none is needed: local
  stdio MCP, local Qdrant, nothing exposed. A shared instance holding internal
  documentation is a different conversation, and it is the first thing to get
  wrong.
- **A local escape hatch is still required.** Someone editing docs needs to
  search their own edits before merging. Keep local mode working and switchable.

### The one non-obvious blocker: the BM25 model

Query time needs the BM25 model to encode the query's sparse vector, and today
it is a **local file written by ingest**. Once ingest runs in CI, laptops will
not have it — and a vocabulary from one corpus version scoring vectors from
another does not error, it silently degrades ranking.

The resolution is to store the serialized model **inside Qdrant**: as a payload
on a single point in a companion `workspace_docs_meta` collection, swapped
atomically alongside the main collection so vocabulary and vectors are always
version-matched. (Publishing it as a package or committing it to the repo were
both rejected: a second distribution channel is a second chance at version
skew.)

The MCP side needs a `DOCS_RAG_REMOTE` flag that skips the local container start
and skips background ingest entirely — in remote mode a stale index is a CI
concern surfaced as a clear error, not something a laptop tries to fix. Local
mode stays the default, so nothing breaks for anyone who does not opt in.

### Cheaper steps to try first

Centralising is not the only lever, and the others cost far less:

1. **Shrink the corpus.** Most indexes that feel slow are indexing things they
   should not. Re-read the [hygiene rules](#the-corpus--declared-not-discovered)
   and `yarn docs:sources` before buying infrastructure — this is free and
   usually the actual problem.
2. **Widen the refresh window.** The 24-hour ceiling is a default, not a law.
3. **Cap ONNX threads** with `OMP_NUM_THREADS` so the ingest spike stops being
   noticeable, trading rebuild speed for a machine that stays responsive.
4. **Incremental indexing.** Re-embedding only changed chunks is the real fix
   for rebuild cost, and it is blocked on BM25 being corpus-wide — IDF and
   average document length change with any edit. Worth building at a corpus
   where full rebuilds genuinely hurt; not before.

## If you want this in your own team

The design is corpus-shaped, not workspace-shaped. A rough port order, cheapest
first:

1. **Start with the outline tool.** ~200 lines, zero infrastructure. Walk your
   markdown, parse headings, return path + heading path + line range + first
   content line. Ship it, use it for a week. You may find you need nothing else
   — and if you do need more, you now know which queries fail.
2. **Declare your corpus explicitly.** Resist "index everything"; that is how a
   monorepo drowns your own docs in other teams' noise. Add a `docs:sources`
   command so the corpus is inspectable.
3. **Get chunking right before anything else.** Heading-aware, **tables and code
   atomic**, full heading path on every chunk. This has more impact on answer
   quality than the model choice, and a half-table bug is invisible in testing.
4. **Add the dense half.** ~70 lines: `dtype: 'q8'`, `normalize: true`, query
   prefix on queries only, pinned cache dir, lazy singleton, progress callback.
5. **Add the sparse half.** ~120 lines of BM25. Spend the effort on the
   tokenizer — preserve your identifier punctuation and emit sub-tokens.
6. **Fuse with RRF in the store**, not in your code. No score calibration, no
   drift.
7. **Adopt blue-green from day one.** Retrofitting it after you have built
   rebuild-in-place is more work than doing it first.
8. **Automate on staleness *and* change**, validate health rather than trusting
   the timer, and record only successes.
9. **Make it opt-in and isolated.** Optional deps, dynamic imports, tool omitted
   from the list when disabled. This is what makes it shippable into a server
   other people rely on.

Two things worth knowing at the start:

- **The retrieval is the easy part.** The majority of the code is blue-green,
  orphan sweeping, health validation, retries, locks, progress reporting and
  platform quirks — and that is what makes it something people forget is there,
  which is the goal.
- **Every failure mode here is silent.** Missing query prefix, half tables,
  wiped volume, stale-but-"fresh" index, leaked collections. None of them throw.
  Budget your effort for detecting wrong answers, not for handling errors.

---

## Reference

**External**

- [Qdrant hybrid queries & fusion](https://qdrant.tech/documentation/concepts/hybrid-queries/)
- [Qdrant collection aliases](https://qdrant.tech/documentation/concepts/collections/#collection-aliases)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [Snowflake arctic-embed-m-v1.5](https://huggingface.co/Snowflake/snowflake-arctic-embed-m-v1.5)

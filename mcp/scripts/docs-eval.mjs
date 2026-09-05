#!/usr/bin/env node
/**
 * Measure retrieval quality against a golden set — the periodic health check
 * for *answers*, as opposed to `docs:health`, which checks the *plumbing*.
 *
 * WHY THIS EXISTS. Retrieval quality degrades silently as a corpus grows. Every
 * document added is another candidate competing for the same five result slots,
 * so a query that ranked the right section first at 300 chunks can rank it
 * fourth at 3,000 without anything breaking, erroring, or looking different.
 * Nobody notices, because a plausible-but-worse result is indistinguishable
 * from a good one until you check what you expected to get.
 *
 * Run it on a schedule (monthly is a reasonable default) and after any change
 * to the corpus, the chunker, the tokenizer, or the model. Compare against the
 * previous run — the trend matters far more than the absolute numbers, which
 * are only meaningful relative to your own corpus.
 *
 * Golden set: mcp/docs-eval.json. Keep it small and real.
 *
 * Run:
 *   yarn docs:eval                 # summary + failures
 *   yarn docs:eval --verbose       # every case, with the ranked results
 *   yarn docs:eval --json          # machine-readable, for trend tracking in CI
 *
 * Exit: 0 all thresholds met · 1 below threshold · 2 could not run
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bm25, tokenize } from '../src/docs/bm25.js';
import { embedQuery, EMBED_DIM } from '../src/docs/embedder.js';
import { DocsQdrant } from '../src/docs/qdrant.js';

const MCP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(MCP_ROOT, '.docs-index');
const BM25_PATH = join(INDEX_DIR, 'bm25-model.json');
const EVAL_PATH = process.env.DOCS_EVAL_SET || join(MCP_ROOT, 'docs-eval.json');
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const LIMIT = 5;

const args = new Set(process.argv.slice(2));
const verbose = args.has('--verbose');
const asJson = args.has('--json');

if (!existsSync(EVAL_PATH)) {
  console.error(`Golden set not found at ${EVAL_PATH}`);
  process.exit(2);
}
if (!existsSync(BM25_PATH)) {
  console.error(`BM25 model not found at ${BM25_PATH}. Run: cd mcp && yarn docs:ingest`);
  process.exit(2);
}

const spec = JSON.parse(readFileSync(EVAL_PATH, 'utf8'));
const cases = spec.cases ?? [];
const thresholds = { recallAt1: 0.5, recallAt5: 0.8, mrr: 0.6, ...(spec.thresholds ?? {}) };

const bm25 = Bm25.fromJSON(JSON.parse(readFileSync(BM25_PATH, 'utf8')));
const qdrant = new DocsQdrant({ url: QDRANT_URL, dim: EMBED_DIM });

const log = (m = '') => { if (!asJson) console.log(m); };

// ── Run every case ──────────────────────────────────────────────────────────
const results = [];
let totalMs = 0;

for (const c of cases) {
  const expect = Array.isArray(c.expect) ? c.expect : [c.expect];
  const t0 = Date.now();
  const dense = await embedQuery(c.query);
  const sparse = bm25.encodeQuery(tokenize(c.query));
  const points = await qdrant.hybridSearch({ dense, sparse, limit: LIMIT });
  totalMs += Date.now() - t0;

  const paths = points.map((p) => p.payload.filePath);
  // Rank (1-based) of the first result from any expected file; 0 = not found.
  const rank = paths.findIndex((p) => expect.includes(p)) + 1;

  results.push({
    query: c.query,
    note: c.note,
    expect,
    rank,
    // Distinct files in the top-5. A single file monopolising every slot means
    // the agent gets one document's view of the answer and no cross-reference.
    distinctFiles: new Set(paths).size,
    lexicalTerms: sparse.indices.length,
    paths,
  });
}

// ── Metrics ─────────────────────────────────────────────────────────────────
const n = results.length || 1;
const hit = (k) => results.filter((r) => r.rank > 0 && r.rank <= k).length / n;
const metrics = {
  cases: results.length,
  recallAt1: hit(1),
  recallAt3: hit(3),
  recallAt5: hit(5),
  // Mean Reciprocal Rank: rewards ranking the right answer HIGH, not merely
  // including it. A drop here with recall@5 flat is the classic signal that new
  // documents are crowding the top of the list.
  mrr: results.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / n,
  avgDistinctFilesTop5: results.reduce((s, r) => s + r.distinctFiles, 0) / n,
  avgLatencyMs: Math.round(totalMs / n),
};

if (asJson) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), metrics, results }, null, 2));
  process.exit(metricsPass(metrics) ? 0 : 1);
}

// ── Report ──────────────────────────────────────────────────────────────────
const pct = (x) => `${(x * 100).toFixed(0)}%`;

log(`\nRetrieval evaluation — ${results.length} cases, top-${LIMIT}\n`);

if (verbose) {
  for (const r of results) {
    const mark = r.rank === 1 ? ' ✔ ' : r.rank > 0 ? ` ${r.rank}. ` : ' ✘ ';
    log(`${mark} "${r.query}"`);
    log(`     expect: ${r.expect.join(' | ')}`);
    r.paths.forEach((p, i) => log(`     ${i + 1}. ${r.expect.includes(p) ? '→' : ' '} ${p}`));
    if (r.note) log(`     note: ${r.note}`);
    log('');
  }
}

const misses = results.filter((r) => r.rank === 0);
const demoted = results.filter((r) => r.rank > 1);

if (misses.length > 0) {
  log(`MISSED — expected file absent from the top ${LIMIT} (${misses.length}):`);
  for (const r of misses) {
    log(`  "${r.query}"`);
    log(`     expected: ${r.expect.join(' | ')}`);
    log(`     got:      ${r.paths[0] ?? '(nothing)'}`);
  }
  log('');
}

if (!verbose && demoted.length > 0) {
  log(`NOT FIRST — found, but below rank 1 (${demoted.length}):`);
  for (const r of demoted) log(`  rank ${r.rank}: "${r.query}"`);
  log('');
}

log('Metrics');
log(`  recall@1   ${pct(metrics.recallAt1)}   (threshold ${pct(thresholds.recallAt1)})`);
log(`  recall@3   ${pct(metrics.recallAt3)}`);
log(`  recall@5   ${pct(metrics.recallAt5)}   (threshold ${pct(thresholds.recallAt5)})`);
log(`  MRR        ${metrics.mrr.toFixed(3)}  (threshold ${thresholds.mrr.toFixed(2)})`);
log(`  distinct files in top-${LIMIT}, avg  ${metrics.avgDistinctFilesTop5.toFixed(1)}`);
log(`  latency, avg  ${metrics.avgLatencyMs} ms`);
log('');

const passed = metricsPass(metrics);
if (passed) {
  log('PASS — retrieval is within thresholds.');
  log('Record these numbers. The trend over months is the signal; a single run is not.');
} else {
  log('BELOW THRESHOLD.');
  log('');
  log('Before tuning retrieval, check the corpus — degradation is usually content, not code:');
  log('  1. yarn docs:sources   — did something get indexed that should not be?');
  log('     Specs, task tickets, changelogs and templates describe INTENT or');
  log('     history, and outrank reference docs on the queries they share words with.');
  log('  2. Are two documents covering the same topic? Duplicates split the ranking');
  log('     between them, so neither wins.');
  log('  3. Do the missed queries hit sections with vague headings? Every chunk');
  log('     carries its heading path into its embedding — a heading that names the');
  log('     topic is the cheapest ranking fix available.');
  log('  4. Only then consider chunk size, the model, or the tokenizer.');
}
process.exit(passed ? 0 : 1);

function metricsPass(m) {
  return m.recallAt1 >= thresholds.recallAt1 && m.recallAt5 >= thresholds.recallAt5 && m.mrr >= thresholds.mrr;
}

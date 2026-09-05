#!/usr/bin/env node
/**
 * Health check for the hybrid docs index — the §13 runbook as a command.
 *
 * Checks the halves in the order that ISOLATES a fault rather than just
 * reporting one: container → alias → points → BM25 model → freshness → orphans.
 * Each check prints what it saw, so the output is a diagnosis, not a verdict.
 *
 * The reason this exists: every failure mode in this system is silent. A wiped
 * volume, an alias pointing at the empty bootstrap collection, a BM25 model
 * from a different corpus version — none of them throw. `docs_search` keeps
 * returning well-formed responses with fewer (or zero) results, and the agent
 * answers from what it got. This command is how you find that out on purpose.
 *
 * Run:  yarn docs:health
 * Exit: 0 healthy · 1 degraded/broken · 2 could not check (Qdrant unreachable)
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDocFiles } from '../src/docs/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, '..');
const WORKSPACE_ROOT = process.env.DOCS_RAG_WORKSPACE || join(MCP_ROOT, '..');
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(MCP_ROOT, '.docs-index');
const BM25_PATH = join(INDEX_DIR, 'bm25-model.json');
const STATE_PATH = join(INDEX_DIR, 'ingest-state.json');
const QDRANT_URL = (process.env.QDRANT_URL || 'http://127.0.0.1:6333').replace(/\/$/, '');
const ALIAS = process.env.DOCS_RAG_COLLECTION || 'workspace_docs';
const DAY_MS = 24 * 60 * 60 * 1000;

let problems = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const warn = (m) => { problems++; console.log(`  WARN  ${m}`); };
const bad = (m) => { problems++; console.log(`  FAIL  ${m}`); };
const hint = (m) => console.log(`        -> ${m}`);

async function api(path) {
  const res = await fetch(`${QDRANT_URL}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** /healthz answers with plain text ("healthz check passed"), not JSON. */
async function ping() {
  const res = await fetch(`${QDRANT_URL}/healthz`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.text()).trim();
}

async function main() {
  console.log(`Docs index health — ${QDRANT_URL}, alias "${ALIAS}"\n`);

  // ── 1. Qdrant reachable ──────────────────────────────────────────────────
  console.log('[1/6] Qdrant');
  try {
    const pong = await ping();
    ok(`Qdrant is reachable at ${QDRANT_URL} (${pong})`);
  } catch (e) {
    bad(`Qdrant is not reachable at ${QDRANT_URL} (${e.message})`);
    hint('cd mcp && yarn qdrant:up   (or start the MCP server, which auto-starts it)');
    console.log('\nCannot check the index without Qdrant. Stopping here.');
    process.exit(2);
  }

  // ── 2. Alias resolves ────────────────────────────────────────────────────
  console.log('\n[2/6] Alias');
  let live = null;
  try {
    // Qdrant nests every payload under `result`.
    const { result } = await api('/aliases');
    const aliases = result?.aliases ?? [];
    live = aliases.find((a) => a.alias_name === ALIAS)?.collection_name || null;
    if (!live) {
      bad(`Alias "${ALIAS}" does not exist`);
      hint('cd mcp && yarn docs:ingest   (the first ingest creates and points it)');
    } else if (live === `${ALIAS}_bootstrap`) {
      // Reachable and completely useless — the exact failure isIndexReady()
      // exists to catch, and the one that looks healthiest from the outside.
      bad(`Alias points at the EMPTY bootstrap collection "${live}" — every search returns zero results`);
      hint('cd mcp && yarn docs:ingest');
    } else {
      ok(`Alias "${ALIAS}" -> "${live}"`);
    }
  } catch (e) {
    bad(`Could not read aliases: ${e.message}`);
  }

  // ── 3. Points present ────────────────────────────────────────────────────
  console.log('\n[3/6] Index contents');
  let points = 0;
  if (live) {
    try {
      const { result } = await api(`/collections/${live}`);
      points = result?.points_count ?? 0;
      if (points > 0) ok(`${points} points in "${live}" (status: ${result?.status})`);
      else { bad(`Collection "${live}" has 0 points`); hint('cd mcp && yarn docs:ingest'); }
    } catch (e) {
      bad(`Could not read collection "${live}": ${e.message}`);
    }
  }

  // ── 4. BM25 model — the other half ───────────────────────────────────────
  // Search needs BOTH halves. Either one alone does not error; it silently
  // degrades ranking, which is worse.
  console.log('\n[4/6] BM25 model');
  if (!existsSync(BM25_PATH)) {
    bad(`BM25 model missing at ${BM25_PATH}`);
    hint('cd mcp && yarn docs:ingest   (fit over the whole corpus; cannot be produced incrementally)');
  } else {
    try {
      const model = JSON.parse(readFileSync(BM25_PATH, 'utf8'));
      // Serialized as an array of [term, id, idf] triples — see Bm25.toJSON().
      const terms = Array.isArray(model.vocab) ? model.vocab.length : 0;
      const kb = (statSync(BM25_PATH).size / 1024).toFixed(0);
      if (terms === 0) {
        bad('BM25 model has an empty vocabulary — it was fit over an empty corpus');
        hint('cd mcp && yarn docs:sources   (check the corpus resolves to files)');
      } else {
        ok(`${terms} terms, ${kb} KB, k1=${model.k1} b=${model.b}, avgdl ${Number(model.avgdl ?? 0).toFixed(1)}`);
      }
    } catch (e) {
      bad(`BM25 model is unreadable: ${e.message}`);
      hint('cd mcp && yarn docs:ingest');
    }
  }

  // ── 5. Freshness ─────────────────────────────────────────────────────────
  console.log('\n[5/6] Freshness');
  if (!existsSync(STATE_PATH)) {
    warn('No ingest-state.json — the index has never been built by a tracked run');
  } else {
    try {
      const { lastSuccessfulIngestAt } = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      const age = Date.now() - Date.parse(lastSuccessfulIngestAt);
      const hours = (age / 3_600_000).toFixed(1);
      if (Number.isNaN(age)) warn(`Unparseable timestamp "${lastSuccessfulIngestAt}" — treated as stale`);
      else if (age >= DAY_MS) warn(`Last successful ingest was ${hours}h ago (>24h) — a rebuild is due on next MCP start`);
      else ok(`Last successful ingest ${hours}h ago (${lastSuccessfulIngestAt})`);
    } catch (e) {
      warn(`Could not read ingest state: ${e.message}`);
    }
  }

  // Corpus drift: the file count is cheap, and a large gap between "files on
  // disk now" and "files at ingest time" is the usual reason a search misses
  // something the developer can plainly see in the repo.
  const files = collectDocFiles(WORKSPACE_ROOT);
  console.log(`        Corpus resolves to ${files.length} files right now (indexed chunks: ${points}).`);

  // ── 6. Orphans ───────────────────────────────────────────────────────────
  // Exactly one collection is the healthy state. More means an ingest died
  // before its alias swap and left a half-built collection consuming disk.
  console.log('\n[6/6] Orphan collections');
  try {
    const { result } = await api('/collections');
    const ours = (result?.collections ?? []).map((c) => c.name).filter((n) => n === ALIAS || n.startsWith(`${ALIAS}_`));
    const orphans = ours.filter((n) => n !== live);
    if (orphans.length === 0) ok(`Exactly one collection (${ours.length} total matching "${ALIAS}*")`);
    else {
      warn(`${orphans.length} orphan collection(s): ${orphans.join(', ')}`);
      hint('The next ingest sweeps them automatically (sweepOrphans), or delete by hand.');
    }
  } catch (e) {
    warn(`Could not list collections: ${e.message}`);
  }

  console.log('');
  if (problems === 0) {
    console.log('Healthy — docs_search will return correct results.');
    process.exit(0);
  }
  console.log(`${problems} problem(s) found. Full rebuild from scratch:`);
  console.log('  cd mcp && yarn qdrant:down && rm -rf .qdrant-storage .docs-index && yarn qdrant:up && yarn docs:ingest');
  process.exit(1);
}

main().catch((err) => {
  console.error(`[docs:health] unexpected error: ${err.message}`);
  process.exit(2);
});

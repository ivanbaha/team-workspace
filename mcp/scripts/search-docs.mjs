#!/usr/bin/env node
/**
 * Run a docs_search query from the terminal — the same code path the MCP tool
 * uses, without an agent in the loop.
 *
 * This is the debugging tool for retrieval quality. When someone says "the
 * agent could not find X", the question is whether retrieval missed it or the
 * agent ignored it, and those have completely different fixes. Running the
 * query here answers that in one step.
 *
 * `--explain` additionally scores the two halves separately, which is how you
 * tell WHICH half is carrying a result: an identifier that only the dense half
 * finds usually means the tokenizer dropped it; a concept that only BM25 finds
 * usually means the chunk lacks the vocabulary of the question.
 *
 * Run:
 *   yarn docs:query "how does authentication work"
 *   yarn docs:query --limit 10 --explain "role:workspace:team_lead"
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bm25, tokenize } from '../src/docs/bm25.js';
import { embedQuery, EMBED_DIM } from '../src/docs/embedder.js';
import { DocsQdrant } from '../src/docs/qdrant.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(__dirname, '..', '.docs-index');
const BM25_PATH = join(INDEX_DIR, 'bm25-model.json');
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const explain = argv.includes('--explain');
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : 5;
// Drop flags, and the value that follows --limit — but only when --limit is
// actually present, or index -1 + 1 would silently eat the first query word.
const limitValueIdx = limitIdx >= 0 ? limitIdx + 1 : -1;
const query = argv.filter((a, i) => !a.startsWith('--') && i !== limitValueIdx).join(' ').trim();

if (!query) {
  console.error('Usage: yarn docs:query [--limit N] [--explain] "your question"');
  process.exit(1);
}
if (!existsSync(BM25_PATH)) {
  console.error(`BM25 model not found at ${BM25_PATH}.\nRun: cd mcp && yarn docs:ingest`);
  process.exit(1);
}

// ── query ───────────────────────────────────────────────────────────────────
const bm25 = Bm25.fromJSON(JSON.parse(readFileSync(BM25_PATH, 'utf8')));
const qdrant = new DocsQdrant({ url: QDRANT_URL, dim: EMBED_DIM });

const tokens = tokenize(query);
const sparse = bm25.encodeQuery(tokens);
const t0 = Date.now();
const dense = await embedQuery(query);
const embedMs = Date.now() - t0;

const t1 = Date.now();
const points = await qdrant.hybridSearch({ dense, sparse, limit });
const searchMs = Date.now() - t1;

// ── output ──────────────────────────────────────────────────────────────────
console.log(`\nQuery: "${query}"`);
console.log(`Tokens: ${tokens.length} (${sparse.indices.length} known to BM25)`);
if (sparse.indices.length === 0) {
  // Not an error, but worth saying: the lexical half contributed nothing, so
  // this was effectively a dense-only search.
  console.log('  NOTE: no query token is in the BM25 vocabulary — this ran as a dense-only search.');
}
console.log(`Timing: embed ${embedMs}ms · search ${searchMs}ms\n`);

if (points.length === 0) {
  console.log('No results. Check `yarn docs:health`.');
  process.exit(0);
}

points.forEach((p, i) => {
  const { filePath, headingPath, startLine, endLine, text } = p.payload;
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  console.log(`${String(i + 1).padStart(2)}. [${(p.score ?? 0).toFixed(4)}] ${filePath}:${startLine}-${endLine}`);
  console.log(`    ${headingPath}`);
  console.log(`    ${snippet}${text.length > 200 ? '…' : ''}\n`);
});

if (explain) {
  console.log('─'.repeat(72));
  console.log('Per-half ranking (same candidates, fused above by RRF)\n');
  const client = await qdrant.connect();
  const alias = process.env.DOCS_RAG_COLLECTION || 'workspace_docs';

  for (const [label, body] of [
    ['dense (meaning)', { query: dense, using: 'dense' }],
    ['lexical (BM25)', { query: { indices: sparse.indices, values: sparse.values }, using: 'lexical' }],
  ]) {
    const res = await client.query(alias, { ...body, limit, with_payload: true });
    console.log(`${label}:`);
    (res.points || []).forEach((p, i) => {
      console.log(`  ${i + 1}. [${(p.score ?? 0).toFixed(4)}] ${p.payload.filePath} — ${p.payload.headingPath}`);
    });
    console.log('');
  }
}

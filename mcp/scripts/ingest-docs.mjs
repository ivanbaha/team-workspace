#!/usr/bin/env node
/**
 * Ingest the workspace knowledge base into Qdrant for hybrid search:
 *   collect sources (see src/docs/sources.js) -> chunk -> fit BM25
 *   -> embed (dense) -> upsert (dense + sparse)
 *
 * Paths are stored workspace-relative so results point at the real file.
 * Re-runnable: deterministic point ids mean re-ingestion upserts in place.
 * Run:  yarn docs:ingest
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chunkMarkdown } from '../src/docs/chunker.js';
import { Bm25, tokenize } from '../src/docs/bm25.js';
import { embedPassages, EMBED_DIM } from '../src/docs/embedder.js';
import { DocsQdrant, pointId } from '../src/docs/qdrant.js';
import { markIngestSuccess } from '../src/docs/ingest-state.js';
import { collectDocFiles } from '../src/docs/sources.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/scripts -> workspace root
const WORKSPACE_ROOT = process.env.DOCS_RAG_WORKSPACE || join(__dirname, '..', '..');
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(__dirname, '..', '.docs-index');
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const BATCH = Number(process.env.DOCS_RAG_BATCH || 32);

async function main() {
  const startedAt = Date.now();
  console.log(`[ingest] workspace root: ${WORKSPACE_ROOT}`);
  const files = collectDocFiles(WORKSPACE_ROOT);

  const chunks = [];
  for (const { abs, rel } of files) {
    chunks.push(...chunkMarkdown(readFileSync(abs, 'utf8'), rel));
  }
  console.log(`[ingest] ${files.length} files -> ${chunks.length} chunks`);

  // Fit + persist the BM25 model (needed at query time).
  const tokensPerChunk = chunks.map((c) => tokenize(c.text));
  const bm25 = new Bm25().fit(tokensPerChunk);
  mkdirSync(INDEX_DIR, { recursive: true });
  writeFileSync(join(INDEX_DIR, 'bm25-model.json'), JSON.stringify(bm25.toJSON()));
  console.log(`[ingest] BM25 model saved (vocab ${bm25.vocab.size})`);

  // Create a new collection for this ingest run; search keeps querying the old
  // one via the alias until we atomically swap at the end (zero downtime).
  const qdrant = new DocsQdrant({ url: QDRANT_URL, dim: EMBED_DIM });
  // Clean up any collections leaked by previous failed runs before we start.
  await qdrant.sweepOrphans().catch(() => {});
  await qdrant.prepareNewCollection();

  try {
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const dense = await embedPassages(batch.map((c) => c.text));
      const points = batch.map((c, j) => ({
        id: pointId(`${c.filePath}#${c.headingPath}#${c.startLine}`),
        vector: {
          dense: dense[j],
          lexical: bm25.encodeDocument(tokensPerChunk[i + j]),
        },
        payload: {
          filePath: c.filePath,
          headingPath: c.headingPath,
          text: c.text,
          startLine: c.startLine,
          endLine: c.endLine,
        },
      }));
      await qdrant.upsert(points);
      const done = Math.min(i + BATCH, chunks.length);
      const pct = Math.round((done / chunks.length) * 100);
      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = done > 0 ? Math.round((elapsed / done) * (chunks.length - done)) : 0;
      console.log(
        `[ingest] embedded ${done}/${chunks.length} chunks (${pct}%) — ${elapsed.toFixed(0)}s elapsed, ~${eta}s left`
      );
    }

    // Atomically swap the alias to point at the new collection; deletes the old.
    await qdrant.swapAlias();
  } catch (err) {
    // Drop the half-built collection so it isn't left orphaned in Qdrant.
    await qdrant.dropIngestCollection().catch(() => {});
    throw err;
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[ingest] done in ${totalSec}s`);
  // Record the successful run so the daily auto-ingest scheduler skips for 24h.
  markIngestSuccess();
}

main().catch((err) => {
  console.error('[ingest] FAILED:', err.message);
  console.error('[ingest] You can retry manually with: cd mcp && yarn docs:ingest');
  process.exit(1);
});

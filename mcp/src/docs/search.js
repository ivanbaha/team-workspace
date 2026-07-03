import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Bm25, tokenize } from './bm25.js';
import { embedQuery, EMBED_DIM } from './embedder.js';
import { DocsQdrant } from './qdrant.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/src/docs -> mcp/src -> mcp/.docs-index
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(__dirname, '..', '..', '.docs-index');
const BM25_PATH = join(INDEX_DIR, 'bm25-model.json');
const MAX_LIMIT = 20;

export class DocsSearchTools {
  constructor(config = {}) {
    this.qdrantUrl = config.qdrantUrl || process.env.QDRANT_URL || 'http://127.0.0.1:6333';
    this.qdrant = new DocsQdrant({ url: this.qdrantUrl, dim: EMBED_DIM });
    this.bm25 = null;
    this.ready = null;
  }

  async initialize() {
    // No-op: Qdrant connection + index validation happen in bootstrapDocsSearch
    // on startup; the BM25 model and embedder load lazily on first query.
  }

  createResponse(success, data = null, message = '') {
    return { success, data, message };
  }

  /** Lazy one-time setup: load the BM25 model and connect to Qdrant. */
  async _ensureReady() {
    if (!this.ready) {
      this.ready = (async () => {
        if (!existsSync(BM25_PATH)) {
          throw new Error(`BM25 model not found at ${BM25_PATH}. Run "yarn docs:ingest" first.`);
        }
        this.bm25 = Bm25.fromJSON(JSON.parse(readFileSync(BM25_PATH, 'utf8')));
        await this.qdrant.connect();
        await this.qdrant.ensureAlias();
      })();
    }
    return this.ready;
  }

  async search(query, limit = 5) {
    try {
      if (!query || !query.trim()) throw new Error('query is required');
      await this._ensureReady();

      const q = query.trim();
      const [dense, sparse] = [await embedQuery(q), this.bm25.encodeQuery(tokenize(q))];
      const points = await this.qdrant.hybridSearch({
        dense,
        sparse,
        limit: Math.min(limit || 5, MAX_LIMIT),
      });

      const results = points.map((p) => ({
        score: Number((p.score ?? 0).toFixed(4)),
        filePath: p.payload.filePath,
        heading: p.payload.headingPath,
        lines: `${p.payload.startLine}-${p.payload.endLine}`,
        snippet: snippet(p.payload.text),
      }));

      return this.createResponse(true, { query: q, results }, `${results.length} matching doc sections`);
    } catch (error) {
      logger.error('docs_search failed:', error.message);
      return this.createResponse(false, null, error.message);
    }
  }
}

function snippet(text, n = 200) {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

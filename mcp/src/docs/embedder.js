/**
 * Dense embeddings via Transformers.js (ONNX in-process, no Python).
 *
 * The model is loaded lazily, once. bge/Arctic retrieval models need an
 * instruction prefix on the QUERY only (not passages); with normalize:true the
 * vectors are unit length so cosine similarity is a dot product.
 *
 * NOTE: `@huggingface/transformers` v3 selects quantization via `dtype`
 * (e.g. 'q8', 'fp32') — NOT the v2 `{ quantized: true }` option.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const MODEL_ID = process.env.DOCS_RAG_MODEL || 'Snowflake/snowflake-arctic-embed-m-v1.5';
const DTYPE = process.env.DOCS_RAG_DTYPE || 'q8';
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

// Model cache is hardcoded to mcp/.cache (git-ignored, self-contained in the
// project — same pattern as the docs index). mcp/src/docs -> mcp/.cache
const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_CACHE_DIR = join(__dirname, '..', '..', '.cache');

/** Embedding dimensionality (must match the Qdrant collection's dense size). */
export const EMBED_DIM = Number(process.env.DOCS_RAG_DIM || 768);

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = MODEL_CACHE_DIR;
      logger.info(`[docs-rag] Loading embedding model ${MODEL_ID} (dtype=${DTYPE}, cache=${MODEL_CACHE_DIR})`);
      // Surface download/load progress so a fresh run (which fetches hundreds of
      // MB of model weights) isn't a silent multi-minute freeze.
      const seen = new Set();
      const extractor = await pipeline('feature-extraction', MODEL_ID, {
        dtype: DTYPE,
        progress_callback: (p) => {
          if (p.status === 'progress' && p.file) {
            const pct = Math.round(p.progress || 0);
            const key = `${p.file}:${pct - (pct % 25)}`; // log at ~0/25/50/75/100%
            if (!seen.has(key)) {
              seen.add(key);
              logger.info(`[docs-rag] Downloading ${p.file}: ${pct}%`);
            }
          } else if (p.status === 'done' && p.file && !seen.has(`done:${p.file}`)) {
            seen.add(`done:${p.file}`);
            logger.info(`[docs-rag] Fetched ${p.file}`);
          }
        },
      });
      logger.info('[docs-rag] Embedding model ready');
      return extractor;
    })();
  }
  return extractorPromise;
}

/** Embed an array of passage texts -> array of number[] (one dense vector each). */
export async function embedPassages(texts) {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist();
}

/** Embed a single query, with the retrieval instruction prefix. */
export async function embedQuery(text) {
  const extractor = await getExtractor();
  const output = await extractor([QUERY_PREFIX + text], { pooling: 'mean', normalize: true });
  return output.tolist()[0];
}

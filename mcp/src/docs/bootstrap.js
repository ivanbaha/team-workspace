/**
 * Startup wiring for the opt-in hybrid docs search:
 *   1. auto-start the local Qdrant container (if not already running)
 *   2. validate the index is actually present (Qdrant points + BM25 model)
 *   3. rebuild in the background if the index is missing/empty, or if the daily
 *      refresh is due
 *
 * Validating eagerly on startup (instead of only trusting the daily timer)
 * means a wiped Qdrant volume is detected and rebuilt before the user hits the
 * tool — rather than silently returning no results.
 *
 * Best-effort: any failure here is logged and swallowed so the rest of the MCP
 * server (GitLab/Jira/etc.) keeps working.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureQdrantRunning } from './qdrant-runtime.js';
import { shouldIngest, markIngestSuccess } from './ingest-state.js';
import { DocsQdrant } from './qdrant.js';
import { EMBED_DIM } from './embedder.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = join(__dirname, '..', '..');
const INGEST_SCRIPT = join(MCP_ROOT, 'scripts', 'ingest-docs.mjs');
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(MCP_ROOT, '.docs-index');
const BM25_PATH = join(INDEX_DIR, 'bm25-model.json');

/**
 * Ensure Qdrant is up, validate the index, and rebuild if needed (missing data
 * or daily refresh due).
 */
export async function bootstrapDocsSearch(config) {
  const url = config.qdrantUrl;

  try {
    await ensureQdrantRunning(url);
  } catch (e) {
    logger.warn(`[docs-rag] Qdrant auto-start failed: ${e.message}. docs_search will error until it's reachable.`);
    return;
  }

  const healthy = await isIndexHealthy(url);
  const stale = shouldIngest();

  if (healthy && !stale) {
    logger.info('[docs-rag] Index present and refreshed within 24h; nothing to do.');
    return;
  }

  const reason = !healthy
    ? 'index missing or empty (e.g. wiped Qdrant volume) — rebuilding now'
    : 'daily refresh due — rebuilding in background';
  runIngestInBackground(url, reason);
}

/**
 * The index is healthy only if BOTH sides are present: the Qdrant alias points
 * at a non-empty collection AND the local BM25 model file exists. If either is
 * gone, search can't return correct results and we must rebuild.
 */
async function isIndexHealthy(url) {
  const bm25Ok = existsSync(BM25_PATH);
  if (!bm25Ok) logger.warn(`[docs-rag] BM25 model missing at ${BM25_PATH}`);

  let qdrantOk = false;
  try {
    qdrantOk = await new DocsQdrant({ url, dim: EMBED_DIM }).isIndexReady();
  } catch (e) {
    logger.warn(`[docs-rag] Qdrant index health check failed: ${e.message}`);
  }
  if (!qdrantOk) logger.warn('[docs-rag] Qdrant index missing or empty');

  return bm25Ok && qdrantOk;
}

/**
 * Spawn `ingest-docs.mjs` as a child so it doesn't block server startup.
 * stdio is NOT inherited (parent stdout is the MCP protocol channel) — child
 * output is forwarded to the logger (stderr). State is marked only on exit 0.
 */
function runIngestInBackground(url, reason) {
  logger.info(`[docs-rag] Starting docs ingest in background: ${reason}.`);
  const child = spawn(process.execPath, [INGEST_SCRIPT], {
    cwd: MCP_ROOT,
    env: { ...process.env, QDRANT_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = (buf) => buf.toString().split(/\r?\n/).filter(Boolean).forEach((l) => logger.info(`[ingest] ${l}`));
  child.stdout?.on('data', forward);
  child.stderr?.on('data', forward);

  child.on('error', (err) => logger.warn(`[docs-rag] Failed to launch auto-ingest: ${err.message}`));
  child.on('close', (code) => {
    if (code === 0) {
      markIngestSuccess();
      logger.info('[docs-rag] Docs ingest completed successfully.');
    } else {
      logger.warn(`[docs-rag] Docs ingest exited with code ${code}; will retry on next start.`);
    }
  });
}

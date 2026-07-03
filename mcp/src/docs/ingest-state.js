/**
 * Tracks the docs auto-ingest schedule. State is a tiny JSON file inside the
 * (git-ignored) .docs-index dir. Only *successful* ingests are recorded, so a
 * failed attempt is retried on the next start rather than silently skipped.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// mcp/src/docs -> mcp/.docs-index
const INDEX_DIR = process.env.DOCS_RAG_INDEX_DIR || join(__dirname, '..', '..', '.docs-index');
const STATE_PATH = join(INDEX_DIR, 'ingest-state.json');
const DAY_MS = 24 * 60 * 60 * 1000;

export function readState() {
  try {
    if (!existsSync(STATE_PATH)) return null;
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    logger.warn(`[docs-rag] Could not read ingest state (${e.message}); treating as stale.`);
    return null;
  }
}

/** True if docs have never been ingested successfully or the last success is >24h old. */
export function shouldIngest(now = Date.now()) {
  const state = readState();
  const last = Date.parse(state?.lastSuccessfulIngestAt ?? '');
  if (Number.isNaN(last)) return true;
  return now - last >= DAY_MS;
}

/** Record a successful ingest (call only after ingestion completes without error). */
export function markIngestSuccess(now = new Date()) {
  try {
    mkdirSync(INDEX_DIR, { recursive: true });
    const state = { lastSuccessfulIngestAt: now.toISOString() };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    logger.info(`[docs-rag] Recorded successful ingest at ${state.lastSuccessfulIngestAt}`);
  } catch (e) {
    logger.warn(`[docs-rag] Could not write ingest state: ${e.message}`);
  }
}

export { STATE_PATH };

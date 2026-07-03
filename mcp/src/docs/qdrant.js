/**
 * Qdrant access for hybrid docs search.
 *
 * Uses a blue-green alias pattern for zero-downtime re-indexing:
 *   - Search always queries the ALIAS (e.g. "workspace_docs").
 *   - Ingest creates a NEW timestamped collection, upserts into it, then
 *     atomically swaps the alias to point at the new collection.
 *   - The old collection is deleted after the swap.
 *
 * This means search stays available throughout the entire ingest process.
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger.js';

const ALIAS = process.env.DOCS_RAG_COLLECTION || 'workspace_docs';

/** Deterministic UUID from a chunk key, so re-ingestion upserts in place. */
export function pointId(key) {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export class DocsQdrant {
  constructor({ url, dim }) {
    this.url = url;
    this.dim = dim;
    this.client = null;
    // The actual collection name used during ingestion (timestamped).
    this._ingestCollection = null;
  }

  async connect() {
    if (!this.client) {
      const { QdrantClient } = await import('@qdrant/js-client-rest');
      this.client = new QdrantClient({ url: this.url, checkCompatibility: false });
    }
    return this.client;
  }

  // ─── Search (queries the alias) ────────────────────────────────────────────

  /** Hybrid query: dense + sparse prefetch fused with RRF. Queries the alias. */
  async hybridSearch({ dense, sparse, limit = 5 }) {
    const client = await this.connect();
    const res = await withRetry(
      () =>
        client.query(ALIAS, {
          prefetch: [
            { query: dense, using: 'dense', limit: limit * 4 },
            { query: { indices: sparse.indices, values: sparse.values }, using: 'lexical', limit: limit * 4 },
          ],
          query: { fusion: 'rrf' },
          limit,
          with_payload: true,
        }),
      'query'
    );
    return res.points || [];
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  /**
   * True only if the alias resolves to a collection that actually has points.
   * Detects a wiped/missing Qdrant volume so startup can rebuild proactively.
   */
  async isIndexReady() {
    const client = await this.connect();
    const col = await this._resolveAlias(client);
    if (!col) return false;
    try {
      const info = await client.getCollection(col);
      const count = info?.points_count ?? info?.pointsCount ?? 0;
      return count > 0;
    } catch {
      return false;
    }
  }

  // ─── Ingest (blue-green via alias swap) ────────────────────────────────────

  /**
   * Prepare a fresh collection for ingestion. Creates a new timestamped
   * collection; subsequent `upsert()` calls write to it. Call `swapAlias()`
   * when ingestion is complete to atomically make it live.
   */
  async prepareNewCollection() {
    const client = await this.connect();
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    this._ingestCollection = `${ALIAS}_${ts}`;
    await client.createCollection(this._ingestCollection, {
      vectors: { dense: { size: this.dim, distance: 'Cosine' } },
      sparse_vectors: { lexical: {} },
    });
    logger.info(`[docs-rag] Created new collection "${this._ingestCollection}" (dim=${this.dim})`);
    return this._ingestCollection;
  }

  /** Upsert points into the current ingest collection. */
  async upsert(points) {
    const col = this._ingestCollection;
    if (!col) throw new Error('Call prepareNewCollection() before upsert()');
    const client = await this.connect();
    await withRetry(() => client.upsert(col, { wait: true, points }), 'upsert');
  }

  /**
   * Atomically swap the alias from whatever it currently points at to the new
   * collection, then delete the old one. Search sees zero downtime.
   *
   * Handles the migration case where a legacy collection with the alias name
   * exists (pre-alias setup) — deletes it first to free the name.
   */
  async swapAlias() {
    const newCol = this._ingestCollection;
    if (!newCol) throw new Error('No ingest collection to swap to');
    const client = await this.connect();

    // Migration: if a real collection with the alias name exists (pre-alias era),
    // delete it — Qdrant won't allow an alias with the same name as a collection.
    const { exists: legacyExists } = await client.collectionExists(ALIAS);
    if (legacyExists) {
      // Check it's NOT just our alias resolving — aliases don't show in collectionExists,
      // so if this returns true, it's a real collection blocking us.
      const currentAlias = await this._resolveAlias(client);
      // If the alias doesn't resolve to ALIAS (i.e., there's no alias yet),
      // the collection named ALIAS is a legacy one that must be removed.
      if (!currentAlias || currentAlias === ALIAS) {
        logger.info(`[docs-rag] Deleting legacy collection "${ALIAS}" to free the alias name...`);
        await client.deleteCollection(ALIAS);
      }
    }

    // Find what the alias currently points at (if anything).
    const oldCol = await this._resolveAlias(client);

    // Atomic alias update: always delete then create to avoid "Conflict".
    await client.updateCollectionAliases({
      actions: [
        { delete_alias: { alias_name: ALIAS } },
        { create_alias: { collection_name: newCol, alias_name: ALIAS } },
      ],
    });
    logger.info(`[docs-rag] Alias "${ALIAS}" now points to "${newCol}"${oldCol ? ` (was "${oldCol}")` : ''}`);

    // Cleanup: delete the previous collection (retry transient errors; a
    // failure here is non-fatal — the alias already points at the new one).
    if (oldCol && oldCol !== newCol) {
      try {
        await withRetry(() => client.deleteCollection(oldCol), 'deleteCollection');
        logger.info(`[docs-rag] Deleted old collection "${oldCol}"`);
      } catch (e) {
        logger.warn(`[docs-rag] Failed to delete old collection "${oldCol}": ${e.message}`);
      }
    }

    this._ingestCollection = null;

    // Best-effort sweep of any leaked collections from previously failed runs.
    await this.sweepOrphans().catch(() => {});
  }

  /**
   * Delete the half-built ingest collection. Called when an ingest run fails
   * before `swapAlias()` so a partial collection isn't left behind orphaned.
   */
  async dropIngestCollection() {
    const col = this._ingestCollection;
    if (!col) return;
    const client = await this.connect();
    await client.deleteCollection(col).catch((e) =>
      logger.warn(`[docs-rag] Failed to drop partial collection "${col}": ${e.message}`)
    );
    logger.info(`[docs-rag] Dropped partial ingest collection "${col}"`);
    this._ingestCollection = null;
  }

  /**
   * Delete stray "${ALIAS}_*" collections that aren't the live alias target,
   * the bootstrap, or the collection currently being ingested. These accumulate
   * when an ingest run dies between prepareNewCollection() and swapAlias().
   */
  async sweepOrphans() {
    const client = await this.connect();
    const live = await this._resolveAlias(client);
    const keep = new Set([live, this._ingestCollection, `${ALIAS}_bootstrap`].filter(Boolean));
    const { collections = [] } = await client.getCollections();
    for (const { name } of collections) {
      if (name.startsWith(`${ALIAS}_`) && !keep.has(name)) {
        await client.deleteCollection(name).catch((e) =>
          logger.warn(`[docs-rag] Failed to sweep orphan collection "${name}": ${e.message}`)
        );
        logger.info(`[docs-rag] Swept orphan collection "${name}"`);
      }
    }
  }

  /**
   * Ensure at least one collection exists behind the alias so search doesn't
   * blow up before the first ingest completes. Called on server startup.
   *
   * Also handles migration from the old pre-alias setup where a *collection*
   * named "workspace_docs" existed directly (alias name conflicts with collection name).
   */
  async ensureAlias() {
    const client = await this.connect();

    // Check if the alias already exists and resolves to a collection.
    const existing = await this._resolveAlias(client);
    if (existing) return; // alias works — nothing to do.

    // Migration: if a real collection with the alias name exists (pre-alias
    // setup), rename it so we can create the alias.
    const { exists: collisionExists } = await client.collectionExists(ALIAS);
    if (collisionExists) {
      const migratedName = `${ALIAS}_migrated`;
      logger.info(`[docs-rag] Found legacy collection "${ALIAS}"; renaming to "${migratedName}" to free the alias name.`);
      // Qdrant doesn't support rename, so: create alias pointing at the old
      // collection (which IS the data we want to keep queryable).
      // Actually — Qdrant allows an alias to share the name with a collection
      // only if the collection is deleted first. So we need to recreate:
      // 1. Create a temporary alias pointing at the old collection under a new name? No.
      // The simplest correct path: just delete the old collection and let the
      // first ingest rebuild. The user will have search unavailable only until
      // the background ingest finishes (one time migration).
      await client.deleteCollection(ALIAS).catch(() => {});
      logger.info(`[docs-rag] Deleted legacy collection "${ALIAS}"; first ingest will rebuild the index.`);
    }

    // No alias yet — create an empty bootstrap collection and point the alias.
    const bootstrap = `${ALIAS}_bootstrap`;
    const { exists } = await client.collectionExists(bootstrap);
    if (!exists) {
      await client.createCollection(bootstrap, {
        vectors: { dense: { size: this.dim, distance: 'Cosine' } },
        sparse_vectors: { lexical: {} },
      });
    }
    // Use delete + create to avoid conflict if a stale alias entry exists.
    await client.updateCollectionAliases({
      actions: [
        { delete_alias: { alias_name: ALIAS } },
        { create_alias: { collection_name: bootstrap, alias_name: ALIAS } },
      ],
    });
    logger.info(`[docs-rag] Bootstrapped alias "${ALIAS}" -> "${bootstrap}" (empty, first ingest will replace it)`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve which collection the alias currently points at, or null. */
  async _resolveAlias(client) {
    try {
      const aliases = await client.getAliases();
      const entry = aliases?.aliases?.find((a) => a.alias_name === ALIAS);
      return entry?.collection_name || null;
    } catch {
      return null;
    }
  }
}

/**
 * Retry transient failures. WSL's localhost port-forwarding can reset a
 * keep-alive socket mid-stream ("fetch failed"); a short backoff recovers it.
 */
async function withRetry(fn, label, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = /fetch failed|ECONNRESET|socket hang up|ECONNREFUSED|EPIPE/i.test(
        `${err?.message} ${err?.cause?.code || ''}`
      );
      if (!transient || i === attempts) throw err;
      const delay = 250 * 2 ** (i - 1);
      logger.warn(`[docs-rag] Qdrant ${label} failed (attempt ${i}/${attempts}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export { ALIAS as COLLECTION };

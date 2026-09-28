import { Injectable } from '@nestjs/common';
import { CacheService, cacheKeyOrNull } from '@tw/cache';
import { HttpConnectionService } from '@tw/http-connector';
import { LoggerService } from '@tw/logger';
import { deriveTraceId, newTraceId } from '@tw/tracing';
import * as jwt from 'jsonwebtoken';
import { LOCK_KEY, QUEUE_KEY } from './cache-keys';
import { CategoryStats, Envelope, ProductLike, computeCategoryStats } from '../stats/category-stats';

const CONTEXT = 'RecalculationsService';

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `products-sync-service configuration error: ${name} must be a positive integer (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/**
 * The cache's **operator** role: it runs the work queue, the batch lock, and the recomputation
 * that keeps the aggregate entries fresh.
 *
 * The queue is a Redis Set on the shared cache — `SADD` enqueues (duplicates collapse for free),
 * `SPOP` drains atomically (two drains can never hand out the same id), and the set survives a
 * crash of this service, which is the whole reason the queue lives there and not in a timer. The
 * batch lock is `SET NX EX`: it stops N accepted requests from scheduling N drains of the same
 * queue. Its TTL is the release — there is no unlock call, because a process that died between
 * acquiring and draining must not block scheduling forever.
 *
 * Everything here runs **outside request scope**, so this service takes the singleton
 * `LoggerService` and the singleton `HttpConnectionService` — the second half of the two-connector
 * pattern (see the @tw/http-connector README) — and supplies trace ids by hand: one new root id
 * per drain, one id derived from it per category, so a batch reads in the logs as one trace
 * family rather than N unrelated roots.
 */
@Injectable()
export class RecalculationsService {
  private readonly productsUrl = process.env.PRODUCTS_SERVICE_URL ?? 'http://localhost:4002';
  private readonly batchDelayMs: number;
  private readonly lockTtlSeconds: number;
  private readonly batchSize: number;
  private readonly statsTtlSeconds: number;

  constructor(
    private readonly cache: CacheService,
    private readonly http: HttpConnectionService,
    private readonly logger: LoggerService,
  ) {
    this.batchDelayMs =
      positiveInteger(Number(process.env.BATCH_DELAY_SECONDS ?? 5), 'BATCH_DELAY_SECONDS') * 1000;
    this.lockTtlSeconds = positiveInteger(Number(process.env.LOCK_TTL_SECONDS ?? 10), 'LOCK_TTL_SECONDS');
    this.batchSize = positiveInteger(Number(process.env.BATCH_SIZE ?? 100), 'BATCH_SIZE');
    // The cache lib validates this one per write; a NaN here fails the first `set`, loudly.
    this.statsTtlSeconds = Number(process.env.CACHE_TTL ?? 300);
  }

  /**
   * Startup reconciliation: a previous process may have enqueued ids and died before its drain
   * ran. The set is the durable half of the queue, so the work is still there — this is what
   * schedules the drain that finishes it. Without this, an id accepted seconds before a crash
   * would sit in the set forever while its stats entry went staler and staler.
   */
  async onApplicationBootstrap(): Promise<void> {
    const pending = await this.cache.getSizeOfSet(QUEUE_KEY);
    if (pending === 0) return;

    this.logger.warn(
      `Found ${pending} orphaned recalculation(s) in the queue at startup — scheduling a batch to drain them`,
      CONTEXT,
    );
    await this.scheduleBatch();
  }

  /**
   * Enqueues category ids and makes sure a drain is scheduled to process them.
   *
   * `addToSet` **fails closed** — it throws when the cache is unreachable, and the controller maps
   * that to a 503 — because this is a write, and reporting "accepted" for work that was never
   * stored would lose it silently. That is the opposite policy from the reads, which fail open:
   * the rule the whole cache lib follows is "fail open when the *cache* is broken, fail closed
   * when the *caller* would be lied to".
   *
   * @returns how many ids were newly added (an id already in the set is not re-added), and
   *   whether this call scheduled the drain (false = one was already scheduled, or the lock
   *   could not be taken because the cache is unreachable — in both cases the work is in the
   *   set, so nothing is lost).
   */
  async requestRecalculation(categoryIds: string[]): Promise<{ queued: number; scheduled: boolean }> {
    const queued = await this.cache.addToSet(QUEUE_KEY, categoryIds);
    const scheduled = await this.scheduleBatch();
    return { queued, scheduled };
  }

  /**
   * Schedules one drain, if this call wins the lock.
   *
   * The lock fails closed on a cache outage (returns false, no timer): the work stays safely in
   * the set, and the next accepted request — or a restart's reconciliation — schedules the drain
   * once the cache is back. The lock is a cost optimisation, not the correctness mechanism: if its
   * TTL were shorter than the delay, a second request could schedule a second drain, and both
   * drains would simply split the set between them — SPOP hands each id to exactly one of them.
   */
  private async scheduleBatch(): Promise<boolean> {
    const acquired = await this.cache.acquireLock(LOCK_KEY, this.lockTtlSeconds);
    if (!acquired) {
      this.logger.debug(JSON.stringify({ batch: 'already-scheduled' }), CONTEXT);
      return false;
    }

    // The delay is defined once, in seconds; the milliseconds are derived once, here. Unit
    // consistency between the two is not left to whoever reads the constant next.
    setTimeout(() => {
      void this.drain();
    }, this.batchDelayMs);
    return true;
  }

  /**
   * Drains the queue: pops a batch of ids, invalidates their stats entries in ONE round trip —
   * before any recomputation — then recomputes each category and stores the fresh aggregate.
   *
   * Invalidation goes first by design: a reader arriving in the gap between invalidation and
   * recomputation gets a miss and loads on demand, never a stale aggregate. Bulk-deleting before
   * the network calls also means a slow or failing products-service cannot leave the cache
   * serving entries the queue has already promised to recompute.
   *
   * Failure policy inside the loop: a category whose recomputation fails is logged under its
   * derived trace id and dropped. It is deliberately NOT re-enqueued — a re-enqueue inside the
   * drain would be popped again by this same loop, and a permanently broken category would spin
   * the batch forever. The caller re-POSTs to retry.
   */
  private async drain(): Promise<void> {
    const runId = newTraceId();
    const token = this.serviceToken();
    this.logger.info(JSON.stringify({ batch: 'start', runId }), CONTEXT, runId);

    let ids = await this.cache.popFromSet(QUEUE_KEY, this.batchSize);
    let processed = 0;

    while (ids.length > 0) {
      // Queued ids arrive from a request body, so an un-keyable one must not be able to kill the
      // whole drain: it simply has no stats entry to invalidate. Without the null variant, one
      // malformed id would throw here — after the pop, before the recompute — taking the rest
      // of the batch with it.
      const keys = ids
        .map((id) => cacheKeyOrNull('categoryStats', id))
        .filter((key): key is string => key !== null);
      const invalidated = await this.cache.delMany(keys);
      this.logger.debug(
        `Invalidated ${invalidated} stats entr${invalidated === 1 ? 'y' : 'ies'} before recomputing ${ids.length} categor${ids.length === 1 ? 'y' : 'ies'}`,
        CONTEXT,
        runId,
      );

      for (const categoryId of ids) {
        const traceId = deriveTraceId(runId, 'category', categoryId);
        try {
          const stats = await this.fetchCategoryStats(categoryId, token, traceId);
          const statsKey = cacheKeyOrNull('categoryStats', categoryId);
          // A category with no products is not a stats entry: its old one was invalidated above,
          // and the on-demand read negative-caches it on the next miss. An un-keyable category
          // has no entry to store either — computed and skipped, not a 500.
          if (stats && statsKey) {
            await this.cache.set(statsKey, stats, this.statsTtlSeconds);
            processed++;
          }
        } catch (error) {
          const status = (error as { status?: number })?.status;
          this.logger.error(
            `Recomputation of category ${categoryId} failed${status ? ` (upstream ${status})` : ''}: ${(error as Error)?.message ?? 'unknown error'}`,
            (error as Error)?.stack,
            CONTEXT,
            traceId,
          );
        }
      }

      ids = await this.cache.popFromSet(QUEUE_KEY, this.batchSize);
    }

    this.logger.info(JSON.stringify({ batch: 'done', runId, processed }), CONTEXT, runId);
  }

  /**
   * The batch's fetch: products for one category, over the singleton connector, under the derived
   * trace id for that category. Only freshly computed values are stored — the aggregate is built
   * from raw products on every recomputation, never from another cached entry.
   *
   * The `no-cache` header is what keeps that literally true now that products-service caches its
   * lists: a machine caller demanding freshness uses the same contract a human one does, and the
   * bypass-and-refresh happens on the owner's side. Without it, a recomputation could quietly
   * aggregate a list entry that is up to CACHE_TTL seconds old — "fresh as of the list" rather
   * than "fresh as of now".
   */
  private async fetchCategoryStats(
    categoryId: string,
    token: string,
    traceId: string,
  ): Promise<CategoryStats | null> {
    const response = await this.http.connect<Envelope<ProductLike[]>>({
      url: `${this.productsUrl}/v1/products`,
      method: 'GET',
      params: { category: categoryId },
      headers: { authorization: `Bearer ${token}`, 'cache-control': 'no-cache' },
      traceId,
    });
    return computeCategoryStats(categoryId, response.data);
  }

  /**
   * Mints the batch's own credential: a short-lived JWT identifying **this service**, not a user.
   *
   * A background job has no inbound request, so there is no caller's bearer token to forward —
   * without this, every call it makes arrives unauthenticated and dies at the guard, which is the
   * classic "works from curl, dead in the cron" failure. The token is minted once per drain and
   * lives just long enough to cover a batch; it is signed with the same shared secret users-service
   * signs with, so any service that verifies user tokens verifies this one too — the claim set is
   * what says "this is the sync service", and that is what an audit trail of a batch run should
   * show.
   */
  private serviceToken(): string {
    return jwt.sign({ sub: 'products-sync-service', type: 'service' }, process.env.JWT_SECRET ?? 'changeme', {
      expiresIn: '5m',
    });
  }
}
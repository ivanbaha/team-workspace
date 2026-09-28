import { Inject, Injectable } from '@nestjs/common';

// A value import on purpose: `emitDecoratorMetadata` references the class at runtime, and a
// type-only import makes TypeScript emit `Object` for this constructor param — which Nest then
// cannot resolve. `CacheService` is only used as a type below, so the temptation to "clean this
// up" to `import type` will be real; it breaks DI at boot, not at typecheck.
import { CacheService } from './cache.service';
import { CACHE_LOGGER, NEGATIVE_CACHE_SENTINEL } from './constants';
import { assertTtlSeconds } from './validate';
import { CacheOptions } from './types';

import type { ITraceLogger } from '@tw/logger';

const CONTEXT = 'ReadThroughService';

export interface ReadThroughOptions<T> {
  /** Full cache key — built with `cacheKey()`, never by hand. */
  key: string;
  /**
   * Fetches the authoritative value. Returns `null` when the entity does not exist — `null` is
   * what gets negative-cached, so "does not exist" must be told apart from "could not load":
   * **throw** on failure, do not return null for it.
   */
  load: () => Promise<T | null>;
  /**
   * HTTP `no-cache` semantics: skip the cached read, load from the source, and **overwrite the
   * entry** with what comes back. The repair has to stick — a bypass that leaves the stale entry
   * in place re-serves it to the very next reader, and the person who sent the header concludes
   * it does nothing.
   */
  noCache?: boolean;
  /** Overrides the module TTL for this key. Seconds; a positive integer. */
  ttlSeconds?: number;
  /** Overrides `negativeTtlSeconds` for this key. */
  negativeTtlSeconds?: number;
  /** Correlates the cache decision lines with the request that caused them. */
  traceId?: string;
}

/**
 * The owner's read: one key, one loader, cache-aside handled once instead of per call site.
 *
 * Two behaviours live here rather than in the stores because no store can provide them:
 *
 * - **Negative caching.** A `load` that returns `null` stores the sentinel for a short TTL, so
 *   the second request for a user that does not exist is answered without the lookup — and
 *   without the stores needing to know which values are placeholders.
 * - **Single-flight.** Concurrent misses for one key share one `load` call. A cache stampede is
 *   not caused by the cache being empty; it is caused by N requests all deciding, at the same
 *   moment, that they are the one who must fetch. The per-key in-flight map makes that decision
 *   once, and the rest join the flight that is already under way. A `noCache` request joining a
 *   normal miss in flight is fine — it gets data loaded *now*, which is the freshest thing that
 *   exists, and one load beats two.
 */
@Injectable()
export class ReadThroughService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cache: CacheService,
    @Inject(CacheOptions) private readonly options: CacheOptions,
    @Inject(CACHE_LOGGER) private readonly logger: ITraceLogger,
  ) {}

  /**
   * A load that can never yield `null` can never be negative-cached, so the read can never
   * return `null` either — the type says so, and callers skip the null check. This is where the
   * `[]`-vs-sentinel distinction lives: an empty list is a **value** (a category with no
   * products), while `null` means *proven absent*, and only the latter goes through the sentinel.
   */
  readThrough<T>(options: ReadThroughOptions<T> & { load: () => Promise<T> }): Promise<T>;
  /** A nullable load (an entity that may not exist) reads as `T | null` — `null` on a negative hit. */
  readThrough<T>(options: ReadThroughOptions<T>): Promise<T | null>;
  async readThrough<T>(options: ReadThroughOptions<T>): Promise<T | null> {
    assertTtlSeconds(options.ttlSeconds, 'ttlSeconds');
    assertTtlSeconds(options.negativeTtlSeconds, 'negativeTtlSeconds');

    const { key, load, traceId } = options;

    if (!options.noCache) {
      const cached = await this.cache.get<unknown>(key);
      if (cached !== null) {
        const negative = cached === NEGATIVE_CACHE_SENTINEL;
        // One decision line per read, at debug: enough to follow a request's cache behaviour,
        // quiet enough to leave on in production.
        this.logger.debug(JSON.stringify({ cache: negative ? 'negative-hit' : 'hit', key }), CONTEXT, traceId);
        return negative ? null : (cached as T);
      }
      this.logger.debug(JSON.stringify({ cache: 'miss', key }), CONTEXT, traceId);
    } else {
      this.logger.debug(JSON.stringify({ cache: 'bypass', key }), CONTEXT, traceId);
    }

    const existing = this.inflight.get(key);
    if (existing) {
      this.logger.debug(JSON.stringify({ cache: 'joined', key }), CONTEXT, traceId);
      return existing as Promise<T | null>;
    }

    const flight = this.loadAndStore(options).finally(() => this.inflight.delete(key));
    this.inflight.set(key, flight);
    return flight;
  }

  private async loadAndStore<T>(options: ReadThroughOptions<T>): Promise<T | null> {
    const { key, load, traceId } = options;

    const value = await load();
    if (value === null || value === undefined) {
      await this.cache.set(key, NEGATIVE_CACHE_SENTINEL, options.negativeTtlSeconds ?? this.options.negativeTtlSeconds);
      this.logger.debug(JSON.stringify({ cache: 'negative-filled', key }), CONTEXT, traceId);
      return null;
    }

    await this.cache.set(key, value, options.ttlSeconds ?? this.options.ttlSeconds);
    return value;
  }
}
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import { CACHE_LOGGER } from './constants';
import { CacheUnavailableError } from './errors';
import { maskUrl } from './mask-url';
import { MemoryCacheStore } from './memory-cache.store';
import { RedisCacheStore } from './redis-cache.store';
import { assertTtlSeconds } from './validate';
import { CacheOptions, CacheStats } from './types';

import type { ICacheStore } from './types';
import type { ITraceLogger } from '@tw/logger';

const CONTEXT = 'CacheService';

/**
 * The one cache client a process talks to. Owners write and invalidate through it, consumers read
 * through it, background workers use its sets and locks — one client, one set of failure rules.
 *
 * Those rules are the heart of the design, and they differ per operation because the operations
 * differ in what a silent failure would lose:
 *
 * | Operation | Server unreachable | Why |
 * |---|---|---|
 * | `get` | `null` — indistinguishable from a miss | The source of truth still answers; the request survives. |
 * | `set` / `del` / `delMany` | dropped | A cache write is an optimisation, never a commitment. |
 * | `addToSet` | **throws** | Set adds are queue writes — acknowledging an unstored item loses work. |
 * | `acquireLock` | `false` | Without the server there is no way to know the lock is free; "not acquired" is the only safe answer. |
 *
 * In one sentence: **the cache fails open when the cache is broken, and loud when the caller is
 * wrong** — invalid arguments throw; infrastructure failures never take a request down with them.
 *
 * All of this is observable: `isDisabled` and `stats` go on the health endpoint, so "is this
 * service actually caching?" is a GET away rather than a log-archaeology exercise.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly store: ICacheStore;
  private readonly storeKind: 'redis' | 'memory';
  private readonly closable: { close(): Promise<void> } | null;
  private unreachable = false;
  private hits = 0;
  private misses = 0;
  private skipped = 0;

  constructor(
    @Inject(CacheOptions) private readonly options: CacheOptions,
    @Inject(CACHE_LOGGER) private readonly logger: ITraceLogger,
  ) {
    if (options.url) {
      this.storeKind = 'redis';
      const store = new RedisCacheStore(options.url, {
        onUp: () => this.onConnectionUp(),
        onDown: (message) => this.onConnectionDown(message),
      });
      this.store = store;
      this.closable = store;
      // Unreachable until the first `ready`: commands reject while the connection is still being
      // established, so the policy has to hold from the first microsecond of the process's life.
      this.unreachable = true;
      this.logger.info(
        `Cache client connecting to ${maskUrl(options.url)} — until it connects, reads fail open and queue writes fail closed.`,
        CONTEXT,
      );
    } else {
      this.storeKind = 'memory';
      this.store = new MemoryCacheStore();
      this.closable = null;
      this.logger.warn(
        'Cache running against an IN-PROCESS store: no URL configured, so entries are NOT shared with any ' +
          'other service. Same API, same semantics, none of the sharing — fine locally, a misconfiguration in a ' +
          'cluster. Point CACHE_URL at the shared cache server to run against it.',
        CONTEXT,
      );
    }
  }

  /** True while the server cannot be reached (or has not been reached yet). */
  get isDisabled(): boolean {
    return this.unreachable;
  }

  /** The state to put on the health endpoint. */
  get stats(): CacheStats {
    return {
      store: this.storeKind,
      disabled: this.unreachable,
      hits: this.hits,
      misses: this.misses,
      skipped: this.skipped,
    };
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.unreachable) {
      this.skipped++;
      return null;
    }
    try {
      const value = await this.store.get<T>(key);
      if (value === null) this.misses++;
      else this.hits++;
      return value;
    } catch (error) {
      // Between the check above and this command the connection can drop; either way the caller
      // cannot tell a broken cache from an empty one, which is the point.
      this.skipped++;
      this.logger.warn(`Cache get for ${key} failed, failing open: ${(error as Error).message}`, CONTEXT);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.options.ttlSeconds;
    assertTtlSeconds(ttl, 'ttlSeconds');

    if (this.unreachable) return;
    try {
      await this.store.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(`Cache set for ${key} failed, dropping the write: ${(error as Error).message}`, CONTEXT);
    }
  }

  /**
   * Deletes one key and returns how many entries were actually removed.
   *
   * The count is not decoration. The owner of an entity should log it, because a `del` that
   * removed nothing is the visible symptom of the worst cache bug there is: an invalidation built
   * with a different key than the read it is meant to kill. Such a bug caches correctly forever
   * and serves stale data forever, and this return value is the only thing in the system that
   * notices.
   */
  async del(key: string): Promise<number> {
    if (this.unreachable) return 0;
    try {
      return await this.store.del(key);
    } catch (error) {
      this.logger.warn(`Cache del for ${key} failed, dropping the invalidation: ${(error as Error).message}`, CONTEXT);
      return 0;
    }
  }

  /** Deletes many keys in one round trip, returning the number removed. Empty input → 0. */
  async delMany(keys: string[]): Promise<number> {
    if (this.unreachable) return 0;
    try {
      return await this.store.delMany(keys);
    } catch (error) {
      this.logger.warn(`Cache delMany failed, dropping the invalidation: ${(error as Error).message}`, CONTEXT);
      return 0;
    }
  }

  /**
   * Adds members to a set — the work queue of this design. Returns how many were new; a member
   * already present is not added again, which is the dedup that makes re-submitted work cheap.
   *
   * **Fails closed.** This is the one cache write whose silent loss is not an optimisation
   * forgone but work lost — the caller reports an accepted job that no worker will ever see.
   */
  async addToSet(key: string, members: string | string[]): Promise<number> {
    const items = Array.isArray(members) ? members : [members];
    if (this.unreachable) {
      throw new CacheUnavailableError(
        `Cache unreachable, refusing to add ${items.length} item(s) to ${key}: a set add is a work-queue write, ` +
          'and reporting it accepted would lose the work.',
      );
    }
    try {
      return await this.store.addToSet(key, items);
    } catch (error) {
      throw new CacheUnavailableError(
        `Adding ${items.length} item(s) to ${key} failed (${(error as Error).message}) — refusing to report ` +
          'queue work as accepted when it was not stored.',
      );
    }
  }

  /**
   * Removes and returns up to `count` members from a set — the drain half of the work queue.
   * Removal is atomic per call, so two workers popping the same set never receive the same item.
   */
  async popFromSet(key: string, count: number): Promise<string[]> {
    if (this.unreachable) return [];
    try {
      return await this.store.popFromSet(key, count);
    } catch (error) {
      this.logger.warn(`Cache popFromSet for ${key} failed, treating it as empty: ${(error as Error).message}`, CONTEXT);
      return [];
    }
  }

  async getSizeOfSet(key: string): Promise<number> {
    if (this.unreachable) return 0;
    try {
      return await this.store.getSizeOfSet(key);
    } catch (error) {
      this.logger.warn(`Cache getSizeOfSet for ${key} failed, reporting zero: ${(error as Error).message}`, CONTEXT);
      return 0;
    }
  }

  /**
   * Takes a lock for `ttlSeconds` — `SET NX EX`, atomically at the server.
   *
   * **Fails closed.** A lock exists to make "only one of us" true; with the server unreachable
   * there is no "us" to consult, and answering `true` is how two replicas both decide they are
   * the one. Callers that get `false` skip the work, and the work's trigger remains queued or
   * retried — the system does less, never the same thing twice.
   *
   * There is no release: the TTL is the release. A holder that crashes holds the lock for at
   * most `ttlSeconds`, which bounds the critical section to something the caller can reason
   * about — a released-by-hand lock needs the token check to be safe, and is two more moving
   * parts for the zero crashes this actually prevents.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    assertTtlSeconds(ttlSeconds, 'ttlSeconds');

    if (this.unreachable) return false;
    try {
      return await this.store.acquireLock(key, ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache acquireLock for ${key} failed, reporting not acquired: ${(error as Error).message}`, CONTEXT);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closable?.close();
  }

  private onConnectionUp(): void {
    if (!this.unreachable) return;
    this.unreachable = false;
    this.logger.info('Cache connection established — reads and writes are active again.', CONTEXT);
  }

  private onConnectionDown(message: string): void {
    // Warn on the transition, debug on the noise: a retrying client emits an error per attempt,
    // and a cache pod restarting would otherwise page someone with fifty identical lines.
    if (!this.unreachable) {
      this.unreachable = true;
      this.logger.warn(
        `Cache unreachable (${message}). Reads fail open as misses, cache writes are dropped, queue writes are ` +
          'refused, locks report not acquired — visible on the health endpoint as cache.disabled.',
        CONTEXT,
      );
      return;
    }
    this.logger.debug(`Cache still unreachable: ${message}`, CONTEXT);
  }
}
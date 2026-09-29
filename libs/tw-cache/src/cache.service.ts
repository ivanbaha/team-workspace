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
 * The rejection ioredis gives a command that outlived `commandTimeout`. The client exports no
 * typed error for it, so the message is the contract — pinned here, and in the tests.
 */
const COMMAND_TIMEOUT_MESSAGE = 'Command timed out';

/**
 * Timeouts in a row before the connection is treated as dead. One slow command is noise; three
 * with nothing succeeding in between is a server that stopped answering on a socket that still
 * looks open — and until something closes it, every request would pay the full timeout.
 */
const TIMEOUTS_BEFORE_RECONNECT = 3;

/**
 * The one cache client a process talks to. Owners write and invalidate through it, consumers read
 * through it, background workers use its sets and locks — one client, one set of failure rules.
 *
 * Those rules are the heart of the design, and they differ per operation because the operations
 * differ in what a silent failure would lose:
 *
 * | Operation | Server unreachable (or not answering in time) | Why |
 * |---|---|---|
 * | `get` | `null` — indistinguishable from a miss | The source of truth still answers; the request survives. |
 * | `set` / `del` / `delMany` | dropped | A cache write is an optimisation, never a commitment. |
 * | `addToSet` | **throws** | Set adds are queue writes — acknowledging an unstored item loses work. |
 * | `acquireLock` | `false` | Without the server there is no way to know the lock is free; "not acquired" is the only safe answer. |
 *
 * In one sentence: **the cache fails open when the cache is broken, and loud when the caller is
 * wrong** — invalid arguments throw; infrastructure failures never take a request down with them.
 * "Broken" includes slow: every command has a deadline (`commandTimeoutMs`), and a server that
 * lets several in a row expire is treated as unreachable until a fresh connection says otherwise.
 *
 * All of this is observable: `isDisabled` and `stats` go on the health endpoint, so "is this
 * service actually caching?" is a GET away rather than a log-archaeology exercise.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly store: ICacheStore;
  private readonly storeKind: 'redis' | 'memory';
  private readonly connection: { close(): Promise<void>; reconnect(): void } | null;
  private unreachable = false;
  private closing = false;
  private consecutiveTimeouts = 0;
  private hits = 0;
  private misses = 0;
  private skipped = 0;

  constructor(
    @Inject(CacheOptions) private readonly options: CacheOptions,
    @Inject(CACHE_LOGGER) private readonly logger: ITraceLogger,
  ) {
    if (options.url) {
      this.storeKind = 'redis';
      const store = new RedisCacheStore(options.url, options.commandTimeoutMs, {
        onUp: () => this.onConnectionUp(),
        onDown: (message) => this.onConnectionDown(message),
      });
      this.store = store;
      this.connection = store;
      // Unreachable until the first `ready`: commands reject while the connection is still being
      // established, so the policy has to hold from the first microsecond of the process's life.
      // Code that runs at boot sees this too — a startup check against the server reads it as
      // empty, which is why background work is reconciled on an interval, not once at startup.
      this.unreachable = true;
      this.logger.info(
        `Cache client connecting to ${maskUrl(options.url)} — until it connects, reads fail open and queue writes fail closed.`,
        CONTEXT,
      );
    } else {
      this.storeKind = 'memory';
      this.store = new MemoryCacheStore();
      this.connection = null;
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
      const value = await this.run(() => this.store.get<T>(key));
      if (value === null) this.misses++;
      else this.hits++;
      return value;
    } catch (error) {
      // Between the check above and this command the connection can drop, or the server can stop
      // answering; either way the caller cannot tell a broken cache from an empty one, which is
      // the point.
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
      await this.run(() => this.store.set(key, value, ttl));
    } catch (error) {
      this.logger.warn(`Cache set for ${key} failed, dropping the write: ${(error as Error).message}`, CONTEXT);
    }
  }

  /**
   * Deletes one key and returns how many entries were actually removed.
   *
   * The count is a debugging aid, and worth logging at the call site: after a read that filled
   * the key, a `del` that removed nothing means the invalidation was built with a different key
   * than the read — the one cache bug that caches correctly and serves stale data until the TTL.
   * On its own, though, `0` is also what an uncached key gives, and what a dropped invalidation
   * gives while the server is unreachable — the debug line below is what tells that case apart.
   */
  async del(key: string): Promise<number> {
    if (this.unreachable) {
      this.logger.debug(`Cache unreachable — invalidation of ${key} dropped`, CONTEXT);
      return 0;
    }
    try {
      return await this.run(() => this.store.del(key));
    } catch (error) {
      this.logger.warn(`Cache del for ${key} failed, dropping the invalidation: ${(error as Error).message}`, CONTEXT);
      return 0;
    }
  }

  /** Deletes many keys in one round trip, returning the number removed. Empty input → 0. */
  async delMany(keys: string[]): Promise<number> {
    if (this.unreachable) {
      this.logger.debug(`Cache unreachable — invalidation of ${keys.length} key(s) dropped`, CONTEXT);
      return 0;
    }
    try {
      return await this.run(() => this.store.delMany(keys));
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
   * forgone but work lost — the caller reports an accepted job that no worker will ever see. When
   * the command itself fails or times out, the add may or may not have reached the server; the
   * caller is told it did not, and a retry is safe because a set add is idempotent.
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
      return await this.run(() => this.store.addToSet(key, items));
    } catch (error) {
      throw new CacheUnavailableError(
        `Adding ${items.length} item(s) to ${key} was not confirmed (${(error as Error).message}) — refusing to ` +
          'report queue work as accepted when it may not have been stored.',
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
      return await this.run(() => this.store.popFromSet(key, count));
    } catch (error) {
      this.logger.warn(`Cache popFromSet for ${key} failed, treating it as empty: ${(error as Error).message}`, CONTEXT);
      return [];
    }
  }

  async getSizeOfSet(key: string): Promise<number> {
    if (this.unreachable) return 0;
    try {
      return await this.run(() => this.store.getSizeOfSet(key));
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
   * There is no token-checked release: the TTL is the release. A holder that crashes holds the
   * lock for at most `ttlSeconds`, which bounds the critical section to something the caller can
   * reason about. A caller that finishes early may `del` the key — an ownership-blind release, which
   * is only safe where a second holder costs work, not correctness.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    assertTtlSeconds(ttlSeconds, 'ttlSeconds');

    if (this.unreachable) return false;
    try {
      return await this.run(() => this.store.acquireLock(key, ttlSeconds));
    } catch (error) {
      this.logger.warn(`Cache acquireLock for ${key} failed, reporting not acquired: ${(error as Error).message}`, CONTEXT);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // A shutdown closes the connection on purpose; the close events it triggers are not an outage.
    this.closing = true;
    await this.connection?.close();
  }

  /** Runs one store command, keeping count of the timeouts that say the server went silent. */
  private async run<T>(command: () => Promise<T>): Promise<T> {
    try {
      const result = await command();
      this.consecutiveTimeouts = 0;
      return result;
    } catch (error) {
      if ((error as Error)?.message === COMMAND_TIMEOUT_MESSAGE) this.onCommandTimeout();
      throw error;
    }
  }

  private onCommandTimeout(): void {
    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts < TIMEOUTS_BEFORE_RECONNECT || this.unreachable) return;

    // No connection event will ever arrive for a socket that is open but silent, so the service
    // declares the outage itself — every command from here fails open instantly instead of
    // waiting out its own timeout — and forces a fresh connection, whose `ready` ends the outage.
    this.unreachable = true;
    this.logger.warn(
      `Cache commands timed out ${this.consecutiveTimeouts} times in a row (${this.options.commandTimeoutMs} ms each) — ` +
        'treating the server as unreachable and reconnecting. Reads fail open as misses, cache writes are dropped, ' +
        'queue writes are refused, locks report not acquired — visible on the health endpoint as cache.disabled.',
      CONTEXT,
    );
    this.connection?.reconnect();
  }

  private onConnectionUp(): void {
    this.consecutiveTimeouts = 0;
    if (!this.unreachable) return;
    this.unreachable = false;
    this.logger.info('Cache connection established — reads and writes are active again.', CONTEXT);
  }

  private onConnectionDown(message: string): void {
    if (this.closing) {
      this.unreachable = true;
      return;
    }
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

import { CacheUnavailableError } from '../errors';
import { assertTtlSeconds } from '../validate';

import type { CacheStats } from '../types';

/**
 * A stateful stand-in for `CacheService`, for tests of code that *uses* the cache.
 *
 * Not a `jest.fn()` bag, and that is its whole value: it runs the real logic — JSON round trip,
 * TTL expiry, SETNX lock semantics, the outage policy — against an in-process store, so a test
 * that writes through the owner's path can produce a genuine hit in the consumer's path, and a
 * test that asserts "the second request does not hit the source" is asserting something this
 * fake can actually falsify. A mock that always returns `null` passes that test by construction
 * and proves nothing.
 *
 * This file is an independent reimplementation on purpose: if it shared code with the real
 * service, the parity suite in `cache.fake.spec.ts` would be a tautology. It shares only the
 * argument validation, which is contract, not behaviour.
 */
export class CacheFake {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly locks = new Map<string, number>();
  private readonly defaults: { ttlSeconds: number; negativeTtlSeconds: number };
  private unreachable = false;
  private hits = 0;
  private misses = 0;
  private skipped = 0;

  constructor(overrides: { ttlSeconds?: number; negativeTtlSeconds?: number } = {}) {
    this.defaults = { ttlSeconds: overrides.ttlSeconds ?? 60, negativeTtlSeconds: overrides.negativeTtlSeconds ?? 30 };
  }

  get isDisabled(): boolean {
    return this.unreachable;
  }

  get stats(): CacheStats {
    return {
      store: 'memory',
      disabled: this.unreachable,
      hits: this.hits,
      misses: this.misses,
      skipped: this.skipped,
    };
  }

  /** Simulates the server becoming unreachable (or coming back) — every method applies the real outage policy. */
  setUnreachable(unreachable: boolean): this {
    this.unreachable = unreachable;
    return this;
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.unreachable) {
      this.skipped++;
      return null;
    }
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaults.ttlSeconds;
    assertTtlSeconds(ttl, 'ttlSeconds');

    if (this.unreachable) return;
    this.entries.set(key, { value: JSON.parse(JSON.stringify(value)), expiresAt: Date.now() + ttl * 1000 });
  }

  async del(key: string): Promise<number> {
    if (this.unreachable) return 0;
    // A key is a key, whatever structure holds it — matching the server's type-agnostic DEL.
    const hadSet = this.sets.delete(key);
    const hadLock = this.locks.delete(key);
    const entry = this.entries.get(key);
    this.entries.delete(key);
    const hadLiveEntry = entry !== undefined && entry.expiresAt > Date.now();

    return hadLiveEntry || hadSet || hadLock ? 1 : 0;
  }

  async delMany(keys: string[]): Promise<number> {
    if (this.unreachable) return 0;
    let removed = 0;
    for (const key of keys) removed += await this.del(key);
    return removed;
  }

  async addToSet(key: string, members: string | string[]): Promise<number> {
    const items = Array.isArray(members) ? members : [members];
    if (this.unreachable) {
      throw new CacheUnavailableError(
        `Cache unreachable, refusing to add ${items.length} item(s) to ${key}: a set add is a work-queue write, ` +
          'and reporting it accepted would lose the work.',
      );
    }
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of items) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  async popFromSet(key: string, count: number): Promise<string[]> {
    if (this.unreachable || count < 1) return [];
    const set = this.sets.get(key);
    if (!set) return [];

    const popped: string[] = [];
    while (popped.length < count && set.size > 0) {
      const member = set.values().next().value as string;
      set.delete(member);
      popped.push(member);
    }
    return popped;
  }

  async getSizeOfSet(key: string): Promise<number> {
    if (this.unreachable) return 0;
    return this.sets.get(key)?.size ?? 0;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    assertTtlSeconds(ttlSeconds, 'ttlSeconds');

    if (this.unreachable) return false;
    const now = Date.now();
    const heldUntil = this.locks.get(key);
    if (heldUntil !== undefined && heldUntil > now) return false;
    this.locks.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
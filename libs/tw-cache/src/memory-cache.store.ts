import type { ICacheStore } from './types';

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * The no-server store: the semantics of the real one, none of the sharing.
 *
 * Used when no `url` is configured — local development, mostly — and it is the reason that mode
 * is safe to leave as a default: it is not a stub that pretends, it is the same behaviour with a
 * different address space. That includes the JSON round trip below, which both stores perform so
 * a Date is an ISO string in either — code tested against this store does not meet new
 * serialisation rules the day it is pointed at a server.
 */
export class MemoryCacheStore implements ICacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly locks = new Map<string, number>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      // Round-trip on write, so this store answers with exactly the shape the server-backed one
      // would: a Date goes in, an ISO string is what a reader gets, in both stores alike.
      value: JSON.parse(JSON.stringify(value)),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<number> {
    // A key is a key, whatever structure holds it — the server's DEL does not ask whether the
    // value is a string or a set, and a store that answered differently would pass every test
    // until the first owner deleted a queue key.
    const hadSet = this.sets.delete(key);
    const hadLock = this.locks.delete(key);

    const entry = this.entries.get(key);
    this.entries.delete(key);
    // An entry that has logically expired is not "removed" by this call — the server would say
    // the key no longer existed — and the count is what tells an owner whether its invalidation
    // ever pointed at a live entry.
    const hadLiveEntry = entry !== undefined && entry.expiresAt > Date.now();

    return hadLiveEntry || hadSet || hadLock ? 1 : 0;
  }

  async delMany(keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) removed += await this.del(key);
    return removed;
  }

  async addToSet(key: string, members: string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  async popFromSet(key: string, count: number): Promise<string[]> {
    if (count < 1) return [];
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
    return this.sets.get(key)?.size ?? 0;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const heldUntil = this.locks.get(key);
    // Held means "held and not expired" — an expired lock is a free lock, exactly as the server
    // would have already collected the key.
    if (heldUntil !== undefined && heldUntil > now) return false;
    this.locks.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
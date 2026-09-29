import { NEGATIVE_CACHE_SENTINEL } from '../constants';
import { CacheUnavailableError } from '../errors';
import { CacheService } from '../cache.service';
import { CacheOptions } from '../types';
import { CacheFake } from './cache.fake';

import type { ITraceLogger } from '@tw/logger';

function makeLogger(): ITraceLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  };
}

/**
 * The behavioural contract of a cache implementation, run against both the real `CacheService`
 * (over the in-process store) and the `CacheFake`.
 *
 * The fake exists so tests of code that *uses* the cache can assert real behaviour — hits,
 * expiry, negative entries — rather than whatever a `jest.fn()` was told to say. That only holds
 * while the fake behaves exactly like the service, and the only way to keep that true as either
 * changes is to run one suite against both. A case added here is a case the fake cannot silently
 * drift on.
 */
type CacheSurface = Pick<
  CacheService,
  'get' | 'set' | 'del' | 'delMany' | 'addToSet' | 'popFromSet' | 'getSizeOfSet' | 'acquireLock' | 'isDisabled' | 'stats'
>;

const implementations: { name: string; make: () => CacheSurface }[] = [
  {
    name: 'CacheService over the in-process store',
    make: () => new CacheService(new CacheOptions(), makeLogger()),
  },
  { name: 'CacheFake', make: () => new CacheFake() },
];

describe('shared cache behaviour', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  implementations.forEach(({ name, make }) => {
    describe(name, () => {
      let cache: CacheSurface;

      beforeEach(() => {
        cache = make();
      });

      describe('entries', () => {
        it('answers a get that follows a set', async () => {
          await cache.set('users-service_user_1', { id: '1' });

          expect(await cache.get<{ id: string }>('users-service_user_1')).toEqual({ id: '1' });
        });

        it('JSON round-trips on write, so a Date comes back an ISO string like the server would send', async () => {
          await cache.set('k', { createdAt: new Date('2026-01-01T00:00:00.000Z'), count: 2 });

          expect(await cache.get<{ createdAt: string; count: number }>('k')).toEqual({
            createdAt: '2026-01-01T00:00:00.000Z',
            count: 2,
          });
        });

        it('hands every reader its own copy, like a server that parses per GET', async () => {
          await cache.set('k', { tags: ['a'] });

          const first = await cache.get<{ tags: string[] }>('k');
          first?.tags.push('changed by a caller');

          expect(await cache.get('k')).toEqual({ tags: ['a'] });
        });

        it('round-trips the negative sentinel as a plain readable value, which is how negative caching stores it', async () => {
          await cache.set('k', NEGATIVE_CACHE_SENTINEL);

          expect(await cache.get('k')).toBe(NEGATIVE_CACHE_SENTINEL);
        });

        it('counts hits and misses', async () => {
          await cache.set('k', 1);
          await cache.get('k');
          await cache.get('absent');

          const stats = cache.stats;
          expect(stats.hits).toBe(1);
          expect(stats.misses).toBe(1);
          expect(stats.store).toBe('memory');
          expect(stats.disabled).toBe(false);
        });
      });

      describe('TTL', () => {
        beforeEach(() => {
          jest.useFakeTimers();
          jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        });

        it('keeps an entry for its TTL and not a millisecond longer', async () => {
          await cache.set('k', 'value', 60);

          jest.setSystemTime(new Date('2026-01-01T00:00:59.999Z'));
          expect(await cache.get('k')).toBe('value');

          jest.setSystemTime(new Date('2026-01-01T00:01:00Z'));
          expect(await cache.get('k')).toBeNull();
        });

        it('expires the entry for the caller, not a default the caller did not ask about', async () => {
          await cache.set('k', 'value', 2);

          jest.setSystemTime(new Date('2026-01-01T00:00:03Z'));
          expect(await cache.get('k')).toBeNull();
        });

        it('reports del as removing nothing once the entry has expired on its own', async () => {
          await cache.set('k', 'value', 5);

          jest.setSystemTime(new Date('2026-01-01T00:00:05Z'));
          expect(await cache.del('k')).toBe(0);
        });
      });

      describe('del and delMany', () => {
        it('del returns the number of live entries it removed', async () => {
          await cache.set('k1', 1);
          await cache.set('k2', 2);

          expect(await cache.del('k1')).toBe(1);
          expect(await cache.del('k1')).toBe(0);
        });

        it('delMany removes them all and counts, in one call from the caller', async () => {
          await cache.set('k1', 1);
          await cache.set('k2', 2);
          await cache.set('k3', 3);

          expect(await cache.delMany(['k1', 'k2', 'k3', 'absent'])).toBe(3);
          expect(await cache.get('k2')).toBeNull();
        });

        it('delMany with nothing to do is a no-op that reports zero', async () => {
          expect(await cache.delMany([])).toBe(0);
        });

        it('del removes a queue key whatever structure holds it — a key is a key', async () => {
          await cache.addToSet('queue', ['a', 'b']);
          await cache.set('queue-entry', 1);

          expect(await cache.del('queue')).toBe(1);
          expect(await cache.getSizeOfSet('queue')).toBe(0);
        });
      });

      describe('sets — the work queue', () => {
        it('adds members, dedupes, and reports how many were new', async () => {
          expect(await cache.addToSet('queue', ['a', 'b'])).toBe(2);
          expect(await cache.addToSet('queue', ['b', 'c'])).toBe(1);
          expect(await cache.getSizeOfSet('queue')).toBe(3);
        });

        it('accepts a single member without an array wrapper', async () => {
          expect(await cache.addToSet('queue', 'a')).toBe(1);
          expect(await cache.getSizeOfSet('queue')).toBe(1);
        });

        it('pops atomically — popped members are gone, and what is left stays queued', async () => {
          await cache.addToSet('queue', ['a', 'b', 'c']);

          const popped = await cache.popFromSet('queue', 2);
          expect(popped).toHaveLength(2);
          expect(await cache.getSizeOfSet('queue')).toBe(1);

          const rest = await cache.popFromSet('queue', 5);
          expect(rest).toHaveLength(1);
          // Every member delivered exactly once across the two pops — the drain contract that
          // makes "pop then process" safe with more than one worker.
          expect([...popped, ...rest].sort()).toEqual(['a', 'b', 'c']);
        });

        it('pops from an absent set as empty rather than failing', async () => {
          expect(await cache.popFromSet('nothing', 10)).toEqual([]);
        });

        it('refuses to pop a non-positive count, which the server would reject too', async () => {
          await cache.addToSet('queue', ['a']);

          expect(await cache.popFromSet('queue', 0)).toEqual([]);
          expect(await cache.getSizeOfSet('queue')).toBe(1);
        });
      });

      describe('locks', () => {
        beforeEach(() => {
          jest.useFakeTimers();
          jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        });

        it('takes a lock once and only once — the second taker is told no', async () => {
          expect(await cache.acquireLock('batch', 5)).toBe(true);
          expect(await cache.acquireLock('batch', 5)).toBe(false);
        });

        it('locks different keys independently', async () => {
          await cache.acquireLock('batch-a', 5);

          expect(await cache.acquireLock('batch-b', 5)).toBe(true);
        });

        it('gives the lock back when its TTL expires — the TTL is the release', async () => {
          await cache.acquireLock('batch', 5);

          jest.setSystemTime(new Date('2026-01-01T00:00:05Z'));
          expect(await cache.acquireLock('batch', 5)).toBe(true);
        });

        it('refuses a lock TTL that is not a positive integer number of seconds', async () => {
          await expect(cache.acquireLock('batch', 0)).rejects.toThrow(/ttlSeconds/);
        });
      });
    });
  });

  describe('CacheFake only: the outage policy', () => {
    // The real service's outage policy is exercised against a mocked server in
    // cache.service.spec.ts; the fake's is asserted here, from the same table, so the two stay
    // aligned without either suite depending on the other's machinery.

    it('fails every operation exactly the way the real service does', async () => {
      const fake = new CacheFake().setUnreachable(true);

      expect(fake.isDisabled).toBe(true);
      expect(await fake.get('k')).toBeNull();
      await expect(fake.addToSet('queue', 'a')).rejects.toThrow(CacheUnavailableError);
      expect(await fake.set('k', 1)).toBeUndefined();
      expect(await fake.del('k')).toBe(0);
      expect(await fake.popFromSet('queue', 10)).toEqual([]);
      expect(await fake.getSizeOfSet('queue')).toBe(0);
      expect(await fake.acquireLock('batch', 5)).toBe(false);

      // The reads a broken cache could not answer are counted apart from hits and misses,
      // so a health check can tell "cold cache" from "dead cache".
      expect(fake.stats.skipped).toBe(1);
    });

    it('comes back when the server does', async () => {
      const fake = new CacheFake().setUnreachable(true);
      await fake.get('k');

      fake.setUnreachable(false);
      await fake.set('k', 1);

      expect(await fake.get('k')).toBe(1);
      expect(fake.stats.disabled).toBe(false);
    });
  });
});
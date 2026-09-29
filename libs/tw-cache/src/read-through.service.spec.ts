import { NEGATIVE_CACHE_SENTINEL } from './constants';
import { CacheService } from './cache.service';
import { CacheConfigurationError } from './errors';
import { ReadThroughService } from './read-through.service';
import { CacheOptions } from './types';

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

function makeCache(): CacheService {
  return new CacheService(new CacheOptions(), makeLogger());
}

function makeReadThrough(cache: CacheService = makeCache()): ReadThroughService {
  return new ReadThroughService(cache, new CacheOptions(), makeLogger());
}

/** The debug lines a request's cache behaviour is reconstructed from. */
const decisions = (logger: ITraceLogger): { cache: string; key: string }[] =>
  (logger.debug as jest.Mock).mock.calls.map(([message]) => JSON.parse(message as string));

describe('ReadThroughService', () => {
  it('serves a cached entry without touching the loader, and says so on the trace', async () => {
    const cache = makeCache();
    await cache.set('users-service_user_1', { id: '1' });
    const load = jest.fn();
    const logger = makeLogger();
    const readThrough = new ReadThroughService(cache, new CacheOptions(), logger);

    await expect(readThrough.readThrough({ key: 'users-service_user_1', load, traceId: 'T1' })).resolves.toEqual({ id: '1' });

    expect(load).not.toHaveBeenCalled();
    expect(decisions(logger)).toContainEqual({ cache: 'hit', key: 'users-service_user_1' });
    // The decision line carries the trace id of the request that caused it, or it decorates nothing.
    expect((logger.debug as jest.Mock).mock.calls[0][2]).toBe('T1');
  });

  it('answers a negative hit as null, without re-asking the source', async () => {
    const cache = makeCache();
    await cache.set('users-service_user_9', NEGATIVE_CACHE_SENTINEL);
    const load = jest.fn();

    await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_9', load })).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('fills a miss: loads, stores for the module TTL, returns the value', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue({ id: '1' });

    await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_1', load })).resolves.toEqual({ id: '1' });

    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get('users-service_user_1')).toEqual({ id: '1' });
  });

  it('caches a null load as a negative entry, so "does not exist" is answered once', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue(null);

    await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_9', load })).resolves.toBeNull();
    await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_9', load })).resolves.toBeNull();

    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get('users-service_user_9')).toBe(NEGATIVE_CACHE_SENTINEL);
  });

  describe('noCache — the bypass is also a repair', () => {
    it('loads despite a cached entry, and overwrites the entry with what comes back', async () => {
      const cache = makeCache();
      await cache.set('users-service_user_1', { id: '1', stale: true });
      const load = jest.fn().mockResolvedValue({ id: '1' });

      await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_1', load, noCache: true })).resolves.toEqual(
        { id: '1' },
      );

      expect(load).toHaveBeenCalledTimes(1);
      expect(await cache.get('users-service_user_1')).toEqual({ id: '1' });
    });

    it('stores the negative entry even on a bypass, or the next reader re-learns the miss', async () => {
      const cache = makeCache();
      const load = jest.fn().mockResolvedValue(null);

      await expect(makeReadThrough(cache).readThrough({ key: 'users-service_user_9', load, noCache: true })).resolves.toBeNull();

      expect(await cache.get('users-service_user_9')).toBe(NEGATIVE_CACHE_SENTINEL);
    });

    it('does not join a load already in flight — that load may have read the source before the write', async () => {
      const cache = makeCache();
      const readThrough = makeReadThrough(cache);
      let source = 'v1';
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const slowLoad = async () => {
        const snapshot = source; // read now, returned later
        await gate;
        return { v: snapshot };
      };

      const before = readThrough.readThrough({ key: 'k', load: slowLoad });
      await new Promise((resolve) => setImmediate(resolve));

      source = 'v2'; // the write the client is about to re-read
      const repair = readThrough.readThrough({ key: 'k', load: async () => ({ v: source }), noCache: true });

      await expect(repair).resolves.toEqual({ v: 'v2' });
      release();
      await expect(before).resolves.toEqual({ v: 'v1' }); // its own callers still get their answer

      // ...but the superseded load does not put the older value back on top of the repair.
      expect(await cache.get('k')).toEqual({ v: 'v2' });
    });

    it('lets later misses join the repair flight, not the one it superseded', async () => {
      const cache = makeCache();
      const readThrough = makeReadThrough(cache);
      const never = new Promise<{ v: string }>(() => undefined);
      let release!: (value: { v: string }) => void;
      const repairLoad = jest.fn(() => new Promise<{ v: string }>((resolve) => (release = resolve)));

      void readThrough.readThrough({ key: 'k', load: () => never });
      await new Promise((resolve) => setImmediate(resolve));
      const repair = readThrough.readThrough({ key: 'k', load: repairLoad, noCache: true });
      const follower = readThrough.readThrough({ key: 'k', load: jest.fn() });
      await new Promise((resolve) => setImmediate(resolve));

      release({ v: 'fresh' });
      await expect(Promise.all([repair, follower])).resolves.toEqual([{ v: 'fresh' }, { v: 'fresh' }]);
      expect(repairLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe('single-flight', () => {
    it('collapses concurrent misses for one key into a single load', async () => {
      const cache = makeCache();
      const readThrough = makeReadThrough(cache);
      let resolveLoad!: (value: { id: string }) => void;
      const pending = new Promise<{ id: string }>((resolve) => {
        resolveLoad = resolve;
      });
      const load = jest.fn(() => pending);

      const first = readThrough.readThrough({ key: 'users-service_user_1', load });
      const second = readThrough.readThrough({ key: 'users-service_user_1', load });

      resolveLoad({ id: '1' });
      const [a, b] = await Promise.all([first, second]);

      // A cache stampede is N requests all deciding they are the one who must fetch. The
      // in-flight map is the only thing standing between a cold key and N identical loads.
      expect(load).toHaveBeenCalledTimes(1);
      expect(a).toEqual({ id: '1' });
      expect(b).toEqual({ id: '1' });
    });

    it('starts a new flight once the previous one has landed', async () => {
      const cache = makeCache();
      const readThrough = makeReadThrough(cache);
      const load = jest.fn().mockResolvedValue({ id: '1' });

      await readThrough.readThrough({ key: 'k', load });
      // The entry is filled now; deleting it makes the next read a miss again — which pins the
      // cleanup the next miss depends on: the map must not leak the settled flight.
      await cache.del('k');
      await readThrough.readThrough({ key: 'k', load });

      expect(load).toHaveBeenCalledTimes(2);
    });

    it('does not join flights for different keys — unrelated work does not serialize', async () => {
      const cache = makeCache();
      const load = jest.fn().mockResolvedValue({ id: '1' });

      await Promise.all([
        makeReadThrough(cache).readThrough({ key: 'users-service_user_1', load }),
        makeReadThrough(cache).readThrough({ key: 'users-service_user_2', load }),
      ]);

      expect(load).toHaveBeenCalledTimes(2);
    });

    it('cleans up after a failed load, so one broken fetch cannot poison the key', async () => {
      const cache = makeCache();
      const readThrough = makeReadThrough(cache);
      const boom = jest.fn().mockRejectedValue(new Error('source down'));
      const load = jest.fn().mockResolvedValue({ id: '1' });

      await expect(readThrough.readThrough({ key: 'k', load: boom })).rejects.toThrow(/source down/);
      await expect(readThrough.readThrough({ key: 'k', load })).resolves.toEqual({ id: '1' });

      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTLs', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('uses the per-key TTL when one is given', async () => {
      const cache = makeCache();
      const load = jest.fn().mockResolvedValue({ id: '1' });

      await makeReadThrough(cache).readThrough({ key: 'k', load, ttlSeconds: 10 });

      jest.setSystemTime(new Date('2026-01-01T00:00:09.999Z'));
      expect(await cache.get('k')).toEqual({ id: '1' });

      jest.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      expect(await cache.get('k')).toBeNull();
    });

    it('gives a negative entry its own, shorter life', async () => {
      const cache = makeCache();
      const load = jest.fn().mockResolvedValue(null);

      await makeReadThrough(cache).readThrough({ key: 'k', load, negativeTtlSeconds: 5 });

      jest.setSystemTime(new Date('2026-01-01T00:00:05Z'));
      expect(await cache.get('k')).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses a per-call TTL that is not a positive integer number of seconds', async () => {
    const cache = makeCache();
    const load = jest.fn();

    await expect(makeReadThrough(cache).readThrough({ key: 'k', load, ttlSeconds: 0 })).rejects.toThrow(
      CacheConfigurationError,
    );
    expect(load).not.toHaveBeenCalled();
  });
});
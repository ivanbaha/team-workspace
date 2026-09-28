jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

import Redis from 'ioredis';
import { CacheService } from './cache.service';
import { CacheUnavailableError } from './errors';
import { maskUrl } from './mask-url';
import { CacheOptions } from './types';

import type { ITraceLogger } from '@tw/logger';

const RedisMock = Redis as unknown as jest.Mock;

interface FakeClient {
  on: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  unlink: jest.Mock;
  sadd: jest.Mock;
  spop: jest.Mock;
  scard: jest.Mock;
  quit: jest.Mock;
}

let client: FakeClient;

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

function makeOptions(overrides: Partial<CacheOptions> = {}): CacheOptions {
  return Object.assign(new CacheOptions(), overrides);
}

const CACHE_URL = 'redis://users-service:secret@cache:6379';

/** Fires an event the way the real client would have. */
const emit = (event: string, payload?: Error): void =>
  (Object.fromEntries(client.on.mock.calls) as Record<string, (payload?: Error) => void>)[event](payload);

beforeEach(() => {
  client = {
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    unlink: jest.fn(),
    sadd: jest.fn(),
    spop: jest.fn(),
    scard: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  RedisMock.mockImplementation(() => client);
});

describe('CacheService with no URL — the in-process store', () => {
  it('says loudly that nothing is shared, because that is the mode people misread', () => {
    const logger = makeLogger();
    new CacheService(makeOptions(), logger);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/IN-PROCESS store/), 'CacheService');
  });

  it('reports the in-process store on the health endpoint, not as a disability', () => {
    const cache = new CacheService(makeOptions(), makeLogger());

    expect(cache.isDisabled).toBe(false);
    expect(cache.stats).toMatchObject({ store: 'memory', disabled: false });
  });
});

describe('CacheService with a URL — the shared server', () => {
  it('connects without an offline queue, so commands cannot pile up against a dead connection', () => {
    new CacheService(makeOptions({ url: CACHE_URL }), makeLogger());

    expect(RedisMock).toHaveBeenCalledWith(CACHE_URL, { enableOfflineQueue: false });
  });

  it('names the server in its boot line without naming the credential', () => {
    const logger = makeLogger();
    new CacheService(makeOptions({ url: CACHE_URL }), logger);

    const message = (logger.info as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain(maskUrl(CACHE_URL));
    expect(message).not.toContain('secret');
  });

  it('wires availability to the connection events, not to per-command errors', async () => {
    const cache = new CacheService(makeOptions({ url: CACHE_URL }), makeLogger());

    emit('ready');
    expect(cache.isDisabled).toBe(false);

    emit('error', new Error('ECONNREFUSED'));
    expect(cache.isDisabled).toBe(true);
  });

  describe('before the first connection — the policy holds from microsecond one', () => {
    let cache: CacheService;
    let logger: ITraceLogger;

    beforeEach(() => {
      logger = makeLogger();
      cache = new CacheService(makeOptions({ url: CACHE_URL }), logger);
    });

    it('a read fails open as a miss, and is counted apart from misses', async () => {
      expect(await cache.get('k')).toBeNull();
      expect(cache.stats).toMatchObject({ disabled: true, hits: 0, misses: 0, skipped: 1 });
    });

    it('cache writes are dropped without a sound from the caller’s point of view', async () => {
      await cache.set('k', 'value');
      await cache.del('k');
      await cache.delMany(['k']);

      expect(client.set).not.toHaveBeenCalled();
      expect(client.del).not.toHaveBeenCalled();
      expect(client.unlink).not.toHaveBeenCalled();
    });

    it('a queue write throws instead of acknowledging work it did not store', async () => {
      await expect(cache.addToSet('queue', 'a')).rejects.toThrow(CacheUnavailableError);
      expect(client.sadd).not.toHaveBeenCalled();
    });

    it('a lock reports not acquired — without the server, "is it free" cannot be answered', async () => {
      expect(await cache.acquireLock('batch', 5)).toBe(false);
      expect(client.set).not.toHaveBeenCalled();
    });

    it('queue reads fail open as empty, since no batch can run anyway without the lock', async () => {
      expect(await cache.popFromSet('queue', 10)).toEqual([]);
      expect(await cache.getSizeOfSet('queue')).toBe(0);
    });
  });

  describe('after the connection is established', () => {
    let cache: CacheService;
    let logger: ITraceLogger;

    beforeEach(() => {
      logger = makeLogger();
      cache = new CacheService(makeOptions({ url: CACHE_URL }), logger);
      emit('ready');
    });

    it('reads parse what the store returns and count the answer', async () => {
      client.get.mockResolvedValue('{"id":"1"}');

      expect(await cache.get<{ id: string }>('users-service_user_1')).toEqual({ id: '1' });
      expect(client.get).toHaveBeenCalledWith('users-service_user_1');
      expect(cache.stats).toMatchObject({ hits: 1, misses: 0 });
    });

    it('a missing key is a miss, not an outage', async () => {
      client.get.mockResolvedValue(null);

      expect(await cache.get('absent')).toBeNull();
      expect(cache.stats).toMatchObject({ hits: 0, misses: 1, skipped: 0 });
    });

    it('writes go out with the module TTL in the store’s single unit, seconds', async () => {
      await cache.set('k', { a: 1 }, 30);

      expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 30);
    });

    it('writes without an explicit TTL use the module default', async () => {
      await cache.set('k', 'value');

      expect(client.set).toHaveBeenCalledWith('k', '"value"', 'EX', 60);
    });

    it('refuses a per-call TTL of zero — a caller bug fails loud, not open', async () => {
      await expect(cache.set('k', 'value', 0)).rejects.toThrow(/ttlSeconds/);
      expect(client.set).not.toHaveBeenCalled();
    });

    it('deletes return the store’s count of what was actually removed', async () => {
      client.del.mockResolvedValue(1);
      client.unlink.mockResolvedValue(1);

      expect(await cache.del('k')).toBe(1);
      expect(await cache.delMany(['k1', 'k2'])).toBe(1);
      expect(client.del).toHaveBeenLastCalledWith('k');
      expect(client.unlink).toHaveBeenCalledWith('k1', 'k2');
    });

    it('a command that fails while connected is logged, failed open, and counted as skipped', async () => {
      client.get.mockRejectedValue(new Error('WRONGTYPE'));

      expect(await cache.get('k')).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/failing open.*WRONGTYPE/), 'CacheService');
      expect(cache.stats.skipped).toBe(1);
    });
  });

  describe('the outage and the recovery, as the logs tell them', () => {
    it('warns once when the connection drops, and debugs the retries after it', () => {
      const logger = makeLogger();
      const cache = new CacheService(makeOptions({ url: CACHE_URL }), logger);

      emit('ready');
      emit('error', new Error('ECONNREFUSED'));
      emit('error', new Error('Connection is closed.'));
      emit('error', new Error('Connection is closed.'));

      const warnings = (logger.warn as jest.Mock).mock.calls.filter(([message]) => /unreachable/.test(message));
      expect(warnings).toHaveLength(1);
      expect((logger.debug as jest.Mock).mock.calls.filter(([message]) => /still unreachable/.test(message))).toHaveLength(2);
      expect(cache.isDisabled).toBe(true);
    });

    it('announces the recovery', () => {
      const logger = makeLogger();
      const cache = new CacheService(makeOptions({ url: CACHE_URL }), logger);

      emit('ready');
      emit('error', new Error('ECONNREFUSED'));
      emit('ready');

      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/established/), 'CacheService');
      expect(cache.isDisabled).toBe(false);
    });

    it('a closed connection is an outage, not a state nobody observes', () => {
      const logger = makeLogger();
      const cache = new CacheService(makeOptions({ url: CACHE_URL }), logger);

      emit('ready');
      emit('end');

      expect(cache.isDisabled).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/connection closed/), 'CacheService');
    });
  });

  it('closes the client on shutdown', async () => {
    const cache = new CacheService(makeOptions({ url: CACHE_URL }), makeLogger());

    await cache.onModuleDestroy();

    expect(client.quit).toHaveBeenCalled();
  });
});
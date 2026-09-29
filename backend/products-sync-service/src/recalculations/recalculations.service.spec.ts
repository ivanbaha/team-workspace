import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CacheService } from '@tw/cache';
import { LOCK_KEY, QUEUE_KEY } from './cache-keys';
import { RequestRecalculationDto } from './dto/request-recalculation.dto';
import { QueueFullError, RecalculationsService } from './recalculations.service';

import type { CacheOptions } from '@tw/cache';
import type { HttpConnectionService } from '@tw/http-connector';
import type { LoggerService } from '@tw/logger';

const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

/** Categories the (stubbed) products-service was asked about, in order. */
function recomputed(http: { connect: jest.Mock }): string[] {
  return http.connect.mock.calls.map(([request]) => (request as { params: { category: string } }).params.category);
}

// The real cache client over its in-process store: the queue, the lock and their expiry are the
// behaviour under test. Fake timers drive both the drain delay and the lock TTL (Date.now()).
function wire(env: Record<string, string> = {}) {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const cache = new CacheService({ ttlSeconds: 300, negativeTtlSeconds: 30, commandTimeoutMs: 250 } as CacheOptions, logger as never);
  const http = { connect: jest.fn(async () => ({ data: [{ price: 10, stock: 1 }], error: null })) };
  const service = new RecalculationsService(cache, http as unknown as HttpConnectionService, logger as unknown as LoggerService);
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return { cache, http, service };
}

describe('RecalculationsService — every accepted id gets drained', () => {
  beforeEach(() => jest.useFakeTimers({ now: 0 }));
  afterEach(() => jest.useRealTimers());

  it('arms a drain for work that arrives after a drain finished, not only before it', async () => {
    const { http, service } = wire();

    expect(await service.requestRecalculation(['widgets'])).toEqual({ queued: 1, scheduled: true });
    await jest.advanceTimersByTimeAsync(5_000); // t=5: drained
    expect(recomputed(http)).toEqual(['widgets']);

    // t=6: before the fix the lock was still held until t=10 and nothing was armed — this id
    // sat in the set, answered 202, until some later request happened by.
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await service.requestRecalculation(['gadgets'])).toEqual({ queued: 1, scheduled: true });
    await jest.advanceTimersByTimeAsync(5_000);

    expect(recomputed(http)).toEqual(['widgets', 'gadgets']);
  });

  it('catches work added between the drain’s last pop and the lock release', async () => {
    const { cache, http, service } = wire();
    const pop = jest.spyOn(cache, 'popFromSet');
    let lateRequestGotTheLock: boolean | undefined;
    // A concurrent request lands in exactly the gap: after the drain's final (empty) pop, while
    // the lock is still held — so its own attempt to schedule a drain fails.
    pop.mockImplementation(async (key, count) => {
      const popped = await CacheService.prototype.popFromSet.call(cache, key, count);
      if (popped.length === 0 && pop.mock.calls.length === 2) {
        await cache.addToSet(QUEUE_KEY, 'late');
        lateRequestGotTheLock = await cache.acquireLock(LOCK_KEY, 10);
      }
      return popped;
    });

    await service.requestRecalculation(['widgets']);
    await jest.advanceTimersByTimeAsync(5_000); // drain: widgets, then the gap, then release + re-check
    await jest.advanceTimersByTimeAsync(5_000); // the re-armed drain

    expect(lateRequestGotTheLock).toBe(false);
    expect(recomputed(http)).toEqual(['widgets', 'late']);
  });

  it('reconciles orphans left in the queue — once the cache answers, not only at boot', async () => {
    const { cache, http, service } = wire({ RECONCILE_INTERVAL_SECONDS: '30' });
    await cache.addToSet(QUEUE_KEY, ['widgets', 'gadgets']); // accepted by a process that died

    // At bootstrap the real client is still connecting, and an unreachable cache reports every
    // set as empty — which is what a one-off startup check used to see, and then never look again.
    let connected = false;
    const sizeOf = cache.getSizeOfSet.bind(cache);
    jest.spyOn(cache, 'getSizeOfSet').mockImplementation(async (key) => (connected ? sizeOf(key) : 0));

    void service.onApplicationBootstrap();
    connected = true; // …and connects a moment later
    await jest.advanceTimersByTimeAsync(30_000 + 5_000);

    expect(recomputed(http).sort()).toEqual(['gadgets', 'widgets']);
    service.onModuleDestroy();
  });

  it('reconciles work whose lock holder crashed before arming its drain', async () => {
    const { cache, http, service } = wire({ RECONCILE_INTERVAL_SECONDS: '30' });
    await cache.addToSet(QUEUE_KEY, 'widgets');
    await cache.acquireLock(LOCK_KEY, 10); // taken, and the timer died with its process

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(30_000 + 5_000);

    expect(recomputed(http)).toEqual(['widgets']);
    service.onModuleDestroy();
  });

  it('refuses work past MAX_QUEUE_SIZE instead of growing a set that is never evicted', async () => {
    const { service } = wire({ MAX_QUEUE_SIZE: '3' });

    await service.requestRecalculation(['a', 'b']);

    await expect(service.requestRecalculation(['c', 'd'])).rejects.toThrow(QueueFullError);
  });

  it('stops its timers on shutdown; the queued ids stay for the next reconcile', async () => {
    const { cache, http, service } = wire();
    service.onApplicationBootstrap();
    await service.requestRecalculation(['widgets']);

    service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(http.connect).not.toHaveBeenCalled();
    expect(await cache.getSizeOfSet(QUEUE_KEY)).toBe(1);
  });
});

describe('RequestRecalculationDto', () => {
  const errorsFor = async (categoryIds: unknown) =>
    validate(plainToInstance(RequestRecalculationDto, { categoryIds }));

  it('accepts canonical category ids', async () => {
    expect(await errorsFor(['widgets', 'home-garden', 'a.b_c'])).toHaveLength(0);
  });

  it.each([
    ['a mis-cased id', ['Widgets']],
    ['a padded id', [' widgets']],
    ['free text', ['home & garden']],
    ['an over-long id', ['x'.repeat(65)]],
    ['more than 100 ids', Array.from({ length: 101 }, (_, index) => `c${index}`)],
    ['no ids', []],
  ])('refuses %s', async (_case, categoryIds) => {
    expect(await errorsFor(categoryIds)).not.toHaveLength(0);
  });
});

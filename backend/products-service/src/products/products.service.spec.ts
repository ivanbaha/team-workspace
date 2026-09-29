import { CacheService, ReadThroughService } from '@tw/cache';
import { ProductsService } from './products.service';

import type { CacheOptions } from '@tw/cache';
import type { RequestScopedHttpConnectionService } from '@tw/http-connector';
import type { RequestScopedLoggerService } from '@tw/logger';
import type { UsersConnector } from '../connectors/users.connector';
import type { Product } from '../data/products.store';

const logger = { traceId: 'test', info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };

/** users-service over HTTP: knows users 1 and 2, answers 404 for anything else. */
const usersHttp = {
  connect: jest.fn(async ({ url }: { url: string }) => {
    const id = decodeURIComponent(url.split('/').pop() ?? '');
    const known: Record<string, { id: string; name: string; email: string }> = {
      '1': { id: '1', name: 'Alice', email: 'alice@example.com' },
      '2': { id: '2', name: 'Bob', email: 'bob@example.com' },
    };
    if (!known[id]) throw Object.assign(new Error('Not Found'), { status: 404 });
    return { data: known[id], error: null };
  }),
};

// Real cache client over its in-process store, fresh product store per test (module registry reset).
function wire() {
  jest.resetModules();
  usersHttp.connect.mockClear();
  const options = { ttlSeconds: 60, negativeTtlSeconds: 30, commandTimeoutMs: 250 } as CacheOptions;
  const cache = new CacheService(options, logger as never);
  const readThrough = new ReadThroughService(cache, options, logger as never);

  const { ProductsService: Products } = jest.requireActual<{ ProductsService: typeof ProductsService }>('./products.service');
  const { UsersConnector: Connector } = jest.requireActual<{ UsersConnector: typeof UsersConnector }>(
    '../connectors/users.connector',
  );
  const store = jest.requireActual<{ products: Product[] }>('../data/products.store').products;
  const connector = new Connector(
    usersHttp as unknown as RequestScopedHttpConnectionService,
    logger as unknown as RequestScopedLoggerService,
    cache,
  );
  const products = new Products(logger as unknown as RequestScopedLoggerService, cache, readThrough, connector);
  return { cache, products, store };
}

/** Lets the deferred invalidation (setImmediate) and its UNLINK run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ProductsService — keys are built from exactly what the loader sees', () => {
  it('cannot blank the unfiltered list with ?category=all — the synthetic shape is out of reach', async () => {
    const { products } = wire();
    expect(await products.findAll({}, false)).toHaveLength(3);

    expect(await products.findAll({ category: 'all' }, true)).toEqual([]); // a category nobody has

    expect(await products.findAll({}, false)).toHaveLength(3);
  });

  it('serves a mis-cased category from the store without touching the canonical category’s entry', async () => {
    const { products } = wire();

    expect(await products.findAll({ category: 'Widgets' }, true)).toEqual([]); // case-sensitive store

    expect(await products.findAll({ category: 'widgets' }, false)).toHaveLength(2);
  });

  it('does not cache a 404 for product 1 from a request for " 1"', async () => {
    const { products } = wire();

    await expect(products.findOne(' 1', false, true)).rejects.toThrow(/not found/i);

    await expect(products.findOne('1')).resolves.toMatchObject({ id: '1' });
  });

  it('treats an empty ?category= as the unfiltered list, so its entry is one every write invalidates', async () => {
    const { products } = wire();
    expect(await products.findAll({ category: '' }, false)).toHaveLength(3);

    products.create({ name: 'Rake', category: 'garden', price: 1, stock: 1, ownerId: '1' });
    await flush();

    expect(await products.findAll({ category: '' }, false)).toHaveLength(4);
  });
});

describe('ProductsService — a committed write is never turned into a failure by the cache', () => {
  it('accepts a category that cannot form a key, and keeps invalidating every later write', async () => {
    const { products, store } = wire();
    expect((await products.findOne('1')).price).toBe(9.99); // warm product 1

    const rake = products.create({ name: 'Rake', category: 'Home & Garden', price: 1, stock: 1, ownerId: '1' });
    expect(store).toContainEqual(rake);

    products.update('1', { price: 1.23 });
    await flush();

    expect((await products.findOne('1')).price).toBe(1.23);
    // …and the un-keyable category itself is simply never cached: its reads go to the store.
    expect(await products.findAll({ category: 'Home & Garden' }, false)).toEqual([rake]);
  });

  it('resolves an owner id that cannot form a key over HTTP, encoded, instead of failing the catalog', async () => {
    const { products } = wire();
    products.create({ name: 'Mug', category: 'kitchen', price: 5, stock: 3, ownerId: 'x y' });

    const catalog = (await products.findAll({ expandOwner: true }, false)) as (Product & { owner: unknown })[];

    expect(catalog.find((product) => product.ownerId === 'x y')?.owner).toBeNull();
    expect(usersHttp.connect).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/v1\/users\/x%20y$/) }));
  });

  it('never reuses a deleted product’s id', () => {
    const { products, store } = wire();

    products.remove('1');
    const created = products.create({ name: 'New', category: 'widgets', price: 1, stock: 1, ownerId: '1' });

    expect(created.id).toBe('4');
    expect(store.filter((product) => product.id === created.id)).toHaveLength(1);
  });
});

describe('ProductsService — the composite', () => {
  it('passes a caller’s no-cache down to the owner lookups it is built from', async () => {
    const { products, cache } = wire();
    // An owner entry that outlived its invalidation — the stale fill the TTL bounds.
    await cache.set('users-service_user_1', { id: '1', name: 'Alice (stale)', email: 'alice@example.com' });

    const cached = (await products.findAll({ expandOwner: true }, false)) as (Product & { owner: { name: string } })[];
    expect(cached.find((product) => product.id === '1')?.owner.name).toBe('Alice (stale)');

    const fresh = (await products.findAll({ expandOwner: true }, true)) as (Product & { owner: { name: string } })[];
    expect(fresh.find((product) => product.id === '1')?.owner.name).toBe('Alice');
  });
});

describe('REQUEST_CACHE_TTL', () => {
  const original = process.env.REQUEST_CACHE_TTL;
  afterEach(() => {
    if (original === undefined) delete process.env.REQUEST_CACHE_TTL;
    else process.env.REQUEST_CACHE_TTL = original;
  });

  it.each(['0', '', 'ten', '1.5'])('refuses %p when the module loads — at boot, not per request', (value) => {
    process.env.REQUEST_CACHE_TTL = value;
    jest.isolateModules(() => {
      expect(() => jest.requireActual('./products.service')).toThrow(/REQUEST_CACHE_TTL/);
    });
  });
});

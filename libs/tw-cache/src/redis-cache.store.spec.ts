jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

import Redis from 'ioredis';
import { RedisCacheStore } from './redis-cache.store';

const RedisMock = Redis as unknown as jest.Mock;

let client: {
  on: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  unlink: jest.Mock;
  sadd: jest.Mock;
  spop: jest.Mock;
  scard: jest.Mock;
  quit: jest.Mock;
};

function makeStore(handlers: { onUp: () => void; onDown: (message: string) => void } = { onUp: jest.fn(), onDown: jest.fn() }) {
  return { store: new RedisCacheStore('redis://cache:6379', handlers), handlers };
}

const handlersOf = (): Record<string, (payload?: Error) => void> =>
  Object.fromEntries(client.on.mock.calls) as Record<string, (payload?: Error) => void>;

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

describe('RedisCacheStore', () => {
  it('connects without an offline queue', () => {
    makeStore();

    expect(RedisMock).toHaveBeenCalledWith('redis://cache:6379', { enableOfflineQueue: false });
  });

  it('reports availability from the connection events, in both directions', () => {
    const handlers = { onUp: jest.fn(), onDown: jest.fn() };
    makeStore(handlers);

    handlersOf().ready();
    expect(handlers.onUp).toHaveBeenCalledTimes(1);

    handlersOf().error(new Error('boom'));
    expect(handlers.onDown).toHaveBeenCalledWith('boom');

    handlersOf().end();
    expect(handlers.onDown).toHaveBeenCalledWith('connection closed');
  });

  it('parses the JSON the entries are stored as, and passes a missing key through as null', async () => {
    const { store } = makeStore();
    client.get.mockResolvedValue('{"a":1}');

    expect(await store.get('k')).toEqual({ a: 1 });

    client.get.mockResolvedValue(null);
    expect(await store.get('absent')).toBeNull();
  });

  it('stores with SET … EX — the TTL travels in seconds, the one unit of the layer', async () => {
    const { store } = makeStore();
    client.set.mockResolvedValue('OK');

    await store.set('k', { a: 1 }, 30);

    expect(client.set).toHaveBeenCalledWith('k', '{"a":1}', 'EX', 30);
  });

  it('deletes one key through DEL, many through UNLINK, each in a single command', async () => {
    const { store } = makeStore();
    client.del.mockResolvedValue(1);
    client.unlink.mockResolvedValue(2);

    await store.del('k');
    expect(client.del).toHaveBeenCalledWith('k');

    await store.delMany(['k1', 'k2']);
    // UNLINK over DEL for the bulk path: same count, asynchronous reclamation.
    expect(client.unlink).toHaveBeenCalledWith('k1', 'k2');

    expect(await store.delMany([])).toBe(0);
    expect(client.del).toHaveBeenCalledTimes(1);
    expect(client.unlink).toHaveBeenCalledTimes(1);
  });

  it('queues through SADD and drains through SPOPCOUNT, atomically at the server', async () => {
    const { store } = makeStore();
    client.sadd.mockResolvedValue(2);
    client.spop.mockResolvedValue(['a', 'b']);

    await store.addToSet('queue', ['a', 'b']);
    expect(client.sadd).toHaveBeenCalledWith('queue', 'a', 'b');

    expect(await store.addToSet('queue', [])).toBe(0);
    expect(client.sadd).toHaveBeenCalledTimes(1);

    expect(await store.popFromSet('queue', 2)).toEqual(['a', 'b']);
    expect(client.spop).toHaveBeenCalledWith('queue', 2);
  });

  it('sizes a set through SCARD', async () => {
    const { store } = makeStore();
    client.scard.mockResolvedValue(3);

    expect(await store.getSizeOfSet('queue')).toBe(3);
  });

  it('locks with SET NX EX — one command, so two takers cannot both win', async () => {
    const { store } = makeStore();
    client.set.mockResolvedValue('OK');

    expect(await store.acquireLock('batch', 5)).toBe(true);
    expect(client.set).toHaveBeenCalledWith('batch', expect.any(String), 'EX', 5, 'NX');

    client.set.mockResolvedValue(null);
    expect(await store.acquireLock('batch', 5)).toBe(false);
  });

  it('quits the client on close', async () => {
    const { store } = makeStore();

    await store.close();

    expect(client.quit).toHaveBeenCalled();
  });
});
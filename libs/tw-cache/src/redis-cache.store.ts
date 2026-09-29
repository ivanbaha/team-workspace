import Redis from 'ioredis';

import type { ICacheStore } from './types';

interface RedisStoreHandlers {
  /** The client connected, or reconnected after an outage. */
  onUp: () => void;
  /** A connection attempt failed, or an established connection dropped. */
  onDown: (message: string) => void;
}

/**
 * The server-backed store: one command per operation, no local embellishments.
 *
 * The commands are the wire contract — a person debugging with `redis-cli` (or a future consumer
 * in another language) reads keys directly — so the shapes below are worth being literal about:
 * `SET key value EX ttl`, `SPOP key count`, `SET key <timestamp> NX EX ttl` for the lock.
 */
export class RedisCacheStore implements ICacheStore {
  private readonly client: Redis;

  constructor(url: string, commandTimeoutMs: number, handlers: RedisStoreHandlers) {
    this.client = new Redis(url, {
      // A command issued while disconnected rejects immediately, instead of queueing for a
      // connection that may never come back. Queued reads are reads nobody waits for any more;
      // queued writes are worse — they flush against recovered state later, applying a decision
      // made against the world as it was. The service turns the rejection into the outage policy
      // instead of the request waiting on a maybe.
      enableOfflineQueue: false,
      // The offline queue only covers a connection that is known to be down. A server that is
      // connected but silent — a hung process, a lost node black-holing an established TCP
      // connection — emits no event at all, and without a deadline every command waits until the
      // kernel gives up on the socket, which takes minutes. Fail-open is only as fast as this.
      commandTimeout: commandTimeoutMs,
      // Commands in flight when a connection drops are failed, not re-sent after the reconnect: a
      // re-sent SET is a fill that lands after whatever invalidation happened in the meantime.
      autoResendUnfulfilledCommands: false,
    });

    // Availability comes from connection events, not from per-command errors: the first failed
    // command of an outage would otherwise be indistinguishable from every other failure kind,
    // and the transitions are what the health endpoint and the logs want to state. `close` is
    // the one a server that shuts down cleanly sends — no `error`, and no `end` while the client
    // is still reconnecting.
    this.client.on('ready', () => handlers.onUp());
    this.client.on('error', (error: Error) => handlers.onDown(error.message));
    this.client.on('close', () => handlers.onDown('connection closed'));
    this.client.on('end', () => handlers.onDown('connection closed'));
  }

  /** Drops the connection and lets the client reconnect — how the service abandons a silent socket. */
  reconnect(): void {
    this.client.disconnect(true);
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async delMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    // UNLINK, not DEL: same count semantics, but the server reclaims the memory asynchronously
    // instead of blocking its single thread on it. A one-key delete reclaims nothing worth
    // deferring; a bulk invalidation has no reason to hold the engine.
    return this.client.unlink(...keys);
  }

  async addToSet(key: string, members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.client.sadd(key, ...members);
  }

  async popFromSet(key: string, count: number): Promise<string[]> {
    if (count < 1) return [];
    return this.client.spop(key, count);
  }

  async getSizeOfSet(key: string): Promise<number> {
    return this.client.scard(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    // `SET NX EX` is the atomic "take it only if free": one command, one answer from the server.
    // A get-then-set lock is two commands, and the window between them is precisely where two
    // replicas both take the same lock and both run the work. The value is the acquisition time —
    // it is never read by code, but it answers "who/when" for a person inspecting the keyspace.
    const result = await this.client.set(key, new Date().toISOString(), 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async close(): Promise<void> {
    // QUIT lets the server finish what it has. While the connection is down it is refused outright
    // (there is no offline queue to hold it) and the client goes on reconnecting — which would keep
    // a stopping process alive until it is killed. disconnect() is what ends the reconnecting.
    await this.client.quit().catch(() => undefined);
    this.client.disconnect();
  }
}
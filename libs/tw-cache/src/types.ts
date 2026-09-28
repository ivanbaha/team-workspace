import { Injectable } from '@nestjs/common';

import type { Provider } from '@nestjs/common';
import type { ITraceLogger } from '@tw/logger';
import type { CACHE_LOGGER } from './constants';

export interface ICacheOptions {
  /**
   * Provider for the logger the cache writes through. Must use the `CACHE_LOGGER` token.
   *
   * @example { provide: CACHE_LOGGER, useExisting: LoggerService }
   */
  logger: Provider<ITraceLogger> & { provide: typeof CACHE_LOGGER };

  /**
   * Cache server URL, `redis://[user[:password]@]host[:port]`.
   *
   * **Omit it and the cache runs against an in-process store**: same API, same semantics,
   * nothing shared. That is the local default — every service in the cluster must point at the
   * same server for a write in one to be a hit in another, which is the entire point of the layer.
   */
  url?: string;

  /**
   * TTL for every entry, in seconds — the one unit the layer uses. Must be a positive integer;
   * zero is a configuration error, not "no expiry".
   *
   * @default 60
   */
  ttlSeconds?: number;

  /**
   * TTL for negative entries — what a read-through owner stores when its loader found nothing.
   * Usually shorter than `ttlSeconds`: "does not exist" is stable, but the first creation of an
   * entity should not wait out a full TTL to become visible.
   *
   * @default 30
   */
  negativeTtlSeconds?: number;

  /** @default true */
  isGlobal?: boolean;
}

/** Resolved options, with defaults applied. Injected as a value provider. */
@Injectable()
export class CacheOptions implements ICacheOptions {
  logger!: ICacheOptions['logger'];
  url: string | undefined = undefined;
  ttlSeconds = 60;
  negativeTtlSeconds = 30;
  isGlobal = true;
}

/** What the health endpoint exposes: the state the cache is actually in, not the one configured. */
export interface CacheStats {
  /** Which store is behind the API — `memory` means nothing is shared; check `CACHE_URL`. */
  store: 'redis' | 'memory';
  /** True when the server is unreachable (or not yet connected). Reads fail open meanwhile. */
  disabled: boolean;
  /** Reads answered from the cache, including negative hits. */
  hits: number;
  /** Reads the cache could not answer because the key was absent or expired. */
  misses: number;
  /** Reads skipped because the server was unreachable — neither hits nor misses. */
  skipped: number;
}

/**
 * What a store implements. The service layers the outage policy and the counters on top, so the
 * stores stay dumb: given a reachable server, these operations are correct or they throw.
 */
export interface ICacheStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<number>;
  delMany(keys: string[]): Promise<number>;
  addToSet(key: string, members: string[]): Promise<number>;
  popFromSet(key: string, count: number): Promise<string[]>;
  getSizeOfSet(key: string): Promise<number>;
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
}
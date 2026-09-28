/**
 * Thrown when the cache is handed a configuration it cannot honour — at `forRoot()` (a bad module
 * option) or per call (a TTL override of zero).
 *
 * The distinction this type exists to keep sharp: a cache that is *unreachable* fails open and
 * keeps the request alive, while a cache that is *misconfigured* is a bug, and the only useful
 * thing it can do is fail loudly — at boot where possible, never as a silent wrong behaviour.
 * `JSON.stringify`-ing the received value into the message keeps `undefined`, `NaN` and `'60'`
 * distinguishable in the one line an operator actually reads.
 */
export class CacheConfigurationError extends Error {
  constructor(message: string) {
    super(`CacheModule configuration error: ${message}`);
    this.name = 'CacheConfigurationError';
  }
}

/**
 * Thrown by `addToSet` when the cache server cannot be reached.
 *
 * Set adds are the queue writes of this design, and queue writes fail **closed**: acknowledging
 * an item that was not stored reports work as done that no worker will ever pick up — lost
 * silently, which no retry or reconciliation can notice. Callers map this to 503 so the client
 * knows the request failed, while cache reads in the same process keep failing open.
 */
export class CacheUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheUnavailableError';
  }
}
import { CacheConfigurationError } from './errors';

/**
 * Asserts a TTL in the layer's single unit: seconds, as a positive integer.
 *
 * Zero is deliberately rejected, not treated as "use the default": on a server configured to
 * evict under memory pressure, an entry with no expiry reads as "never expires on its own", which
 * is how an entry comes to outlive the data it shadows. Someone writing `0` meant something —
 * most often milliseconds, sometimes "off" — and the only safe reading is to make them say which.
 * `undefined` passes: optional fields fall back to their defaults.
 */
export function assertTtlSeconds(value: unknown, name: string): void {
  if (value === undefined) return;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return;

  throw new CacheConfigurationError(
    `\`${name}\` must be a positive integer number of seconds, received ${JSON.stringify(value) ?? String(value)}. ` +
      'Seconds are the only unit this layer uses; zero is not a TTL but an outage of this check.',
  );
}

/**
 * Asserts the cache server URL. Accepted shape: `redis://[user[:password]@]host[:port]` (or
 * `rediss://` — the port is optional because the default one, 6379, is what a bare host means).
 *
 * The check is deliberately shallow: anything an attacker could put in a URL is going to a
 * dedicated cache client, not to a shell. What it must catch is a value from the wrong variable —
 * `http://`, a bare `host:port`, a value with a space in it — at boot, rather than as a connection
 * error that names neither the variable nor the service.
 */
export function assertCacheUrl(url: unknown): void {
  if (url === undefined || url === null) return;
  if (typeof url === 'string' && /^rediss?:\/\/\S+$/.test(url)) return;

  throw new CacheConfigurationError(
    `\`url\` must look like redis://host[:port] — or rediss:// for TLS — received ${JSON.stringify(url) ?? String(url)}.`,
  );
}
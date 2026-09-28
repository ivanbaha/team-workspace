/**
 * DI token for the logger the cache writes its store-level records through.
 *
 * Same pattern as `HC_LOGGER`: the service depends on `ITraceLogger` via this token rather than on
 * a concrete class, so each service wires the cache to the logger it already registers —
 * `{ provide: CACHE_LOGGER, useExisting: LoggerService }` — and the cache's lines land in the same
 * log stream, with the same masking, as everything else the service writes.
 */
export const CACHE_LOGGER = 'CACHE_LOGGER';

/**
 * The value an owner stores in place of an entity its loader could not find.
 *
 * "User 9 does not exist" is worth caching — the lookup that proved it costs the same as one that
 * finds the row, and an entity that does not exist is the stablest fact a cache can hold. But
 * `null` already means "no entry" to every reader, so a negative result needs a value that survives
 * the round trip and reads as a deliberate entry. This string is it.
 *
 * A namespace whose legitimate values can equal this string must not use negative caching — no
 * workspace namespace holds bare strings, and the registry is the single place to check that when
 * adding one.
 */
export const NEGATIVE_CACHE_SENTINEL = 'not_present';

/** Default TTL for entries, in seconds — the one unit the whole layer uses. */
export const DEFAULT_TTL_SECONDS = 60;

/** Default TTL for negative entries, in seconds. */
export const DEFAULT_NEGATIVE_TTL_SECONDS = 30;
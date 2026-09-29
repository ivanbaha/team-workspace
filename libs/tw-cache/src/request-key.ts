import { CACHE_IDENTIFIER_PATTERN, CACHE_NAMESPACES } from './cache-keys';

import type { CacheNamespaceName } from './cache-keys';

/** Values a request-key parameter may carry. Booleans, numbers and identifiers — nothing else. */
export type RequestKeyParams = Record<string, string | number | boolean>;

// The same character contract as an entity id in cacheKey(): a segment that does not survive this
// pattern is a segment two call sites may format differently — one more separator, one casing
// variant — and the "same" request produces two cache entries, half of which nothing invalidates.
const SEGMENT_PATTERN = CACHE_IDENTIFIER_PATTERN;

/**
 * Builds a key for a cached *request* — a composite answer cached as one value — from the
 * registry, the way `cacheKey()` builds entity keys.
 *
 * The difference from an entity key is the id: a request has no id, it has a route and a set of
 * query parameters, and the whole failure mode of request caching is that the same request can be
 * *spelled* several ways. Two call sites building the same filters in a different order, or with
 * a differently cased parameter name, must produce one key, or the cache quietly holds duplicates
 * that expire independently: a hit rate that reads fine while half the traffic misses, and a stale
 * twin that survives the refresh of its sibling. So the serialization here is canonical or it
 * throws:
 *
 * - **Parameters are sorted by name.** Construction order cannot leak into the key.
 * - **The route and parameter names are trimmed and lowercased.** Both are written by the code,
 *   and the loader never reads them back out of the key, so their spelling cannot change an answer.
 * - **Values are validated as given — never trimmed or lowercased.** A value comes from the
 *   request and is what the loader filters on. Rewriting it would map `Widgets` and `widgets` to
 *   one key while their loaders return different lists, and whichever filled the key first would
 *   answer for both. A value that is not already canonical is refused; the call site serves that
 *   request uncached.
 * - **Values are strictly limited** to what `SEGMENT_PATTERN` survives, checked per value.
 *   Free text is refused on purpose, by construction: a key built from arbitrary user input is a
 *   key space nobody can enumerate, and a key space nobody can enumerate is one nobody can
 *   invalidate. An endpoint whose parameters are free text is an endpoint that does not get
 *   request caching — see the `search` rule in the docs.
 *
 * What belongs in `params` is decided by the call site, and is itself part of the design: only the
 * parameters that change the answer (never identity headers — see "never cache a response whose
 * body varies by who is asking" — and never noise the handler ignores).
 */
export function requestKey(name: CacheNamespaceName, route: string, params: RequestKeyParams = {}): string {
  const namespace = CACHE_NAMESPACES[name];
  // The type makes this unreachable; the check is for the build-mismatch case, where a deployed
  // consumer was compiled against an older registry than the one its input came from.
  if (!namespace) {
    throw new Error(`Unknown cache namespace '${String(name)}'. Known: ${Object.keys(CACHE_NAMESPACES).join(', ')}.`);
  }

  if (typeof route !== 'string') {
    throw new Error(`requestKey() route must be a string, received ${JSON.stringify(route) ?? String(route)}.`);
  }
  const normalizedRoute = route.trim().toLowerCase();
  if (!SEGMENT_PATTERN.test(normalizedRoute)) {
    throw new Error(
      `Refusing to build a request key for namespace '${name}' from route ${JSON.stringify(route)}: after ` +
        `normalization ('${normalizedRoute}') it does not match /^[a-z0-9][a-z0-9._-]*$/. Routes are key segments, ` +
        "not paths — write 'v1-products', not '/v1/products'.",
    );
  }

  const canonicalParams = Object.keys(params)
    .sort()
    .map((rawKey) => {
      const key = rawKey.trim().toLowerCase();
      if (!SEGMENT_PATTERN.test(key)) {
        throw new Error(
          `Refusing to build a request key for namespace '${name}' from parameter name ${JSON.stringify(rawKey)}: ` +
            `after normalization ('${key}') it does not match /^[a-z0-9][a-z0-9._-]*$.`,
        );
      }

      const value = params[rawKey];
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(
          `Refusing to build a request key for namespace '${name}' from parameter '${key}': its value is ` +
            `${value === null ? 'null' : typeof value}. Only strings, numbers and booleans can form a key — ` +
            'a param that may be absent should not be in the record at all.',
        );
      }

      const segment = String(value);
      if (!SEGMENT_PATTERN.test(segment)) {
        throw new Error(
          `Refusing to build a request key for namespace '${name}' from parameter '${key}': value ` +
            `${JSON.stringify(value)} does not match /^[a-z0-9][a-z0-9._-]*$/ as given. Values are validated, never ` +
            'trimmed or lowercased — the loader filters on the raw value. Free-text query values cannot form cache ' +
            'keys either: a key space nobody can enumerate is one nobody can invalidate. Serve such a request ' +
            'uncached.',
        );
      }

      return `${key}=${segment}`;
    })
    .join('&');

  // The separator is safe because every segment above already survived the pattern.
  return `${namespace.service}_${namespace.entity}_${normalizedRoute}${canonicalParams ? `_${canonicalParams}` : ''}`;
}
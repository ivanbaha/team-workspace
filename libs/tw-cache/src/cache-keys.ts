export interface CacheNamespace {
  /**
   * The service that owns the data — the first key segment, and the boundary the server's ACL
   * works on: a service is granted read (and, for owners, write) access to `~<service>_*` and
   * nothing else.
   *
   * Must equal that service's `DEPLOYMENT_NAME`, because the key is how a consumer finds the
   * owner's entry and the ACL pattern is how the server finds the key. A drift between the two
   * is an entry the owner writes and no consumer can read.
   */
  service: string;
  /** The entity the entry holds — the middle key segment. */
  entity: string;
}

/**
 * Every cacheable entity in the workspace, declared once.
 *
 * The key format is `{service}_{entity}_{id}` — `users-service_user_1` — and the leading service
 * segment is what makes single-writer ownership enforceable: an ACL user granted `~users-service_*`
 * can write exactly one service's keys and read whichever others it consumes. Building keys from
 * this registry instead of by hand is what keeps that true. A hand-built `users-Service_user_1`
 * fails silently in the worst way: it is a key the owner never invalidates, on a pattern the ACL
 * may not even cover.
 *
 * **Adding a namespace is part of the change that first uses it.** The registry is the
 * compile-time list of what may be cached — a key built outside it does not exist as far as any
 * reviewer, ACL pattern, or debugging session is concerned.
 *
 * One thing this registry deliberately does not hold: key *builders* exported by the owning
 * service (the alternative design, where consumers import `makeUserKey()` from the owner). In a
 * package-per-team setup that is the right call — it keeps the owner's key format private and
 * versionable. In this monorepo it would only add a release boundary with nothing to release:
 * every consumer already compiles against the same tree, so a central table is one place to read
 * and one place to be wrong.
 */
export const CACHE_NAMESPACES = {
  /** Public user profiles. Owned and written by users-service; read directly by consumers. */
  user: { service: 'users-service', entity: 'user' },
  /** Per-category aggregates. Owned and written by products-sync-service. */
  categoryStats: { service: 'products-sync-service', entity: 'categoryStats' },
  /** Single products. Owned and written by products-service. */
  product: { service: 'products-service', entity: 'product' },
  /**
   * Product lists per bounded shape — `all`, or `category.<name>` — the full hydrated list as one
   * value. The `category.` prefix keeps the synthetic `all` shape out of reach of any category a
   * caller can name. Owned and written by products-service; any write to any product invalidates
   * every shape, deliberately: the selective-invalidation cleverness is not worth its failure modes.
   */
  productList: { service: 'products-service', entity: 'productList' },
  /**
   * Composite request answers cached as one value (the `expandOwner` catalog view). The entity
   * segment is `req` for the whole family; the route and canonical query parameters distinguish
   * the keys — see `requestKey()`. Invalidated by products-service's own writes; the TTL bounds
   * the part no product write can reach — the owner entries users-service contributed.
   */
  productCatalog: { service: 'products-service', entity: 'req' },
} as const satisfies Record<string, CacheNamespace>;

export type CacheNamespaceName = keyof typeof CACHE_NAMESPACES;

/**
 * Identifiers a key segment can survive. Spaces, `*`, `:` and friends are not "usually absent"
 * — they are how a wildcard or a structurally different key gets created by accident, so the
 * builder refuses them rather than producing a key nobody else will compute the same way.
 *
 * Exported so an input that is going to become a key (a queued category id, say) can be
 * validated at the boundary with the same rule, instead of a copy that drifts.
 */
export const CACHE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Builds a cache key from the registry.
 *
 * **The identifier is validated, never rewritten.** A key must be a function of exactly what the
 * loader behind it sees. A builder that trimmed or lowercased would map `' 1'` and `'1'` — or
 * `Widgets` and `widgets` — to one key while their loaders, matching the raw value against the
 * source of truth, disagree about the answer. Whichever loader fills the key first then answers
 * for both: a request for `/v1/users/%201` stores "does not exist" under user 1's key, and every
 * service reading that key serves the 404. So an identifier that is not already canonical is
 * refused, and its request is served from the source, uncached.
 *
 * Throws on anything that cannot be a key. Use it for identifiers the code itself constructs;
 * anything that comes from data — a path parameter, a query value, a stored column — goes
 * through `cacheKeyOrNull`.
 */
export function cacheKey(name: CacheNamespaceName, id: string | number): string {
  const result = buildKey(name, id);
  if (!result.ok) throw new Error(result.message);
  return result.key;
}

/**
 * The variant for identifiers that come from data: **one that cannot form a key reads as
 * `null`, not as a 500.**
 *
 * On a read, a path parameter or query value is end-user input; `GET /v1/users/foo%20bar` is a
 * caller asking for something the source of truth answers (a 404, an empty list), not a crash for
 * the cache layer to give. The call site falls back to an uncached read, which answers correctly.
 *
 * On a write, `null` means there is nothing to invalidate: an identifier that cannot form a key
 * never had an entry, because every read of it went uncached. Throwing there would fail a write
 * the source of truth has already committed.
 *
 * The one failure this variant does **not** swallow: an unknown *namespace* still throws. That is
 * programmer error, not data — a deployed consumer compiled against an older registry — and
 * degrading it to "uncached" would hide a version skew behind mysteriously cold metrics.
 */
export function cacheKeyOrNull(name: CacheNamespaceName, id: string | number): string | null {
  const result = buildKey(name, id);
  if (result.ok) return result.key;
  if (result.reason === 'unknown-namespace') throw new Error(result.message);
  return null;
}

type KeyResult = { ok: true; key: string } | { ok: false; reason: 'unknown-namespace' | 'bad-identifier'; message: string };

function buildKey(name: CacheNamespaceName, id: string | number): KeyResult {
  const namespace = CACHE_NAMESPACES[name];
  // The type makes this unreachable; the check is for the build-mismatch case, where a deployed
  // consumer was compiled against an older registry than the one its input came from.
  if (!namespace) {
    return {
      ok: false,
      reason: 'unknown-namespace',
      message: `Unknown cache namespace '${String(name)}'. Known: ${Object.keys(CACHE_NAMESPACES).join(', ')}.`,
    };
  }

  // Anything that is not a scalar identifier is a caller bug — an entity object, a composite
  // value — and the key it would produce (`users-service_user_[object Object]`) is one no other
  // party ever builds, reads, or invalidates. Refusing it here is the whole point of a registry.
  if (typeof id !== 'string' && typeof id !== 'number') {
    return {
      ok: false,
      reason: 'bad-identifier',
      message:
        `Refusing to build a cache key for namespace '${name}' from identifier ${JSON.stringify(id) ?? String(id)}: ` +
        'not a string or a number. An entity object or a composite value reached the key builder — ' +
        'cacheable identifiers are ids, and only ids.',
    };
  }

  const segment = String(id);
  if (!CACHE_IDENTIFIER_PATTERN.test(segment)) {
    return {
      ok: false,
      reason: 'bad-identifier',
      message:
        `Refusing to build a cache key for namespace '${name}' from identifier ${JSON.stringify(id)}: it is ` +
        'empty, not in canonical form, or contains characters the key format does not survive. Cacheable ' +
        'identifiers match /^[a-z0-9][a-z0-9._-]*$/ as given — they are validated, never trimmed or lowercased, ' +
        'because the loader behind the key sees the raw value.',
    };
  }

  return { ok: true, key: `${namespace.service}_${namespace.entity}_${segment}` };
}
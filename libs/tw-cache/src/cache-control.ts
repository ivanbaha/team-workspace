const NO_CACHE_DIRECTIVE = /(^|,)\s*no-(cache|store)\s*(,|$)/i;

/**
 * Does this `Cache-Control` header demand a fresh response?
 *
 * The contract this implements, in the shape a cache-aside layer can honour: a request carrying
 * `no-cache` (or `no-store`) skips the cached read, fetches from the source, and **overwrites the
 * entry with what comes back** — the header is a repair tool, so the repair has to stick, or the
 * next reader re-reports the stale value that prompted the repair. Invalidation on *write* is
 * never tied to the header: a write always invalidates, whoever made it.
 *
 * Matching is strict about the token and forgiving about the list: case and whitespace are
 * irrelevant (the wire is not consistent about either), and the directive must end at a comma or
 * the end of the string — `no-cache=foo` is a valued directive, and `no-cachefoo` is a different
 * word. `max-age=0` is deliberately **not** matched: a sender who wants revalidation says so
 * with `no-cache`, and half of the HTTP ecosystem writes `max-age=0` on responses that are
 * perfectly fine to cache for a moment.
 *
 * This borrows a request directive RFC 9111 defines for HTTP caches and applies it to the cache
 * behind the origin. That makes it an amplification lever: browsers send `no-cache` on every hard
 * reload and whenever devtools disables caching, and each such request costs the owner a source
 * read (a composite, one per part). Decide at the edge who may send it — strip it from public
 * traffic, or rate-limit it — and let internal callers and operators keep it as the repair tool.
 */
export function wantsFreshData(headerValue: string | null | undefined): boolean {
  return NO_CACHE_DIRECTIVE.test(headerValue ?? '');
}
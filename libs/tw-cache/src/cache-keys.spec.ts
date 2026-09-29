import { CACHE_IDENTIFIER_PATTERN, CACHE_NAMESPACES, cacheKey, cacheKeyOrNull } from './cache-keys';

describe('cacheKey', () => {
  it('builds the registry format: owning service, entity, id as given', () => {
    expect(cacheKey('user', '1')).toBe('users-service_user_1');
    expect(cacheKey('user', 42)).toBe('users-service_user_42');
    expect(cacheKey('categoryStats', 'widgets')).toBe('products-sync-service_categoryStats_widgets');
  });

  it.each([
    ['padded with spaces', ' 1 '],
    ['with a trailing space', '1 '],
    ['upper-cased', 'Widgets'],
    ['mixed-case with padding', '  ABC '],
  ])('refuses an identifier %s instead of rewriting it into another id’s key', (_case, id) => {
    // The loader behind the key sees the raw value. Trimming or lowercasing here would give
    // ' 1' the key of '1' while its loader answers "not found" — and whichever loader filled the
    // key first would answer for both.
    expect(() => cacheKey('user', id)).toThrow(/not in canonical form/);
  });

  it.each([
    ['an entity object', { id: '1' }],
    ['null', null],
    ['undefined', undefined],
    ['a boolean', true],
  ])('refuses %s reaching the key builder — it would build a key nobody else computes', (_case, id) => {
    expect(() => cacheKey('user', id as never)).toThrow(/not a string or a number/);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['with a space', 'has space'],
    ['with a glob star', 'cat*egory'],
    ['with a colon', 'seg:ment'],
    ['with a comma', 'a,b'],
  ])('refuses an identifier that is %s', (_case, id) => {
    expect(() => cacheKey('user', id)).toThrow(/Refusing to build a cache key/);
  });

  it('names the offending namespace and identifier, so the 500 is diagnosable', () => {
    expect(() => cacheKey('user', { id: 1 } as never)).toThrow(/user/);
  });

  it('refuses a namespace the registry does not know — the compiled-against-stale-registry case', () => {
    expect(() => cacheKey('nope' as never, '1')).toThrow(/Unknown cache namespace/);
  });

  it('keeps every registry entry in the shape the ACL patterns assume', () => {
    // The service segment is what the server's per-service ACL users match (~<service>_*); the
    // entity segment is what invalidation and debugging greps rely on. Both are cheap to check
    // and silently expensive to break.
    for (const [name, namespace] of Object.entries(CACHE_NAMESPACES)) {
      expect(namespace.service).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(namespace.entity).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('cacheKeyOrNull — the variant for identifiers that come from data', () => {
  it('returns the same key as cacheKey for anything cacheable', () => {
    expect(cacheKeyOrNull('user', '1')).toBe(cacheKey('user', 1));
  });

  it('reads null for an identifier that cannot form a key — a 404, not a 500', () => {
    // GET /v1/users/foo%20bar: the space makes the id un-keyable, and the read path falls back
    // to the source of truth, which answers not-found.
    expect(cacheKeyOrNull('user', 'foo bar')).toBeNull();
    expect(cacheKeyOrNull('productList', 'home goods')).toBeNull();
    expect(cacheKeyOrNull('user', '  ')).toBeNull();
    expect(cacheKeyOrNull('user', { id: 1 } as never)).toBeNull();
  });

  it('reads null for a non-canonical spelling of a valid id, so it cannot land on the canonical key', () => {
    // The poisoning this prevents: GET /v1/users/%201 used to share user 1's key, and its
    // loader's "not found" became the answer every service read for user 1.
    expect(cacheKeyOrNull('user', ' 1')).toBeNull();
    expect(cacheKeyOrNull('productList', 'Widgets')).toBeNull();
  });

  it('still throws for an unknown namespace — programmer error is not degraded', () => {
    // A stale-registry deployment would otherwise show up as mysteriously cold metrics, not
    // as the loud failure it is.
    expect(() => cacheKeyOrNull('nope' as never, '1')).toThrow(/Unknown cache namespace/);
  });
});

describe('CACHE_IDENTIFIER_PATTERN', () => {
  it.each(['widgets', 'a-b.c_d', '42', 'Widgets', ' widgets', 'a b', ''])(
    'accepts %p exactly when the builder does, so boundary validation cannot drift from it',
    (id) => {
      expect(CACHE_IDENTIFIER_PATTERN.test(id)).toBe(cacheKeyOrNull('user', id) !== null);
    },
  );
});

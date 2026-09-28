import { CACHE_NAMESPACES, cacheKey, cacheKeyOrNull } from './cache-keys';

describe('cacheKey', () => {
  it('builds the registry format: owning service, entity, normalized id', () => {
    expect(cacheKey('user', '1')).toBe('users-service_user_1');
    expect(cacheKey('categoryStats', 'widgets')).toBe('products-sync-service_categoryStats_widgets');
  });

  it('normalizes identifiers in the one place that exists for it', () => {
    expect(cacheKey('user', '  ABC ')).toBe('users-service_user_abc');
    expect(cacheKey('user', 42)).toBe('users-service_user_42');
    // The point of central normalization: the owner and the consumer arrive with differently
    // cased copies of the same id, and the key still comes out identical.
    expect(cacheKey('user', 'ID-01')).toBe(cacheKey('user', ' id-01 '));
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
  ])('refuses an identifier that is %s after normalization', (_case, id) => {
    expect(() => cacheKey('user', id)).toThrow(/after normalization/);
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

describe('cacheKeyOrNull — the end-user-input variant', () => {
  it('returns the same key as cacheKey for anything cacheable', () => {
    expect(cacheKeyOrNull('user', ' 1 ')).toBe(cacheKey('user', 1));
  });

  it('reads null for an identifier that cannot form a key — a 404, not a 500', () => {
    // GET /v1/users/foo%20bar: the space makes the id un-keyable, and the read path falls back
    // to the source of truth, which answers not-found.
    expect(cacheKeyOrNull('user', 'foo bar')).toBeNull();
    expect(cacheKeyOrNull('productList', 'home goods')).toBeNull();
    expect(cacheKeyOrNull('user', '  ')).toBeNull();
    expect(cacheKeyOrNull('user', { id: 1 } as never)).toBeNull();
  });

  it('still throws for an unknown namespace — programmer error is not degraded', () => {
    // A stale-registry deployment would otherwise show up as mysteriously cold metrics, not
    // as the loud failure it is.
    expect(() => cacheKeyOrNull('nope' as never, '1')).toThrow(/Unknown cache namespace/);
  });
});
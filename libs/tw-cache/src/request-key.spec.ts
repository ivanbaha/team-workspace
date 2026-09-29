import { requestKey } from './request-key';

describe('requestKey', () => {
  it('builds the registry-prefixed key with no params', () => {
    expect(requestKey('productCatalog', 'v1-products')).toBe('products-service_req_v1-products');
  });

  it('sorts parameters, so construction order cannot produce duplicate entries', () => {
    // The one property this helper exists for: the same request, spelled in any order, is one key.
    const forward = requestKey('productCatalog', 'v1-products', { expandOwner: true, category: 'widgets' });
    const shuffled = requestKey('productCatalog', 'v1-products', { category: 'widgets', expandOwner: true });
    expect(forward).toBe(shuffled);
    expect(forward).toBe('products-service_req_v1-products_category=widgets&expandowner=true');
  });

  it('normalizes the route and parameter names — both are written by code, not read by the loader', () => {
    expect(requestKey('productCatalog', ' V1-Products ', { ExpandOwner: true, Category: 'widgets' })).toBe(
      'products-service_req_v1-products_category=widgets&expandowner=true',
    );
  });

  it.each([
    ['upper-cased', { category: 'Widgets' }],
    ['padded', { category: ' widgets ' }],
    ['a boolean spelled as text', { expandOwner: 'True' }],
  ])('refuses a parameter value that is %s instead of rewriting it', (_case, params) => {
    // The value is what the loader filters on: lowercasing 'Widgets' would give it the key of
    // 'widgets' while its loader returns a different list.
    expect(() => requestKey('productCatalog', 'v1-products', params)).toThrow(/as given/u);
  });

  it('keeps booleans and numbers canonical', () => {
    expect(requestKey('productCatalog', 'v1-products', { expandOwner: true })).toBe(
      'products-service_req_v1-products_expandowner=true',
    );
    expect(requestKey('productCatalog', 'v1-products', { page: 2 })).toBe('products-service_req_v1-products_page=2');
  });

  it('is deterministic across repeated calls', () => {
    const params = { category: 'gadgets', expandOwner: false };
    expect(requestKey('productCatalog', 'v1-products', params)).toBe(requestKey('productCatalog', 'v1-products', params));
  });

  it('refuses a route that is a path rather than a key segment', () => {
    expect(() => requestKey('productCatalog', '/v1/products')).toThrow(
      /after normalization .* does not match .*Routes are key segments/u,
    );
  });

  it('refuses a blank route', () => {
    expect(() => requestKey('productCatalog', '  ')).toThrow(/Refusing to build a request key/u);
  });

  it('refuses free-text parameter values, by construction', () => {
    // Free text cannot form a key: a key space nobody can enumerate is one nobody can invalidate.
    expect(() => requestKey('productCatalog', 'v1-products', { search: 'Red Widget!' })).toThrow(
      /Free-text query values cannot form cache keys/u,
    );
  });

  it('refuses an empty parameter value, which would be an invisible key difference', () => {
    expect(() => requestKey('productCatalog', 'v1-products', { category: '  ' })).toThrow(
      /Refusing to build a request key .* 'category'/u,
    );
  });

  it('refuses null and undefined values rather than silently dropping them', () => {
    expect(() => requestKey('productCatalog', 'v1-products', { category: undefined as unknown as string })).toThrow(
      /Only strings, numbers and booleans can form a key/u,
    );
    expect(() => requestKey('productCatalog', 'v1-products', { category: null as unknown as string })).toThrow(
      /its value is null/u,
    );
  });

  it('refuses a free-text parameter name', () => {
    expect(() => requestKey('productCatalog', 'v1-products', { 'user search': 'widgets' })).toThrow(
      /from parameter name "user search"/u,
    );
  });

  it('throws on a namespace the registry does not know', () => {
    expect(() => requestKey('nope' as 'productCatalog', 'v1-products')).toThrow(/Unknown cache namespace 'nope'/u);
  });
});
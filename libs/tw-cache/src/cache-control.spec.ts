import { wantsFreshData } from './cache-control';

describe('wantsFreshData', () => {
  // Every value a client may legitimately send to say "do not serve me the cached copy".
  it.each([
    ['no-cache'],
    ['no-store'],
    ['NO-CACHE'],
    ['  no-cache  '],
    ['no-cache, no-store'],
    [',no-cache'],
    ['public, no-cache'],
    ['no-cache, max-age=0'],
    ['max-age=60, no-store'],
  ])('reads %j as a demand for fresh data', (header) => {
    expect(wantsFreshData(header)).toBe(true);
  });

  it.each([
    ['an absent header', undefined],
    ['an empty header', ''],
    ['max-age=0 — a cacheability hint, not a revalidation demand', 'max-age=0'],
    ['a near-miss token', 'no-cachefoo'],
    ['a valued directive', 'no-cache="field"'],
    ['an unrelated directive', 'must-revalidate'],
  ])('does not read %s as a demand for fresh data', (_case, header) => {
    expect(wantsFreshData(header)).toBe(false);
  });

  it('tolerates null, because @Headers hands those over for missing headers', () => {
    expect(wantsFreshData(null)).toBe(false);
  });
});
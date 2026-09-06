import { maskBodyForLog, maskHeadersForLog, maskUrlForLog } from './mask-log.util';

describe('maskHeadersForLog', () => {
  it('keeps the auth scheme readable while masking the credential', () => {
    const masked = maskHeadersForLog({ authorization: 'Bearer abcdefghijkl' });
    expect(masked.authorization).toBe('Bearer ab**...**kl');
  });

  it('matches header names case-insensitively', () => {
    expect(maskHeadersForLog({ Authorization: 'Basic abcdefghijkl' }).Authorization).toBe('Basic ab**...**kl');
  });

  it('leaves the trace id alone — it is the whole point of the line', () => {
    expect(maskHeadersForLog({ 'x-trace-id': '01M0J6EYRY4TFEPR9PHJZ1QHPF' })['x-trace-id']).toBe(
      '01M0J6EYRY4TFEPR9PHJZ1QHPF',
    );
  });

  it('masks each element of a repeated header', () => {
    expect(maskHeadersForLog({ 'set-cookie': ['aaaaaaaa', 'bbbbbbbb'] })['set-cookie']).toEqual([
      'aa**...**aa',
      'bb**...**bb',
    ]);
  });
});

describe('maskBodyForLog', () => {
  it('masks known credential fields at the top level', () => {
    expect(maskBodyForLog({ email: 'a@b.com', password: 'hunter2000' })).toEqual({
      email: 'a@b.com',
      password: 'hu**...**00',
    });
  });

  it('masks credential params in a url-encoded body', () => {
    expect(maskBodyForLog('grant_type=client_credentials&client_secret=abcdefghijkl')).toBe(
      'grant_type=client_credentials&client_secret=ab**...**kl',
    );
  });

  it('passes through null and undefined', () => {
    expect(maskBodyForLog(null)).toBeNull();
    expect(maskBodyForLog(undefined)).toBeUndefined();
  });
});

describe('maskUrlForLog', () => {
  it('masks credential query params and leaves the path intact', () => {
    expect(maskUrlForLog('/v1/users?token=abcdefghijkl&page=2')).toBe('/v1/users?token=ab**...**kl&page=2');
  });

  it('leaves business identifiers named `code` readable', () => {
    expect(maskUrlForLog('/v1/countries?code=DE')).toBe('/v1/countries?code=DE');
  });

  it('returns a url with no query unchanged', () => {
    expect(maskUrlForLog('/v1/users')).toBe('/v1/users');
  });
});

import { CACHE_LOGGER } from './constants';
import { CacheConfigurationError } from './errors';
import { CacheModule } from './cache.module';
import { CacheService } from './cache.service';
import { ReadThroughService } from './read-through.service';
import { CacheOptions } from './types';

import type { ICacheOptions } from './types';

const logger = { provide: CACHE_LOGGER, useValue: {} } as unknown as ICacheOptions['logger'];

/** Reads back the options the module actually resolved, as the services will see them. */
function resolvedOptions(options: ICacheOptions): CacheOptions {
  const providers = CacheModule.forRoot(options).providers ?? [];
  const provider = providers.find(
    (candidate) => typeof candidate === 'object' && 'provide' in candidate && candidate.provide === CacheOptions,
  );
  return (provider as { useValue: CacheOptions }).useValue;
}

describe('CacheModule.forRoot', () => {
  it('resolves the defaults an omitted option is meant to fall back to', () => {
    const options = resolvedOptions({ logger });

    expect(options.ttlSeconds).toBe(60);
    expect(options.negativeTtlSeconds).toBe(30);
    expect(options.commandTimeoutMs).toBe(250);
    expect(options.url).toBeUndefined();
  });

  it.each([
    ['zero', 0],
    ['fractional', 2.5],
    ['NaN', Number.NaN],
    ['a string', '250'],
  ])('refuses to boot when commandTimeoutMs is %s', (_case, commandTimeoutMs) => {
    expect(() => resolvedOptions({ logger, commandTimeoutMs } as unknown as ICacheOptions)).toThrow(/commandTimeoutMs/);
  });

  it('keeps the provided configuration as given', () => {
    const options = resolvedOptions({
      logger,
      url: 'redis://cache:6379',
      ttlSeconds: 300,
      negativeTtlSeconds: 15,
    });

    expect(options.url).toBe('redis://cache:6379');
    expect(options.ttlSeconds).toBe(300);
    expect(options.negativeTtlSeconds).toBe(15);
  });

  // The realistic failure: `ttlSeconds: Number(process.env.CACHE_TTL)` where the variable is set
  // to a non-number, or unset with no fallback and Number(undefined) → NaN. Well-typed at compile
  // time, NaN at runtime. A TTL of zero is its own trap: it reads as "no expiry", and an entry
  // that never expires on its own is how a cache starts serving data its owner stopped writing.
  it.each([
    ['zero', 0],
    ['negative', -60],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['a string', '60'],
    ['null', null],
  ])('refuses to boot when ttlSeconds is %s', (_case, ttlSeconds) => {
    expect(() => resolvedOptions({ logger, ttlSeconds } as unknown as ICacheOptions)).toThrow(CacheConfigurationError);
    expect(() => resolvedOptions({ logger, ttlSeconds } as unknown as ICacheOptions)).toThrow(/ttlSeconds/);
  });

  it('refuses a negative cache TTL for the same reason it refuses a positive-looking one', () => {
    expect(() => resolvedOptions({ logger, negativeTtlSeconds: 0 })).toThrow(CacheConfigurationError);
  });

  it.each([
    ['without a scheme', 'cache:6379'],
    ['the wrong scheme', 'http://cache:6379'],
    ['with a space', 'redis://cache:6379 extra'],
    ['empty', ''],
  ])('refuses a cache URL %s', (_case, url) => {
    expect(() => resolvedOptions({ logger, url })).toThrow(/`url` must look like redis:\/\//);
  });

  it.each([
    ['with a port', 'redis://cache:6379'],
    ['without a port', 'redis://cache'],
    ['with credentials', 'redis://users-service:secret@cache:6379'],
    ['TLS', 'rediss://cache:6379'],
  ])('accepts a cache URL %s', (_case, url) => {
    expect(resolvedOptions({ logger, url }).url).toBe(url);
  });

  it('registers and exports both services, globally by default', () => {
    const module = CacheModule.forRoot({ logger });

    expect(module.global).toBe(true);
    expect(module.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: CacheOptions }),
        logger,
        CacheService,
        ReadThroughService,
      ]),
    );
    expect(module.exports).toEqual([CacheService, ReadThroughService]);
  });

  it('lets a module opt out of being global', () => {
    expect(CacheModule.forRoot({ logger, isGlobal: false }).global).toBe(false);
  });
});
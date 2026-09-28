import { Module } from '@nestjs/common';

import { CacheService } from './cache.service';
import { ReadThroughService } from './read-through.service';
import { assertCacheUrl, assertTtlSeconds } from './validate';
import { CacheOptions } from './types';

import type { DynamicModule } from '@nestjs/common';
import type { ICacheOptions } from './types';

/**
 * Registers the shared-cache client.
 *
 * ```ts
 * CacheModule.forRoot({
 *   url: process.env.CACHE_URL,                        // unset → in-process store
 *   ttlSeconds: Number(process.env.CACHE_TTL ?? 60),    // seconds; the only TTL unit
 *   logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
 * })
 * ```
 *
 * Configuration is validated here, at registration, and a bad value throws a
 * `CacheConfigurationError` instead of booting a service whose cache behaves differently from
 * what its configuration says. Global by default, for the same reason the logger and the HTTP
 * connector are: a cache that has to be imported into every feature module is a cache people
 * stop consulting, and read-through with a per-module TTL is how one service ends up holding
 * entries for an hour while its neighbour expires them in a minute.
 */
@Module({})
export class CacheModule {
  static forRoot(options: ICacheOptions): DynamicModule {
    assertTtlSeconds(options.ttlSeconds, 'ttlSeconds');
    assertTtlSeconds(options.negativeTtlSeconds, 'negativeTtlSeconds');
    assertCacheUrl(options.url);

    const resolved: CacheOptions = Object.assign(new CacheOptions(), {
      // Drop explicitly-undefined keys so they fall back to defaults rather than overwriting them.
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    });

    return {
      module: CacheModule,
      providers: [
        { provide: CacheOptions, useValue: resolved },
        options.logger,
        CacheService,
        ReadThroughService,
      ],
      exports: [CacheService, ReadThroughService],
      global: options.isGlobal ?? true,
    };
  }
}
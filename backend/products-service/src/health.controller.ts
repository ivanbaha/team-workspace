import { Controller, Get } from '@nestjs/common';
import { CacheService } from '@tw/cache';
import { Public } from './common/decorators/public.decorator';

import type { CacheStats } from '@tw/cache';

/**
 * Excluded from request logging by default (`DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS`) — the platform
 * probes this every few seconds, and each probe would otherwise be a root span in a trace.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly cache: CacheService) {}

  /**
   * The `cache` block answers "is this service actually caching?" without reading a log: which
   * store is in use, whether an outage currently has it disabled, and the hit/miss/skipped
   * counters — the owner-lookup hits this service lives off are in there.
   */
  @Public()
  @Get()
  check(): { status: string; service: string; cache: CacheStats } {
    return {
      status: 'ok',
      service: process.env.DEPLOYMENT_NAME ?? 'products-service',
      cache: this.cache.stats,
    };
  }
}
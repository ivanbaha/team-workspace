import { Controller, Get } from '@nestjs/common';
import { CacheService } from '@tw/cache';
import { Public } from './common/decorators/public.decorator';

import type { CacheStats } from '@tw/cache';

/**
 * Excluded from request logging by default (`DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS`) — the platform
 * probes this every few seconds, and each probe would otherwise be a root span in a trace.
 *
 * The `cache` block answers "is this service actually caching?" without reading a log. For this
 * service it also answers "is the queue alive?": a climbing `skipped` count with `disabled: true`
 * means the set-backed work queue and the batch lock are gone too, so POSTed recalculations are
 * being refused with 503 rather than silently dropped.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly cache: CacheService) {}

  @Public()
  @Get()
  check(): { status: string; service: string; cache: CacheStats } {
    return {
      status: 'ok',
      service: process.env.DEPLOYMENT_NAME ?? 'products-sync-service',
      cache: this.cache.stats,
    };
  }
}
import { Controller, Get, Headers, Param } from '@nestjs/common';
import { wantsFreshData } from '@tw/cache';
import { StatsService } from './stats.service';

import type { CategoryStats } from './category-stats';

/**
 * Reads a category's aggregate. The cache-control handling mirrors the other owner routes: the
 * header arrives as a method parameter, not bubbled through request-scoped DI, so the freshness
 * demand is visible in the handler signature.
 */
@Controller('v1/category-stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get(':id')
  findOne(@Param('id') id: string, @Headers('cache-control') cacheControl?: string): Promise<CategoryStats> {
    return this.stats.getCategoryStats(id, wantsFreshData(cacheControl));
  }
}
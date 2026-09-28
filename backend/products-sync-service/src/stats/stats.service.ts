import { Injectable, NotFoundException } from '@nestjs/common';
import { ReadThroughService, cacheKeyOrNull } from '@tw/cache';
import { RequestScopedLoggerService } from '@tw/logger';
import { ProductsConnector } from '../connectors/products.connector';

import type { CategoryStats } from './category-stats';

/**
 * Reads the category-stats entries this service owns — through the same readThrough helper a
 * consumer would use, because owning an entity does not change the read contract: check the
 * cache, load on miss, negative-cache a category with no products, honour a caller's no-cache.
 * The TTLs come from the module config (`CACHE_TTL`), not from this file.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly logger: RequestScopedLoggerService,
    private readonly readThrough: ReadThroughService,
    private readonly productsConnector: ProductsConnector,
  ) {}

  /**
   * @param noCache The caller demanded fresh data (`Cache-Control: no-cache`): bypass the read
   *   AND refresh the entry, so the next reader finds the fresh value. The batch drain is the
   *   other thing that refreshes these entries — it does so in bulk, ahead of any reader.
   */
  async getCategoryStats(categoryId: string, noCache: boolean): Promise<CategoryStats> {
    // The category comes from the URL: one that cannot form a key skips the cache and loads
    // straight from the connector, which answers not-found — not a 500 from the key builder.
    const load = () => this.productsConnector.fetchCategoryStats(categoryId);
    const key = cacheKeyOrNull('categoryStats', categoryId);

    const stats = await (key
      ? this.readThrough.readThrough<CategoryStats>({
          key,
          load,
          noCache,
          traceId: this.logger.traceId,
        })
      : load());

    // null here means the load itself proved the category has no products — negative-cached —
    // which is a stable fact, not a transient failure. A 404 with the sentinel stored behind it.
    if (!stats) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Category ${categoryId} has no products, so it has no stats`,
      });
    }
    return stats;
  }
}
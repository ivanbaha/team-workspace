import { Injectable } from '@nestjs/common';
import { RequestScopedHttpConnectionService } from '@tw/http-connector';
import { RequestScopedLoggerService } from '@tw/logger';
import { CategoryStats, Envelope, ProductLike, computeCategoryStats } from '../stats/category-stats';

const CONTEXT = 'ProductsConnector';

/**
 * Request-scoped client for products-service, used by the on-demand stats read.
 *
 * This is the first half of the two-connector pattern (see the @tw/http-connector README): it runs
 * inside a request, so it inherits the caller's trace id and forwarded headers and needs none of
 * that plumbing here. The scheduled batch in `RecalculationsService` is the other half — it runs
 * outside request scope and uses the singleton connector with explicit derived trace ids.
 */
@Injectable()
export class ProductsConnector {
  private readonly productsUrl = process.env.PRODUCTS_SERVICE_URL ?? 'http://localhost:4002';

  constructor(
    private readonly http: RequestScopedHttpConnectionService,
    private readonly logger: RequestScopedLoggerService,
  ) {}

  /**
   * Fetches a category's products and computes the aggregate from them.
   *
   * Errors propagate rather than mapping to `null`: a failing products-service is not "no stats",
   * and swallowing it would negative-cache a category that might exist. A category with no
   * products legitimately produces `null` — that is what gets negative-cached, so repeated asks
   * for a missing category cost one internal call, not one per request.
   */
  async fetchCategoryStats(categoryId: string): Promise<CategoryStats | null> {
    const response = await this.http.connect<Envelope<ProductLike[]>>({
      url: `${this.productsUrl}/v1/products`,
      method: 'GET',
      params: { category: categoryId },
    });

    this.logger.debug(
      `Computed stats for category ${categoryId} from ${response.data.length} product(s)`,
      `${CONTEXT}.fetchCategoryStats`,
    );
    return computeCategoryStats(categoryId, response.data);
  }
}
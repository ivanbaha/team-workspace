import { Module } from '@nestjs/common';
import { ProductsConnector } from '../connectors/products.connector';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

/**
 * The on-demand read of the entries this service owns. `ReadThroughService` and
 * `RequestScopedHttpConnectionService` arrive from the global modules; the connector is
 * request-scoped like any in-request client — it is the scheduled batch that needs the
 * singleton half of the two-connector pattern.
 */
@Module({
  controllers: [StatsController],
  providers: [StatsService, ProductsConnector],
})
export class StatsModule {}
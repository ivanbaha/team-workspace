import { Module } from '@nestjs/common';
import { RecalculationsController } from './recalculations.controller';
import { RecalculationsService } from './recalculations.service';

/**
 * The queue consumer. `CacheService` and the singleton `HttpConnectionService` arrive from the
 * global modules; taking the singleton connector here is the point — the batch runs outside
 * request scope, and the service supplies trace ids explicitly.
 */
@Module({
  controllers: [RecalculationsController],
  providers: [RecalculationsService],
})
export class RecalculationsModule {}
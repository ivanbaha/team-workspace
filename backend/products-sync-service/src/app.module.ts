import { Module } from '@nestjs/common';
import { CACHE_LOGGER, CacheModule } from '@tw/cache';
import { HC_LOGGER, HttpConnectionModule } from '@tw/http-connector';
import { LoggerModule, LoggerService } from '@tw/logger';
import { TracingModule } from '@tw/tracing';

import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { RecalculationsModule } from './recalculations/recalculations.module';
import { StatsModule } from './stats/stats.module';

const SERVICE_NAME = process.env.DEPLOYMENT_NAME ?? 'products-sync-service';

@Module({
  imports: [
    TracingModule.forRoot(),
    LoggerModule.forRoot(),
    HttpConnectionModule.forRoot({
      userAgent: SERVICE_NAME,
      // This service both answers requests (the stats endpoint) and runs a scheduled batch
      // consumer outside request scope, so it names the full forwarded list explicitly: naming
      // `cache-control` keeps a caller's freshness demand alive when the stats load hops to
      // products-service. The list replaces the connector default — omit a name and it stops
      // being forwarded on this hop.
      forwardHeaders: ['accept-language', 'authorization', 'cache-control'],
      logger: { provide: HC_LOGGER, useExisting: LoggerService },
    }),
    CacheModule.forRoot({
      url: process.env.CACHE_URL,
      // Stats entries are aggregates; they are allowed to live longer than a user profile.
      // `Number(undefined)` is NaN, and NaN fails the lib's config validation at boot — an unset
      // CACHE_TTL cannot silently become a zero TTL.
      ttlSeconds: Number(process.env.CACHE_TTL ?? 300),
      logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
    }),
    RecalculationsModule,
    StatsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
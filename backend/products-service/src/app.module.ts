import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule, CACHE_LOGGER } from '@tw/cache';
import { HC_LOGGER, HttpConnectionModule } from '@tw/http-connector';
import { LoggerModule, LoggerService } from '@tw/logger';
import { TracingModule } from '@tw/tracing';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { HealthController } from './health.controller';
import { ProductsModule } from './products/products.module';

const SERVICE_NAME = process.env.DEPLOYMENT_NAME ?? 'products-service';

@Module({
  imports: [
    TracingModule.forRoot(),
    LoggerModule.forRoot(),
    HttpConnectionModule.forRoot({
      // Sent as User-Agent on every outbound call, and recorded by the receiving service as
      // `caller`. It is the only thing that creates an edge in a trace, so it is read from the same
      // environment variable the logger uses for `serviceName` — the two must never drift apart.
      userAgent: SERVICE_NAME,
      // The caller's bearer token is forwarded to users-service, which verifies it itself — the
      // token is issued by users-service and valid across the workspace, so there is no separate
      // service identity to manage. Only headers named here are forwarded; everything else on the
      // inbound request (cookies included) stays put.
      //
      // cache-control is named explicitly because this list *replaces* the connector's default —
      // the default already carries it, but a service that overrides the list and forgets it
      // silently drops every caller's freshness demand at this hop. Naming it here keeps the
      // `no-cache` contract alive past this service even if the default list changes.
      forwardHeaders: ['accept-language', 'authorization', 'cache-control'],
      logger: { provide: HC_LOGGER, useExisting: LoggerService },
    }),
    // The shared cache, in the consumer role: this service READS the user entries that
    // users-service owns and never writes them. Same server as every participant — a write there
    // is a hit here — connected with a read-only cache user in the cluster.
    CacheModule.forRoot({
      url: process.env.CACHE_URL,
      ttlSeconds: Number(process.env.CACHE_TTL ?? 60),
      logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
    }),
    ProductsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

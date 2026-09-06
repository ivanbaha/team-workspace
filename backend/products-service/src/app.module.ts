import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
      forwardHeaders: ['accept-language', 'authorization'],
      logger: { provide: HC_LOGGER, useExisting: LoggerService },
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

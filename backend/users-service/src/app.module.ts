import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule, CACHE_LOGGER } from '@tw/cache';
import { LoggerModule, LoggerService } from '@tw/logger';
import { TracingModule } from '@tw/tracing';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Adopting distributed tracing is these two imports. TracingModule seeds `x-trace-id` in
    // middleware — before guards and before every interceptor — and LoggerModule puts it on every
    // log line and emits the request/response pair that traces are reconstructed from.
    TracingModule.forRoot(),
    LoggerModule.forRoot(),
    // The shared cache. This service owns the `user` entries: read-through on the read path,
    // invalidation after every write. The URL is the environment's call — unset means the
    // in-process store, which is right locally and wrong in a cluster; the boot log says which
    // one is running. `Number(process.env.CACHE_TTL ?? 60)` keeps the one TTL unit (seconds) and
    // the fallback in one place: an unset variable without the ?? is NaN, and NaN is a
    // configuration error the module throws at boot rather than caching with.
    CacheModule.forRoot({
      url: process.env.CACHE_URL,
      ttlSeconds: Number(process.env.CACHE_TTL ?? 60),
      logger: { provide: CACHE_LOGGER, useExisting: LoggerService },
    }),
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

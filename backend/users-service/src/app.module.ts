import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from '@tw/logger';
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

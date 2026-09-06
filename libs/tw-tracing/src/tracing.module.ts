import { Module } from '@nestjs/common';
import { traceIdMiddleware } from './trace-id.middleware';

import type { DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { TraceIdMiddlewareOptions } from './trace-id.middleware';

/**
 * Adopting distributed tracing, in one import.
 *
 * ```ts
 * @Module({ imports: [TracingModule.forRoot(), LoggerModule.forRoot()] })
 * export class AppModule {}
 * ```
 *
 * Applies the seeding middleware to every route, which is what guarantees the trace id exists
 * before any guard or interceptor runs — see
 * [`traceIdMiddleware`](./trace-id.middleware.ts) for why that ordering matters.
 *
 * Import it in **every** service, not only the ones at the edge. A service that cannot seed an id
 * logs nothing correlatable when something calls it directly, and direct calls — cron jobs, queue
 * consumers, an engineer with curl — are exactly the traffic nobody thinks about until it breaks.
 */
@Module({})
export class TracingModule implements NestModule {
  private static options: TraceIdMiddlewareOptions | undefined;

  static forRoot(options?: TraceIdMiddlewareOptions): DynamicModule {
    TracingModule.options = options;
    return { module: TracingModule, global: true };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(traceIdMiddleware(TracingModule.options)).forRoutes('*');
  }
}

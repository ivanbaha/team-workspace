import { Inject, Injectable, Optional } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { getTraceId } from '@tw/tracing';
import { BASE_LOGGER } from './constants';

import type { LoggerService } from './logger.service';
import type { ITraceLogger } from './types';

/**
 * The logger application code should inject. It fills in the trace id so no caller has to.
 *
 * ## How the id gets here
 *
 * There is no `AsyncLocalStorage`, no continuation-local storage, and no explicit
 * `Scope.REQUEST` declaration. Injecting the `REQUEST` token is the entire opt-in: NestJS promotes
 * any provider that depends on `REQUEST` to request scope automatically, and that scope propagates
 * to every provider that depends on *it*. So a service injecting this logger becomes request-scoped
 * too, and reads the trace id off the very headers object
 * [`traceIdMiddleware`](../../tw-tracing/src/trace-id.middleware.ts) seeded.
 *
 * ## Why this is cheap
 *
 * This class holds no state and does no work — it forwards to the singleton behind `BASE_LOGGER`.
 * Only this paper-thin wrapper is constructed per request; the configured, level-filtering logger
 * is instantiated once for the process. That is what makes request scope affordable here.
 *
 * ## The three limits, which are designed rather than accidental
 *
 * 1. **Opt-in per injection site.** Code that injects `LoggerService` directly still has to pass
 *    `traceId` by hand. Automatic behaviour belongs to this class alone.
 * 2. **`@Optional()` is load-bearing.** Outside an HTTP request — a cron tick, `onModuleInit`,
 *    bootstrap — the `REQUEST` token cannot resolve. `@Optional()` turns that into
 *    `req === undefined` instead of a DI failure, and `traceId` silently becomes `undefined`.
 *    Silent is the right behaviour: a logger that throws during startup is worse than a log line
 *    with no id.
 * 3. **It does not survive an async boundary.** The context is DI-scoped, not ambient, so work
 *    deferred past the response — a floating promise, a message handed to a broker — loses it. Such
 *    work must carry the id explicitly, which is why the id belongs in message payloads.
 */
@Injectable()
export class RequestScopedLoggerService implements ITraceLogger {
  constructor(
    @Inject(BASE_LOGGER) private readonly logger: LoggerService,
    @Optional() @Inject(REQUEST) readonly req?: Record<string, unknown>,
  ) {}

  info(message: string, context?: string): void {
    this.logger.info(message, context, this.traceId);
  }

  /** Alias for {@link info}, matching the NestJS `LoggerService` interface. */
  log(message: string, context?: string): void {
    this.logger.info(message, context, this.traceId);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.error(message, trace, context, this.traceId);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, context, this.traceId);
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, context, this.traceId);
  }

  verbose(message: string, context?: string): void {
    this.logger.verbose(message, context, this.traceId);
  }

  silly(message: string, context?: string): void {
    this.logger.silly(message, context, this.traceId);
  }

  /**
   * The current request's trace id.
   *
   * A getter rather than a constructor field so that an id seeded *after* this provider was
   * constructed is still picked up — interceptor ordering is not something a logger should depend on.
   */
  get traceId(): string | undefined {
    return getTraceId(this.req);
  }
}

import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerConfigService } from './config';
import { BASE_LOGGER } from './constants';
import { LoggerService } from './logger.service';
import { DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS } from './request-logging.constants';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { RequestScopedLoggerService } from './request-scoped-logger.service';

import type { DynamicModule } from '@nestjs/common';
import type { LoggerModuleOptions } from './request-logging.types';

/** Used when request logging is switched off, so the interceptor slot stays uniformly filled. */
const NOOP_INTERCEPTOR = { intercept: (_ctx: unknown, next: { handle: () => unknown }) => next.handle() };

/**
 * Wires the logger and, with it, the request/response log pair that traces are built from.
 *
 * ```ts
 * @Module({ imports: [LoggerModule.forRoot()] })
 * export class AppModule {}
 * ```
 *
 * `@Global()` because a logger is needed in every module and threading an import through all of
 * them is noise that discourages logging.
 *
 * The provider set is the pattern worth copying: one singleton doing the work, aliased under
 * `BASE_LOGGER` with `useExisting`, and a request-scoped wrapper that holds nothing but a reference
 * to it. `useExisting` — not `useClass` — is what keeps the per-request cost to one small object.
 */
@Global()
@Module({})
export class LoggerModule {
  static forRoot(options?: LoggerModuleOptions): DynamicModule {
    const excludePaths = options?.requestLoggingExcludePaths ?? DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS;

    return {
      module: LoggerModule,
      providers: [
        LoggerConfigService,
        LoggerService,
        { provide: BASE_LOGGER, useExisting: LoggerService },
        RequestScopedLoggerService,
        {
          // Registered here rather than in main.ts so that importing the module is the whole
          // adoption step. A service cannot end up logging without the records a trace needs.
          provide: APP_INTERCEPTOR,
          useFactory: (configService: LoggerConfigService, logger: LoggerService) => {
            const mode = configService.config.requestLogging;
            return mode === 'off' ? NOOP_INTERCEPTOR : new RequestLoggingInterceptor(logger, excludePaths, mode);
          },
          inject: [LoggerConfigService, LoggerService],
        },
      ],
      exports: [LoggerService, RequestScopedLoggerService, LoggerConfigService],
    };
  }
}

import { Module } from '@nestjs/common';
import { BASE_HTTP_CONNECTOR, DEFAULT_FORWARD_HEADERS } from './constants';
import { HttpConnectionService } from './http-connection.service';
import { RequestScopedHttpConnectionService } from './request-scoped-http-connection.service';
import { HttpConnectionOptions } from './types';

import type { DynamicModule } from '@nestjs/common';
import type { IHttpConnectionOptions } from './types';

/**
 * Registers the outbound connector.
 *
 * ```ts
 * HttpConnectionModule.forRoot({
 *   userAgent: 'orders-service',              // must equal DEPLOYMENT_NAME
 *   logger: { provide: HC_LOGGER, useExisting: LoggerService },
 * })
 * ```
 *
 * Same singleton/wrapper split as `LoggerModule`: one connector holding the retry policy and the
 * logger, aliased under `BASE_HTTP_CONNECTOR`, and a thin request-scoped wrapper that inherits the
 * trace id. Global by default, because outbound calls happen in every feature module and threading
 * an import through all of them is the kind of friction that ends in a bare `fetch()` — which
 * propagates nothing.
 */
@Module({})
export class HttpConnectionModule {
  static forRoot(options: IHttpConnectionOptions): DynamicModule {
    const resolved: HttpConnectionOptions = Object.assign(new HttpConnectionOptions(), {
      forwardHeaders: DEFAULT_FORWARD_HEADERS,
      // Drop explicitly-undefined keys so they fall back to defaults rather than overwriting them.
      ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
    });

    return {
      module: HttpConnectionModule,
      providers: [
        { provide: HttpConnectionOptions, useValue: resolved },
        options.logger,
        HttpConnectionService,
        { provide: BASE_HTTP_CONNECTOR, useExisting: HttpConnectionService },
        RequestScopedHttpConnectionService,
      ],
      exports: [HttpConnectionService, RequestScopedHttpConnectionService],
      global: options.isGlobal ?? true,
    };
  }
}

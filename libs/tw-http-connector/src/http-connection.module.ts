import { Module } from '@nestjs/common';
import { BASE_HTTP_CONNECTOR, DEFAULT_FORWARD_HEADERS, NON_FORWARDABLE_HEADERS } from './constants';
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
    assertIdentity(options.userAgent);
    assertForwardable(options.forwardHeaders);

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

/**
 * Fails registration when the service has no identity to send.
 *
 * `userAgent` is already required by `IHttpConnectionOptions`, so this cannot be reached from
 * well-typed TypeScript — which is exactly why it is worth having. The realistic route in is
 * `userAgent: process.env.DEPLOYMENT_NAME` in a service whose deployment does not set the variable:
 * the type is satisfied at compile time, the value is `undefined` at runtime, `forRoot` drops
 * explicitly-undefined keys so no default fills it in, and every outbound call goes out identifying
 * itself as `"undefined"`. Nothing throws, every log line still validates, and the service silently
 * disappears from the call graph of every trace it takes part in.
 *
 * Failing at boot is the only cheap detection point. The alternative is noticing months later that
 * one service's calls have always been orphaned roots.
 *
 * @throws {Error} When the identity is missing, not a string, or blank.
 */
function assertIdentity(userAgent: unknown): asserts userAgent is string {
  if (typeof userAgent === 'string' && userAgent.trim() !== '') return;

  throw new Error(
    `HttpConnectionModule.forRoot() requires a non-empty \`userAgent\`, received ${JSON.stringify(userAgent)}. ` +
      'It is sent as User-Agent on every outbound call and recorded by the receiving service as `caller` — ' +
      'the only edge information a trace has. It must equal the name this service logs under: ' +
      "`userAgent: process.env.DEPLOYMENT_NAME ?? '<service-name>'`.",
  );
}

/**
 * Rejects a `forwardHeaders` list that would fight the connector for a contract header.
 *
 * Both contract headers are written unconditionally at the end of header assembly. Forwarding one
 * as well means the inbound value and the connector's own value target the same header — the
 * browser's `Mozilla/5.0…` competing with the service identity — and the receiving service records
 * whichever wins as `caller`. The resulting trace is not empty or obviously broken; it is subtly
 * wrong, which is worse.
 *
 * @throws {Error} When the list names a header that has its own dedicated path.
 */
function assertForwardable(forwardHeaders: string[] | undefined): void {
  if (!forwardHeaders) return;

  const reserved = forwardHeaders.filter((name) => NON_FORWARDABLE_HEADERS.includes(name.trim().toLowerCase()));
  if (reserved.length === 0) return;

  throw new Error(
    `HttpConnectionModule.forRoot() cannot forward ${reserved.join(', ')}. ` +
      'Those headers carry the tracing contract and the connector sets them itself on every call, ' +
      'so forwarding them would put two competing values in one header and break the trace edges.',
  );
}

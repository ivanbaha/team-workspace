import { Inject, Injectable, Optional } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { getTraceId } from '@tw/tracing';
import { BASE_HTTP_CONNECTOR } from './constants';
import { objectKeysToLowerCase } from './utils';

import type { HttpConnectionService } from './http-connection.service';
import type { ConnectOptions, HttpResponse } from './types';
import { HttpConnectionOptions } from './types';

/**
 * The connector application code should inject. It carries the current request's trace id to the
 * next service without being told.
 *
 * Same mechanism as `RequestScopedLoggerService`: injecting the `REQUEST` token puts this provider
 * in request scope, and it reads the id off the very headers object the seeding interceptor wrote
 * to. It holds no state and does no work — every call is delegated to the singleton behind
 * `BASE_HTTP_CONNECTOR`.
 *
 * Because the propagated id is the *same* id, the receiving service's log lines land under it too.
 * That is the whole of distributed tracing here: one value, forwarded, logged at both ends.
 */
@Injectable()
export class RequestScopedHttpConnectionService {
  constructor(
    private readonly options: HttpConnectionOptions,
    @Inject(BASE_HTTP_CONNECTOR) private readonly baseConnector: HttpConnectionService,
    @Optional() @Inject(REQUEST) private readonly req?: Record<string, unknown>,
  ) {}

  /**
   * Performs an outbound request, inheriting the inbound trace id and any configured
   * forward headers.
   *
   * @param params - Same options as the base connector. An explicit `traceId` wins over the
   *   inherited one, which is what lets a handler fan out under derived ids.
   */
  async connect<RT = unknown, DT = undefined, B extends boolean = false>(
    params: ConnectOptions<B, DT>,
  ): Promise<B extends true ? HttpResponse<RT> : RT> {
    const inbound = (this.req?.headers ?? {}) as Record<string, string | undefined>;

    const forwarded: Record<string, string> = {};
    for (const name of this.options.forwardHeaders) {
      const key = name.toLowerCase();
      const value = inbound[key];
      if (value !== undefined) forwarded[key] = value;
    }

    return this.baseConnector.connect<RT, DT, B>({
      ...params,
      // The entire inbound-to-outbound propagation, in one line. An explicit id wins; inheritance
      // is the fallback, never an override.
      ...(!params.traceId && { traceId: getTraceId(this.req) }),
      // Headers the caller passed explicitly outrank forwarded ones.
      headers: { ...forwarded, ...objectKeysToLowerCase(params.headers) },
    });
  }

  /** The trace id this connector will attach, or `undefined` outside a request. */
  get traceId(): string | undefined {
    return getTraceId(this.req);
  }
}

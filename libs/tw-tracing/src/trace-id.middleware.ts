import { TRACE_ID_HEADER } from './constants';
import { ensureTraceId } from './trace-id';

import type { RequestLike } from './trace-id';

interface ResponseLike {
  setHeader?: (name: string, value: string) => unknown;
  header?: (name: string, value: string) => unknown;
}

export interface TraceIdMiddlewareOptions {
  /**
   * Echo the trace id back to the caller as a response header.
   *
   * Worth leaving on. It is what lets someone paste an id out of their browser's network tab into a
   * bug report, and what lets an end-to-end test assert against the trace of the request it just
   * made — neither of which is possible when the id exists only in server-side logs.
   *
   * @default true
   */
  echoResponseHeader?: boolean;
}

/**
 * Seeds `x-trace-id` on every inbound request that does not already carry one.
 *
 * This is the whole of the generation half of the design, and it is **middleware rather than an
 * interceptor for a reason worth knowing**. The NestJS request lifecycle runs middleware → guards →
 * interceptors → pipes → handler, and two things depend on the id existing before interceptors:
 *
 * - The request-logging interceptor in `@tw/logger` is registered through `APP_INTERCEPTOR`, which
 *   NestJS pushes onto the global interceptor list during `NestFactory.create()` — *before* anything
 *   added later by `app.useGlobalInterceptors()`. An interceptor-based seed therefore runs second,
 *   and the incoming/outgoing pair for a request that arrived without an id would be logged without
 *   one. That is exactly the first hop of every trace.
 * - Guards run before interceptors at all. A request rejected by an auth guard never reaches an
 *   interceptor, so an interceptor-based seed leaves 401s and 403s untraceable.
 *
 * Middleware is the only stage that runs before both.
 *
 * `TracingModule.forRoot()` applies this for you; `app.use(traceIdMiddleware())` is the equivalent
 * for a service that would rather wire it explicitly.
 */
export function traceIdMiddleware(options?: TraceIdMiddlewareOptions) {
  const echo = options?.echoResponseHeader ?? true;

  return function traceId(req: RequestLike, res: ResponseLike, next: () => void): void {
    // Mutates req.headers in place — everything downstream reads that same object.
    const id = ensureTraceId(req);

    if (echo) {
      // Express exposes setHeader; Fastify exposes header. Neither is guaranteed in unit tests.
      if (typeof res?.setHeader === 'function') res.setHeader(TRACE_ID_HEADER, id);
      else if (typeof res?.header === 'function') res.header(TRACE_ID_HEADER, id);
    }

    next();
  };
}

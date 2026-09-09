import { getTraceId } from '@tw/tracing';
import { tap } from 'rxjs';
import { DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS } from './request-logging.constants';
import { maskBodyForLog, maskHeadersForLog, maskUrlForLog } from './utils';

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { RequestLoggingMode } from './config';
import type { LoggerService } from './logger.service';

interface OutgoingLogContext {
  method: string;
  path: string;
  url: string;
  res: any;
  traceId?: string;
  logContext: string;
  startTime: number;
  responseBody?: unknown;
  error?: unknown;
}

/**
 * Resolves the status code of a failed request.
 *
 * The exception filter has not written the response yet when the interceptor observes the error, so
 * `res.statusCode` is still the framework default. The real status has to come off the exception.
 */
function resolveErrorStatus(error: any, res: any): number {
  if (typeof error?.getStatus === 'function') {
    const status = error.getStatus();
    if (typeof status === 'number') return status;
  }
  if (typeof error?.status === 'number') return error.status;
  if (typeof error?.statusCode === 'number') return error.statusCode;

  const current: number | undefined = res?.statusCode ?? res?.raw?.statusCode;
  return current && current >= 400 ? current : 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

/**
 * Emits the paired `request.in` / `response.out` records that turn a set of correlated log lines into a
 * call graph.
 *
 * A trace id alone only *groups* lines. What makes them a graph is this pair:
 *
 * ```json
 * {"direction":"request.in","method":"GET","path":"/v1/users/1","caller":"products-service"}
 * {"direction":"response.out","method":"GET","path":"/v1/users/1","statusCode":200,"duration":124}
 * ```
 *
 * **Both lines describe the server side of one request**, and the `direction` values say so
 * explicitly. The noun comes first because the direction alone is ambiguous: a response this
 * service sends and a request this service makes are both, in plain English, "outgoing".
 *
 * | Value | Written by | Means |
 * |---|---|---|
 * | `request.in` | this interceptor | a request arrived here |
 * | `response.out` | this interceptor | this service answered it |
 * | `request.out` | `@tw/http-connector` | this service called someone else |
 * | `response.in` | `@tw/http-connector` | that call came back |
 *
 * Only the first two build spans. The connector's pair is logged at `silly` and is diagnostic.
 *
 * Three consequences worth knowing:
 *
 * - **`caller` is the forwarded `user-agent`, and it is the only edge information that exists.**
 *   There is no parent span id. A service whose `User-Agent` disagrees with the name it logs under
 *   produces edges that cannot be matched to any node, and the trace shows an orphaned root.
 * - **`duration` is measured in-process**, between this interceptor seeing the request and seeing
 *   the response, so it is immune to clock skew between pods. It is not network time.
 * - **The payload is a JSON document nested inside `message`.** Any consumer parses twice. That
 *   keeps the outer envelope one fixed shape for every log line in the system.
 *
 * Registered automatically by `LoggerModule.forRoot()` — services do not wire this up themselves.
 */
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly excludePaths: string[];

  constructor(
    private readonly logger: LoggerService,
    excludePaths?: string[],
    private readonly mode: RequestLoggingMode = 'compact',
  ) {
    this.excludePaths = excludePaths ?? DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.mode === 'off') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    const method: string = req.method;
    const url: string = req.url ?? req.raw?.url ?? '';
    const path: string = url.split('?')[0];
    const traceId = getTraceId(req);

    if (this.isExcluded(path)) return next.handle();

    const logContext = `${method} ${path}`;
    const startTime = Date.now();

    if (this.mode === 'full') {
      this.logger.verbose(
        JSON.stringify({
          direction: 'request.in',
          method,
          url: maskUrlForLog(url),
          caller: req.headers?.['user-agent'],
          headers: maskHeadersForLog(req.headers),
          body: maskBodyForLog(req.body),
        }),
        logContext,
        traceId,
      );
    } else {
      this.logger.info(
        JSON.stringify({ direction: 'request.in', method, path, caller: req.headers?.['user-agent'] }),
        logContext,
        traceId,
      );
    }

    const shared = { method, path, url, res, traceId, logContext, startTime };

    return next.handle().pipe(
      tap({
        next: (responseBody) => this.logOutgoing({ ...shared, responseBody }),
        // Without this branch a failed request emits no response.out record at all — so the requests
        // most worth tracing would be the ones missing their status code and duration.
        error: (error) => this.logOutgoing({ ...shared, error }),
      }),
    );
  }

  private logOutgoing({
    method,
    path,
    url,
    res,
    traceId,
    logContext,
    startTime,
    responseBody,
    error,
  }: OutgoingLogContext): void {
    const duration = Date.now() - startTime;
    const statusCode = error ? resolveErrorStatus(error, res) : (res?.statusCode ?? res?.raw?.statusCode);

    if (this.mode === 'full') {
      this.logger.verbose(
        JSON.stringify({
          direction: 'response.out',
          method,
          url: maskUrlForLog(url),
          statusCode,
          headers: maskHeadersForLog(res?.getHeaders?.() ?? {}),
          body: error ? { error: errorMessage(error) } : maskBodyForLog(responseBody),
          duration,
        }),
        logContext,
        traceId,
      );
      return;
    }

    this.logger.info(
      JSON.stringify({ direction: 'response.out', method, path, statusCode, duration }),
      logContext,
      traceId,
    );
  }

  private isExcluded(path: string): boolean {
    return this.excludePaths.some((excluded) => path === excluded || path.endsWith(excluded));
  }
}

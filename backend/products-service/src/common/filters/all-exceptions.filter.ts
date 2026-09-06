import { ArgumentsHost, Catch, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LoggerService } from '@tw/logger';
import { getTraceId } from '@tw/tracing';

import type { ExceptionFilter } from '@nestjs/common';

interface ErrorEnvelope {
  code: string;
  message: string;
}

/**
 * Turns any thrown value into the workspace's `{ data, error }` envelope, and logs it under the
 * request's trace id.
 *
 * This filter is the only thing that logs failures rejected before the handler runs — a guard
 * throwing a 401, a pipe rejecting a malformed body. Those never reach the request-logging
 * interceptor, so without this they would be invisible in a trace.
 *
 * It injects the **singleton** logger and reads the trace id off the request by hand rather than
 * injecting the request-scoped one: exception filters are instantiated once, outside request scope.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = this.toEnvelope(exception, status);
    const traceId = getTraceId(request);
    const context = `${request?.method} ${String(request?.url ?? '').split('?')[0]}`;

    // 5xx is ours and gets a stack; 4xx is the caller's and would drown the logs at warn level.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${error.code}: ${error.message}`,
        exception instanceof Error ? exception.stack : undefined,
        context,
        traceId,
      );
    } else {
      this.logger.warn(`${status} ${error.code}: ${error.message}`, context, traceId);
    }

    response.status(status).json({ data: null, error });
  }

  private toEnvelope(exception: unknown, status: number): ErrorEnvelope {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      // Thrown as `new NotFoundException({ code, message })` — the shape this service uses.
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const typed = body as Partial<ErrorEnvelope>;
        return { code: typed.code ?? 'ERROR', message: typed.message ?? exception.message };
      }

      // Propagated from an upstream service by the HTTP connector, still in the workspace
      // envelope. Unwrapping it keeps the original code and message instead of flattening every
      // upstream failure into "Http Exception".
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const upstream = (body as { error?: Partial<ErrorEnvelope> | null }).error;
        if (upstream?.code) {
          return { code: upstream.code, message: upstream.message ?? exception.message };
        }
      }

      // Thrown by NestJS itself — a validation pipe, a 404 for an unmatched route.
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : exception.message;

      return { code: this.defaultCodeFor(status), message };
    }

    // Never leak an unexpected error's text to the caller; it is in the logs, under the trace id.
    return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }

  private defaultCodeFor(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      504: 'UPSTREAM_TIMEOUT',
    };
    return codes[status] ?? 'ERROR';
  }
}

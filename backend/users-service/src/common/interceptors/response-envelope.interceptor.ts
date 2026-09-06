import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';

import type { Observable } from 'rxjs';

/**
 * Wraps every successful response in the workspace's `{ data, error }` envelope.
 *
 * See [API Contracts](../../../../../docs/architecture/api-contracts.md). The error half of the
 * envelope is produced by `AllExceptionsFilter`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ data: data ?? null, error: null })));
  }
}

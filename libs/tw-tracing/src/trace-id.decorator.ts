import { createParamDecorator } from '@nestjs/common';
import { getTraceId } from './trace-id';

import type { ExecutionContext } from '@nestjs/common';

/**
 * Controller parameter decorator exposing the current request's trace id.
 *
 * Needed far less often than it looks: the logger and the HTTP connector already inherit the id
 * without being told, so a handler that only logs and calls other services never touches it. Reach
 * for this when the id has to leave the request — persisted onto a record, embedded in a message
 * payload, or returned to the caller so a support ticket can quote it.
 *
 * @example
 * @Post()
 * create(@Body() dto: CreateOrderDto, @TraceId() traceId: string) {
 *   return this.orders.create(dto, traceId); // stored on the order for later correlation
 * }
 */
export const TraceId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  return getTraceId(ctx.switchToHttp().getRequest());
});

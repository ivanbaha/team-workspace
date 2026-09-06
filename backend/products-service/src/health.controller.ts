import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

/**
 * Excluded from request logging by default (`DEFAULT_REQUEST_LOGGING_EXCLUDE_PATHS`) — the platform
 * probes this every few seconds, and each probe would otherwise be a root span in a trace.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string; service: string } {
    return { status: 'ok', service: process.env.DEPLOYMENT_NAME ?? 'products-service' };
  }
}

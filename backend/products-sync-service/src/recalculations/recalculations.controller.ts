import { Body, Controller, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { CacheUnavailableError } from '@tw/cache';
import { RequestRecalculationDto } from './dto/request-recalculation.dto';
import { QueueFullError, RecalculationsService } from './recalculations.service';

/**
 * Accepts work into the recalculations queue.
 *
 * 202, not 200: the request asks for a recomputation that has not happened yet — the drain is
 * scheduled, and the response says how much of the work was newly queued. The 503 mappings live
 * in the controller because they are HTTP concerns, not queue concerns: the queue refuses work
 * while the cache cannot confirm the add (`addToSet` fails closed), and refuses work that would
 * take it past its cap — and reporting "accepted" for either would be a lie the client never
 * retries. The messages say the retry is required, and that it is safe.
 */
@Controller('v1/recalculations')
export class RecalculationsController {
  constructor(private readonly recalculations: RecalculationsService) {}

  @Post()
  @HttpCode(202)
  async requestRecalculation(
    @Body() dto: RequestRecalculationDto,
  ): Promise<{ queued: number; scheduled: boolean }> {
    try {
      return await this.recalculations.requestRecalculation(dto.categoryIds);
    } catch (error) {
      if (error instanceof CacheUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'CACHE_UNAVAILABLE',
          message:
            'The shared cache did not confirm the enqueue, so the request is not accepted. Retry when the cache is ' +
            'back — re-sending a category that did get queued is harmless, because the queue deduplicates.',
        });
      }
      if (error instanceof QueueFullError) {
        throw new ServiceUnavailableException({
          code: 'QUEUE_FULL',
          message: `${error.message} Nothing was enqueued — retry once the queue has drained.`,
        });
      }
      throw error;
    }
  }
}

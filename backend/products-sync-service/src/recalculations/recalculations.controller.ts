import { Body, Controller, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { CacheUnavailableError } from '@tw/cache';
import { RequestRecalculationDto } from './dto/request-recalculation.dto';
import { RecalculationsService } from './recalculations.service';

/**
 * Accepts work into the recalculations queue.
 *
 * 202, not 200: the request asks for a recomputation that has not happened yet — the drain is
 * scheduled, and the response says how much of the work was newly queued. The 503 mapping lives
 * in the controller because it is an HTTP concern, not a queue concern: the queue refuses work
 * while the cache is down (`addToSet` fails closed), and reporting "accepted" for work that was
 * never stored would lose it silently — the message says exactly that, so an operator reading the
 * response knows the retry is required, not optional.
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
            'The shared cache is unreachable, so the recalculations queue cannot accept work. Nothing was enqueued — retry when the cache is back.',
        });
      }
      throw error;
    }
  }
}
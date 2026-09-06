import { Injectable } from '@nestjs/common';
import { RequestScopedHttpConnectionService } from '@tw/http-connector';
import { RequestScopedLoggerService } from '@tw/logger';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

/** users-service answers in the workspace envelope; only `data` is of interest here. */
interface Envelope<T> {
  data: T;
  error: null | { code: string; message: string };
}

const CONTEXT = 'UsersConnector';

/**
 * Calls users-service.
 *
 * This is the hop that makes the trace distributed, and the notable thing about the code is what it
 * does not contain. There is no trace id, no header assembly, no context propagation:
 * `RequestScopedHttpConnectionService` reads the id off the inbound request and attaches
 * `x-trace-id` to the outbound call, so users-service logs its side of the exchange under the same
 * id this service is logging under.
 */
@Injectable()
export class UsersConnector {
  private readonly baseUrl = process.env.USERS_SERVICE_URL ?? 'http://localhost:4001';

  constructor(
    private readonly http: RequestScopedHttpConnectionService,
    private readonly logger: RequestScopedLoggerService,
  ) {}

  /**
   * Fetches a product owner.
   *
   * @returns The user, or `null` when users-service does not know them — an unknown owner is a data
   *   inconsistency worth logging, not a reason to fail the caller's request for a product.
   */
  async findOwner(ownerId: string): Promise<PublicUser | null> {
    try {
      const response = await this.http.connect<Envelope<PublicUser>>({
        url: `${this.baseUrl}/v1/users/${ownerId}`,
        method: 'GET',
      });
      return response.data;
    } catch (error) {
      const status = (error as { status?: number })?.status;

      if (status === 404) {
        this.logger.warn(`Owner ${ownerId} is not known to users-service`, `${CONTEXT}.findOwner`);
        return null;
      }

      // Deliberately re-thrown. A 401 or a timeout from users-service is not a missing owner, and
      // silently returning null here would turn an outage into a subtly wrong response body.
      this.logger.error(
        `Failed to resolve owner ${ownerId}: ${(error as Error)?.message ?? 'unknown error'}`,
        (error as Error)?.stack,
        `${CONTEXT}.findOwner`,
      );
      throw error;
    }
  }
}

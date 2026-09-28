import { Injectable } from '@nestjs/common';
import { NEGATIVE_CACHE_SENTINEL, CacheService, cacheKey } from '@tw/cache';
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
 * Resolves product owners — the consumer half of the shared cache.
 *
 * This is the hop that makes the trace distributed, and the notable thing about the code is what it
 * does not contain. There is no trace id, no header assembly, no context propagation:
 * `RequestScopedHttpConnectionService` reads the id off the inbound request and attaches
 * `x-trace-id` to the outbound call, so users-service logs its side of the exchange under the same
 * id this service is logging under.
 *
 * The cache adds a level *before* that hop: the owner's entries, read directly. A hit answers the
 * question without users-service being involved at all — no HTTP call, no trace fan-out, one
 * round trip to the cache server instead of one to a peer — which is the entire economic argument
 * for consumers reading the shared cache rather than each service keeping its own. On a miss the
 * connector falls back to HTTP, users-service answers (its own read-through fills the entry as a
 * side effect), and the next consumer read is a hit. This service **never writes** the owner's
 * keys: only the owner knows what a fresh value is, and the cache server's ACL denies the write
 * even if a bug here tries.
 */
@Injectable()
export class UsersConnector {
  private readonly baseUrl = process.env.USERS_SERVICE_URL ?? 'http://localhost:4001';

  constructor(
    private readonly http: RequestScopedHttpConnectionService,
    private readonly logger: RequestScopedLoggerService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Fetches a product owner.
   *
   * @param noCache The caller demanded fresh data (`Cache-Control: no-cache`): skip this
   *   service's read of the owner's entry. The demand itself travels to users-service in the
   *   forwarded `cache-control` header — the connector's forward list carries it — and the owner
   *   does the bypass-and-refresh on its side, which is where the entry gets corrected.
   *
   * @returns The user, or `null` when users-service does not know them — an unknown owner is a data
   *   inconsistency worth logging, not a reason to fail the caller's request for a product.
   */
  async findOwner(ownerId: string, noCache: boolean): Promise<PublicUser | null> {
    if (!noCache) {
      const key = cacheKey('user', ownerId);
      // The sentinel type is on this read because the owner stores 'not_present' for a user it has
      // proven absent — honouring it is what keeps "owner does not exist" from being an HTTP call
      // every single time.
      const cached = await this.cache.get<PublicUser | typeof NEGATIVE_CACHE_SENTINEL>(key);

      if (cached === NEGATIVE_CACHE_SENTINEL) {
        this.logger.debug(JSON.stringify({ cache: 'negative-hit', key }), `${CONTEXT}.findOwner`);
        return null;
      }
      if (cached !== null) {
        this.logger.debug(JSON.stringify({ cache: 'hit', key }), `${CONTEXT}.findOwner`);
        return cached;
      }
      this.logger.debug(JSON.stringify({ cache: 'miss', key }), `${CONTEXT}.findOwner`);
    }

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
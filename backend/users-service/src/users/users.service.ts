import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService, ReadThroughService, cacheKeyOrNull } from '@tw/cache';
import { RequestScopedLoggerService } from '@tw/logger';
import { PublicUser, nextUserId, toPublicUser, users } from '../data/users.store';

import type { User } from '../data/users.store';
import type { UpdateUserDto } from './dto/update-user.dto';

const CONTEXT = 'UsersService';

/**
 * Note what is absent from this file: there is no trace id threaded through the call chain.
 *
 * Injecting `RequestScopedLoggerService` puts this provider in request scope, and the logger reads
 * the id off the request the framework hands it. Every line below joins the caller's trace with no
 * argument passed around and no scope to open or close. The single exception is the `traceId`
 * handed to `readThrough`: the cache is a process-scoped singleton whose logger is not
 * request-scoped, so its decision lines need the id given to them — taken off this logger, not
 * off the call chain.
 *
 * This service is the OWNER of the `user` cache entries: the only writer of its keys, and the one
 * that invalidates them after every write. Consumers read those keys directly (see the connector
 * in products-service), which is what makes a consumer hit cheaper than a call to this service.
 *
 * Every write to the users store goes through a method here — registration included — because
 * invalidation is only as complete as the write paths that remember it. A second module writing
 * the store directly is a write the cache never hears about.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly logger: RequestScopedLoggerService,
    private readonly cache: CacheService,
    private readonly readThrough: ReadThroughService,
  ) {}

  async findOne(id: string, noCache: boolean): Promise<PublicUser> {
    // The id comes from the URL, so it is end-user input: one that cannot form a cache key —
    // `/v1/users/foo%20bar`, or a non-canonical spelling like `/v1/users/%201` — reads as null and
    // falls back to an uncached store read. The source of truth answers for exactly the id it was
    // asked about, and user 1's entry is never written by a request that was not for user 1.
    const key = cacheKeyOrNull('user', id);
    const load = async () => {
      const found = users.find((candidate) => candidate.id === id);
      return found ? toPublicUser(found) : null;
    };

    const user = await (key
      ? this.readThrough.readThrough({
          key,
          // null means "does not exist" — it is what gets negative-cached. A store failure throws
          // instead, because only the loader can tell absence apart from failure.
          load,
          noCache,
          traceId: this.logger.traceId,
        })
      : load());

    if (!user) {
      this.logger.warn(`User ${id} not found`, `${CONTEXT}.findOne`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return user;
  }

  /**
   * Adds a user — the one way a user comes into existence, whichever module asks for it.
   *
   * The new id is invalidated like any other write: ids are sequential, so the next one is
   * predictable, and a lookup for it before it existed has cached a 404 that would otherwise
   * outlive the registration by up to the negative TTL — on every consumer, too.
   */
  create(fields: Omit<User, 'id'>): PublicUser {
    const user: User = { id: nextUserId(), ...fields };
    users.push(user);
    this.logger.info(`Created user ${user.id}`, `${CONTEXT}.create`);
    this.invalidateUser(user.id);

    return toPublicUser(user);
  }

  update(id: string, changes: UpdateUserDto): PublicUser {
    const index = users.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot update user ${id}: not found`, `${CONTEXT}.update`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    }

    users[index] = { ...users[index], ...changes };
    this.logger.info(`Updated user ${id}`, `${CONTEXT}.update`);
    this.invalidateUser(id);

    return toPublicUser(users[index]);
  }

  remove(id: string): { deleted: true } {
    const index = users.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot delete user ${id}: not found`, `${CONTEXT}.remove`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    }

    users.splice(index, 1);
    this.logger.info(`Deleted user ${id}`, `${CONTEXT}.remove`);
    this.invalidateUser(id);

    return { deleted: true };
  }

  /**
   * Drops this service's cached copy of a user, after every write.
   *
   * Never gated on the request's `Cache-Control` — the header says what *this caller* may read;
   * the write changes what *everyone* will read. `setImmediate` keeps the invalidation off the
   * response path: the caller does not wait on the cache, and no cache failure can fail the
   * request that caused it. The key is built inside the callback for the same reason — the store
   * write is already committed, and nothing about the cache may turn it into a 500.
   *
   * The del count is logged every time as a debugging aid: after a read that filled the key, a
   * `del` that removed nothing means the invalidation used a different key than the read. A `0`
   * on its own is also what an uncached user gives, so read it next to the reader's key.
   */
  private invalidateUser(id: string): void {
    setImmediate(() => {
      // An id that cannot form a key was never cached — every read of it went uncached.
      const key = cacheKeyOrNull('user', id);
      if (!key) return;
      void this.cache.del(key).then((removed) => {
        this.logger.debug(
          `Invalidation removed ${removed} cache entry for user ${id} (key ${key})`,
          `${CONTEXT}.invalidateUser`,
        );
      });
    });
  }
}
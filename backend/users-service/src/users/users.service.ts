import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestScopedLoggerService } from '@tw/logger';
import { PublicUser, toPublicUser, users } from '../data/users.store';

import type { UpdateUserDto } from './dto/update-user.dto';

const CONTEXT = 'UsersService';

/**
 * Note what is absent from this file: there is no trace id anywhere.
 *
 * Injecting `RequestScopedLoggerService` puts this provider in request scope, and the logger reads
 * the id off the request the framework hands it. Every line below joins the caller's trace with no
 * argument threaded through, no context object, and no scope to open or close.
 */
@Injectable()
export class UsersService {
  constructor(private readonly logger: RequestScopedLoggerService) {}

  findOne(id: string): PublicUser {
    const user = users.find((candidate) => candidate.id === id);

    if (!user) {
      this.logger.warn(`User ${id} not found`, `${CONTEXT}.findOne`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    }

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

    return { deleted: true };
  }
}

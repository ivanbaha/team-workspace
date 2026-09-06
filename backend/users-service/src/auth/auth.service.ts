import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { RequestScopedLoggerService } from '@tw/logger';
import * as jwt from 'jsonwebtoken';
import { PublicUser, toPublicUser, users } from '../data/users.store';

import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const CONTEXT = 'AuthService';

@Injectable()
export class AuthService {
  constructor(private readonly logger: RequestScopedLoggerService) {}

  register({ name, email }: RegisterDto): PublicUser {
    if (users.some((candidate) => candidate.email === email)) {
      // The email is the thing being rejected, so it belongs in the line. Anything a support
      // request would quote back at you is worth logging under the trace id.
      this.logger.warn(`Registration rejected: ${email} is already taken`, `${CONTEXT}.register`);
      throw new BadRequestException({ code: 'EMAIL_TAKEN', message: 'Email already registered' });
    }

    const user = { id: String(users.length + 1), name, email, passwordHash: 'hashed_pw' };
    users.push(user);
    this.logger.info(`Registered user ${user.id}`, `${CONTEXT}.register`);

    return toPublicUser(user);
  }

  login({ email }: LoginDto): { token: string } {
    const user = users.find((candidate) => candidate.email === email);

    if (!user) {
      this.logger.warn(`Login failed for ${email}`, `${CONTEXT}.login`);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET ?? 'changeme', {
      expiresIn: '1h',
    });
    this.logger.info(`Issued token for user ${user.id}`, `${CONTEXT}.login`);

    return { token };
  }
}

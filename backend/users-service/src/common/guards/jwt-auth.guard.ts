import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Verifies the bearer token on every route not marked `@Public()`.
 *
 * Guards run **before** interceptors, so a rejection here never reaches the request-logging
 * interceptor and produces no incoming/outgoing pair. The trace id still exists — the seeding
 * middleware runs before guards — and the exception filter logs the rejection under it, which is
 * what keeps 401s visible in a trace.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = String(request.headers?.authorization ?? '').split(' ')[1];
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'No token provided' });

    try {
      request.user = jwt.verify(token, process.env.JWT_SECRET ?? 'changeme');
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Token is invalid or expired' });
    }
  }
}

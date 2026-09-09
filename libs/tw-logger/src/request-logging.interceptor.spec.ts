import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { LoggerService } from './logger.service';

function makeLogger() {
  return {
    info: jest.fn(),
    silly: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as LoggerService;
}

function makeContext(req: Record<string, unknown>, res: Record<string, unknown> = { statusCode: 200 }) {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

const nextOk = (body: unknown = { ok: true }): CallHandler => ({ handle: () => of(body) });

/** Reads the JSON document nested inside a request-log `message`. */
const payloadOf = (call: unknown[]) => JSON.parse(call[0] as string);

describe('RequestLoggingInterceptor', () => {
  it('emits the request.in/response.out pair a trace is reconstructed from', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'compact');
    const req = {
      method: 'GET',
      url: '/v1/users/1',
      headers: { 'x-trace-id': 'TRACE1', 'user-agent': 'products-service' },
    };

    interceptor.intercept(makeContext(req), nextOk()).subscribe(() => {
      const [incoming, outgoing] = (logger.info as jest.Mock).mock.calls;

      expect(payloadOf(incoming)).toEqual({
        direction: 'request.in',
        method: 'GET',
        path: '/v1/users/1',
        caller: 'products-service',
      });
      expect(payloadOf(outgoing)).toMatchObject({
        direction: 'response.out',
        method: 'GET',
        path: '/v1/users/1',
        statusCode: 200,
      });
      // Both halves must carry the id, or the pair cannot be joined.
      expect(incoming[2]).toBe('TRACE1');
      expect(outgoing[2]).toBe('TRACE1');
      done();
    });
  });

  it('still logs the response.out half when the request fails, with the status off the exception', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'compact');
    const req = { method: 'GET', url: '/v1/users/9', headers: { 'x-trace-id': 'TRACE1' } };
    const failing: CallHandler = { handle: () => throwError(() => ({ getStatus: () => 404 })) };

    interceptor.intercept(makeContext(req, { statusCode: 200 }), failing).subscribe({
      error: () => {
        const outgoing = (logger.info as jest.Mock).mock.calls[1];
        // res.statusCode is still 200 here — the filter has not written the response yet.
        expect(payloadOf(outgoing)).toMatchObject({ direction: 'response.out', statusCode: 404 });
        done();
      },
    });
  });

  it('records a duration on the response.out half', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'compact');
    const req = { method: 'GET', url: '/v1/users', headers: {} };

    interceptor.intercept(makeContext(req), nextOk()).subscribe(() => {
      expect(typeof payloadOf((logger.info as jest.Mock).mock.calls[1]).duration).toBe('number');
      done();
    });
  });

  it('skips infrastructure paths', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'compact');
    const req = { method: 'GET', url: '/health', headers: {} };

    interceptor.intercept(makeContext(req), nextOk()).subscribe(() => {
      expect(logger.info).not.toHaveBeenCalled();
      done();
    });
  });

  it('logs at verbose with masked headers and bodies in full mode', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'full');
    const req = {
      method: 'POST',
      url: '/v1/auth/login',
      headers: { authorization: 'Bearer abcdefghijkl' },
      body: { email: 'a@b.com', password: 'hunter2000' },
    };

    interceptor.intercept(makeContext(req, { statusCode: 200, getHeaders: () => ({}) }), nextOk()).subscribe(() => {
      expect(logger.info).not.toHaveBeenCalled();

      const payload = payloadOf((logger.verbose as jest.Mock).mock.calls[0]);
      expect(payload.headers.authorization).toBe('Bearer ab**...**kl');
      expect(payload.body.password).toBe('hu**...**00');
      done();
    });
  });

  it('emits nothing at all when switched off', (done) => {
    const logger = makeLogger();
    const interceptor = new RequestLoggingInterceptor(logger, undefined, 'off');

    interceptor.intercept(makeContext({ method: 'GET', url: '/v1/users', headers: {} }), nextOk()).subscribe(() => {
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.verbose).not.toHaveBeenCalled();
      done();
    });
  });
});

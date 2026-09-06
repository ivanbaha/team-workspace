import { HttpException } from '@nestjs/common';
import { TRACE_ID_HEADER } from '@tw/tracing';
import { HttpConnectionService } from './http-connection.service';
import { HttpConnectionOptions } from './types';

import type { ITraceLogger } from '@tw/logger';

function makeLogger(): ITraceLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  };
}

function makeOptions(overrides: Partial<HttpConnectionOptions> = {}): HttpConnectionOptions {
  return Object.assign(new HttpConnectionOptions(), {
    userAgent: 'orders-service',
    retry: false,
    verboseLogs: false,
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The headers actually put on the wire by the most recent fetch call. */
const sentHeaders = (): Record<string, string> =>
  (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;

describe('HttpConnectionService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('puts an explicit trace id on the wire', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({ url: 'https://users/v1/users/1', method: 'GET', traceId: 'TRACE1' });

    expect(sentHeaders()[TRACE_ID_HEADER]).toBe('TRACE1');
  });

  it('reads the trace id out of caller-supplied headers when none is passed', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({ url: 'https://users/v1/users/1', method: 'GET', headers: { 'X-Trace-Id': 'TRACE1' } });

    expect(sentHeaders()[TRACE_ID_HEADER]).toBe('TRACE1');
  });

  it('sends exactly one trace header when the caller mixed casings', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({
      url: 'https://users/v1/users/1',
      method: 'GET',
      headers: { 'X-Trace-Id': 'STALE' },
      traceId: 'TRACE1',
    });

    const headers = sentHeaders();
    const variants = Object.keys(headers).filter((key) => key.toLowerCase() === TRACE_ID_HEADER);
    expect(variants).toEqual([TRACE_ID_HEADER]);
    expect(headers[TRACE_ID_HEADER]).toBe('TRACE1');
  });

  it('never invents a trace id — an untraced call goes out untraced', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({ url: 'https://users/v1/users/1', method: 'GET' });

    expect(sentHeaders()[TRACE_ID_HEADER]).toBeUndefined();
  });

  it('always identifies itself, because User-Agent is what creates the edge', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({ url: 'https://users/v1/users/1', method: 'GET' });

    expect(sentHeaders()['User-Agent']).toBe('orders-service');
  });

  it('surfaces an upstream failure with the upstream status, not a 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'not found' }, 404));
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await expect(service.connect({ url: 'https://users/v1/users/9', method: 'GET' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('maps a transport failure to 504 rather than leaking the raw error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    const error = await service.connect({ url: 'https://users/v1/users/1', method: 'GET' }).catch((e) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(504);
  });

  it('retries a 5xx but not a 4xx', async () => {
    const options = makeOptions({ retry: true, retryAttempts: 2, retryDelay: 1 });

    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await new HttpConnectionService(options, makeLogger())
      .connect({ url: 'https://users/v1/users/1', method: 'GET' })
      .catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockClear().mockResolvedValue(jsonResponse({}, 400));
    await new HttpConnectionService(options, makeLogger())
      .connect({ url: 'https://users/v1/users/1', method: 'GET' })
      .catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('omits null and undefined query params instead of serialising them', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({
      url: 'https://products/v1/products',
      method: 'GET',
      params: { category: 'widgets', search: undefined, cursor: null },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://products/v1/products?category=widgets');
  });
});

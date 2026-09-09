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

  it('sends exactly one User-Agent when the caller supplied one in headers', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    // Two distinct object keys that are one header on the wire, where `fetch` would combine them
    // into `orders-service, curl/8.4.0` — a value no receiving service reads as an identity.
    await service.connect({
      url: 'https://users/v1/users/1',
      method: 'GET',
      headers: { 'user-agent': 'curl/8.4.0', 'User-Agent': 'something-else' },
    });

    const headers = sentHeaders();
    const variants = Object.keys(headers).filter((key) => key.toLowerCase() === 'user-agent');
    expect(variants).toEqual(['User-Agent']);
    expect(headers['User-Agent']).toBe('orders-service');
  });

  it('lets a per-call userAgent override win, since it is the one deliberate escape hatch', async () => {
    const service = new HttpConnectionService(makeOptions(), makeLogger());

    await service.connect({ url: 'https://third-party/v1/thing', method: 'GET', userAgent: 'orders-service/partner' });

    expect(sentHeaders()['User-Agent']).toBe('orders-service/partner');
  });

  describe('the outbound call record', () => {
    /** Request-log payloads written at `info`, in order. */
    const infoPayloads = (logger: ITraceLogger) =>
      (logger.info as jest.Mock).mock.calls.map((call) => JSON.parse(call[0] as string));

    it('states the call at info, both halves, without verbose logging enabled', async () => {
      const logger = makeLogger();
      await new HttpConnectionService(makeOptions(), logger).connect({
        url: 'https://users/v1/users/1',
        method: 'GET',
        traceId: 'TRACE1',
      });

      const [out, back] = infoPayloads(logger);
      expect(out).toEqual({ direction: 'request.out', method: 'GET', url: 'https://users/v1/users/1' });
      expect(back).toMatchObject({ direction: 'response.in', method: 'GET', statusCode: 200 });
      expect(typeof back.duration).toBe('number');
      // The trace id goes on both, or the two lines cannot be tied to the request that caused them.
      expect((logger.info as jest.Mock).mock.calls.every((call) => call[2] === 'TRACE1')).toBe(true);
    });

    it('still records the response half when the transport fails', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const logger = makeLogger();

      await expect(
        new HttpConnectionService(makeOptions(), logger).connect({ url: 'https://users/v1/users/1', method: 'GET' }),
      ).rejects.toMatchObject({ status: 504 });

      // A request.out with no response.in is an unterminated span — reserve that for calls that
      // genuinely never came back, not for ones that failed in a way we saw.
      expect(infoPayloads(logger).map((payload) => payload.direction)).toEqual(['request.out', 'response.in']);
      expect(infoPayloads(logger)[1]).toMatchObject({ statusCode: 504 });
    });

    it('keeps headers and bodies out of the info pair, and in the verbose one', async () => {
      const logger = makeLogger();
      await new HttpConnectionService(makeOptions({ verboseLogs: true }), logger).connect({
        url: 'https://users/v1/login',
        method: 'POST',
        data: { password: 'hunter2000' },
      });

      expect(infoPayloads(logger).every((payload) => !('headers' in payload) && !('body' in payload))).toBe(true);

      const detailed = JSON.parse((logger.verbose as jest.Mock).mock.calls[0][0] as string);
      expect(detailed.headers['User-Agent']).toBe('orders-service');
      // The body is masked as structured data. Masking the serialised string instead silently did
      // nothing — a JSON string is neither an object with sensitive keys nor URL-encoded.
      expect(detailed.body).toEqual({ password: 'hu**...**00' });
    });
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

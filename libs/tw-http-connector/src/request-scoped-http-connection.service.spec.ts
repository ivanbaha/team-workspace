import { TRACE_ID_HEADER } from '@tw/tracing';
import { RequestScopedHttpConnectionService } from './request-scoped-http-connection.service';
import { HttpConnectionOptions } from './types';

import type { HttpConnectionService } from './http-connection.service';

function makeBase() {
  return { connect: jest.fn().mockResolvedValue({}) } as unknown as HttpConnectionService;
}

const options = Object.assign(new HttpConnectionOptions(), {
  userAgent: 'products-service',
  forwardHeaders: ['accept-language'],
});

/** The options the wrapper handed down to the singleton. */
const delegated = (base: HttpConnectionService) => (base.connect as jest.Mock).mock.calls[0][0];

describe('RequestScopedHttpConnectionService', () => {
  it('inherits the inbound trace id with nothing passed', async () => {
    const base = makeBase();
    const req = { headers: { [TRACE_ID_HEADER]: 'TRACE1' } };

    await new RequestScopedHttpConnectionService(options, base, req).connect({
      url: 'https://users/v1/users/1',
      method: 'GET',
    });

    expect(delegated(base).traceId).toBe('TRACE1');
  });

  it('lets an explicit trace id win, so a handler can fan out under derived ids', async () => {
    const base = makeBase();
    const req = { headers: { [TRACE_ID_HEADER]: 'TRACE1' } };

    await new RequestScopedHttpConnectionService(options, base, req).connect({
      url: 'https://users/v1/users/1',
      method: 'GET',
      traceId: 'TRACE1-chunk-2',
    });

    expect(delegated(base).traceId).toBe('TRACE1-chunk-2');
  });

  it('forwards configured headers, with caller headers taking priority', async () => {
    const base = makeBase();
    const req = { headers: { [TRACE_ID_HEADER]: 'TRACE1', 'accept-language': 'de-DE', cookie: 'session=secret' } };

    await new RequestScopedHttpConnectionService(options, base, req).connect({
      url: 'https://users/v1/users/1',
      method: 'GET',
      headers: { 'Accept-Language': 'en-GB' },
    });

    const headers = delegated(base).headers;
    expect(headers['accept-language']).toBe('en-GB');
    // Not on the forward list — inbound credentials must not leak onto unrelated calls.
    expect(headers.cookie).toBeUndefined();
  });

  it('degrades to no trace id outside a request rather than failing', async () => {
    const base = makeBase();
    const service = new RequestScopedHttpConnectionService(options, base, undefined);

    await service.connect({ url: 'https://users/v1/users/1', method: 'GET' });

    expect(service.traceId).toBeUndefined();
    expect(delegated(base).traceId).toBeUndefined();
  });
});

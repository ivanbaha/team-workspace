import { TRACE_ID_HEADER } from './constants';
import { deriveTraceId, ensureTraceId, getTraceId, newTraceId } from './trace-id';
import { traceIdMiddleware } from './trace-id.middleware';

describe('newTraceId', () => {
  it('mints a 26-character ULID', () => {
    expect(newTraceId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('mints a different id every time', () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe('deriveTraceId', () => {
  it('keeps the parent as a prefix so a substring search finds both', () => {
    const parent = newTraceId();
    const child = deriveTraceId(parent, 'page', 3);

    expect(child).toBe(`${parent}-page-3`);
    expect(child.includes(parent)).toBe(true);
  });
});

describe('getTraceId', () => {
  it('reads the canonical lowercase header', () => {
    expect(getTraceId({ headers: { [TRACE_ID_HEADER]: 'abc' } })).toBe('abc');
  });

  it('reads a header sent with different casing', () => {
    expect(getTraceId({ headers: { 'X-Trace-Id': 'abc' } })).toBe('abc');
  });

  it('takes the first value when a header arrives repeated', () => {
    expect(getTraceId({ headers: { [TRACE_ID_HEADER]: ['first', 'second'] } })).toBe('first');
  });

  it('returns undefined rather than throwing when there is no request at all', () => {
    expect(getTraceId(undefined)).toBeUndefined();
    expect(getTraceId({})).toBeUndefined();
    expect(getTraceId({ headers: {} })).toBeUndefined();
  });

  it('treats an empty header as absent', () => {
    expect(getTraceId({ headers: { [TRACE_ID_HEADER]: '' } })).toBeUndefined();
  });
});

describe('ensureTraceId', () => {
  it('inherits an id that is already on the request', () => {
    const req = { headers: { [TRACE_ID_HEADER]: 'inherited' } };

    expect(ensureTraceId(req)).toBe('inherited');
    expect(req.headers[TRACE_ID_HEADER]).toBe('inherited');
  });

  it('mints an id when none is present and writes it back onto the request', () => {
    const req: { headers: Record<string, unknown> } = { headers: {} };

    const traceId = ensureTraceId(req);

    // The write-back is the mechanism: every request-scoped provider reads this same object.
    expect(req.headers[TRACE_ID_HEADER]).toBe(traceId);
  });

  it('creates the headers object when the request has none', () => {
    const req: { headers?: Record<string, unknown> } = {};

    const traceId = ensureTraceId(req);

    expect(req.headers?.[TRACE_ID_HEADER]).toBe(traceId);
  });
});

describe('traceIdMiddleware', () => {
  it('seeds an id, echoes it, and calls next', () => {
    const req: { headers: Record<string, unknown> } = { headers: {} };
    const setHeader = jest.fn();
    const next = jest.fn();

    traceIdMiddleware()(req, { setHeader }, next);

    const seeded = req.headers[TRACE_ID_HEADER];
    expect(typeof seeded).toBe('string');
    expect(setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, seeded);
    expect(next).toHaveBeenCalled();
  });

  it('echoes the inherited id rather than a new one', () => {
    const req = { headers: { [TRACE_ID_HEADER]: 'inherited' } };
    const setHeader = jest.fn();

    traceIdMiddleware()(req, { setHeader }, jest.fn());

    expect(setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, 'inherited');
  });

  it('falls back to a Fastify-style header setter', () => {
    const header = jest.fn();

    traceIdMiddleware()({ headers: {} }, { header }, jest.fn());

    expect(header).toHaveBeenCalledWith(TRACE_ID_HEADER, expect.any(String));
  });

  it('still calls next when echoing is off and the response has no setter', () => {
    const next = jest.fn();

    traceIdMiddleware({ echoResponseHeader: false })({ headers: {} }, {}, next);

    expect(next).toHaveBeenCalled();
  });
});

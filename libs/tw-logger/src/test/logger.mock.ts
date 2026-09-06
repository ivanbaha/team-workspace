/**
 * Test doubles for the two logger surfaces.
 *
 * Shipped from the package rather than rewritten per service: a mock that drifts from the real
 * method signatures lets a broken logging call pass its tests and fail in production.
 */
export const MockedLoggerService = {
  provide: 'LoggerService',
  useValue: {
    info: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
  },
};

export const MockedRequestScopedLoggerService = {
  provide: 'RequestScopedLoggerService',
  useValue: {
    info: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn(),
    traceId: undefined,
  },
};
